import { createLogger } from '../logger.ts';
import { SessionManager, MissingCredentialsError, type Session } from './session.ts';
import { isTouched, resolveApproachSide } from './trigger.ts';
import { candleOpenTime, nowSeconds, nthCandleCloseTime } from '../util/time.ts';
import type { AppConfig } from '../config.ts';
import type { OrderRepository } from '../storage/orders.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { AccountMode, NewOrder, Order } from '../types.ts';
import type { ClosedDeal, OpenOrderAck } from '../pocket/protocol.ts';

export type EngineEvent =
  | { type: 'triggered'; order: Order; price: number }
  | { type: 'armed'; order: Order; price: number; entryAt: number }
  | { type: 'missed'; order: Order; price: number; reason: string }
  | { type: 'opened'; order: Order }
  | { type: 'settled'; order: Order }
  | { type: 'failed'; order: Order; error: string }
  | { type: 'expired'; order: Order }
  | { type: 'settlement_pending'; order: Order }
  | { type: 'session'; mode: AccountMode; symbol: string | null; state: 'up' | 'down'; detail?: string }
  | { type: 'auth_failed'; mode: AccountMode; detail: string };

export type EngineEventHandler = (event: EngineEvent) => void;

interface Attachment {
  session: Session;
  detach: () => void;
  settlementWarned: boolean;
}

const HOUSEKEEPING_INTERVAL_MS = 1_000;

export class TradeEngine {
  private readonly config: AppConfig;
  private readonly orders: OrderRepository;
  private readonly settings: SettingsStore;
  private readonly sessions: SessionManager;
  private readonly logger = createLogger('engine');
  private readonly handlers = new Set<EngineEventHandler>();
  private readonly attachments = new Map<string, Attachment>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    config: AppConfig,
    orders: OrderRepository,
    settings: SettingsStore,
    sessions: SessionManager = new SessionManager(config, settings),
  ) {
    this.config = config;
    this.orders = orders;
    this.settings = settings;
    this.sessions = sessions;
  }
  start(): void {
    if (this.timer) return;

    for (const order of this.orders.listActive()) {
      if (order.status === 'placing') {
        const updated = this.orders.update(order.id, {
          status: 'failed',
          note: 'bot restarted while the order was being sent, verify on the broker',
        });
        if (updated) this.publish({ type: 'failed', order: updated, error: 'interrupted while placing' });
        continue;
      }
      this.attach(order);
    }

    this.timer = setInterval(() => this.housekeeping(), HOUSEKEEPING_INTERVAL_MS);
    this.logger.info(`engine started with ${this.attachments.size} live order(s)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const orderId of [...this.attachments.keys()]) this.detach(orderId);
    this.sessions.stopAll();
  }

  onEvent(handler: EngineEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private publish(event: EngineEvent): void {
    for (const handler of [...this.handlers]) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error('event handler threw', error);
      }
    }
  }

  get sessionManager(): SessionManager {
    return this.sessions;
  }

  hasCredentials(mode: AccountMode): boolean {
    return this.sessions.hasCredentials(mode);
  }
  cachedBalance(mode: AccountMode): number | null {
    for (const { session } of this.sessions.list()) {
      if (session.mode === mode && session.balance !== null) return session.balance;
    }
    return null;
  }
  async balance(mode: AccountMode, timeoutMs = 20_000): Promise<number | null> {
    const existing = this.sessions
      .list()
      .map((entry) => entry.session)
      .find((session) => session.mode === mode && session.balance !== null);
    if (existing) return existing.balance;

    const holder = `balance:${Date.now()}`;
    const session = this.sessions.acquire(mode, null, holder);
    try {
      await session.client.waitUntilReady(timeoutMs);
      if (session.balance !== null) return session.balance;
      return await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          off();
          resolve(session.balance);
        }, 8_000);
        const off = session.on('balance', (value) => {
          clearTimeout(timer);
          off();
          resolve(value);
        });
        session.client.refreshBalance();
      });
    } finally {
      this.sessions.release(mode, null, holder);
    }
  }
  async price(mode: AccountMode, symbol: string, timeoutMs = 20_000): Promise<number | null> {
    const existing = this.sessions.get(mode, symbol);
    if (existing?.price !== null && existing?.price !== undefined) return existing.price;

    const holder = `price:${Date.now()}`;
    const session = this.sessions.acquire(mode, symbol, holder);
    session.ensureTimeframe(this.settings.get('defaultTimeframeSeconds'));
    try {
      await session.client.waitUntilReady(timeoutMs);
      if (session.price !== null) return session.price;
      return await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          off();
          resolve(session.price);
        }, 10_000);
        const off = session.on('tick', (tick) => {
          clearTimeout(timer);
          off();
          resolve(tick.price);
        });
      });
    } finally {
      this.sessions.release(mode, symbol, holder);
    }
  }
  async createOrder(input: NewOrder): Promise<Order> {
    if (!this.sessions.hasCredentials(input.accountMode)) {
      throw new MissingCredentialsError(input.accountMode);
    }

    let referencePrice = input.referencePrice ?? null;
    if (referencePrice === null) {
      referencePrice = await this.price(input.accountMode, input.symbol).catch((error: unknown) => {
        this.logger.warn(`could not sample ${input.symbol} before arming`, error);
        return null;
      });
    }

    const order = this.orders.create({
      ...input,
      referencePrice,
      approachSide: input.approachSide ?? resolveApproachSide(input.triggerPrice, referencePrice),
    });

    this.attach(order);
    this.logger.info(`order ${order.id} armed`, {
      symbol: order.symbol,
      trigger: order.triggerPrice,
      side: order.approachSide,
      reference: referencePrice,
    });
    return order;
  }
  cancel(orderId: string): { ok: true; order: Order } | { ok: false; reason: string } {
    const order = this.orders.get(orderId);
    if (!order) return { ok: false, reason: 'not_found' };
    if (order.status === 'open' || order.status === 'placing') {
      return { ok: false, reason: 'already_open' };
    }
    if (order.status !== 'pending' && order.status !== 'armed') {
      return { ok: false, reason: 'not_active' };
    }
    const updated = this.orders.update(orderId, { status: 'cancelled' });
    this.detach(orderId);
    return updated ? { ok: true, order: updated } : { ok: false, reason: 'not_found' };
  }
  reloadCredentials(mode: AccountMode): void {
    const affected = this.orders.listActive().filter((order) => order.accountMode === mode);
    for (const order of affected) this.detach(order.id);
    this.sessions.resetMode(mode);
    for (const order of affected) {
      if (order.status !== 'placing') this.attach(order);
    }
    this.logger.info(`credentials for ${mode} reloaded; ${affected.length} order(s) re-attached`);
  }
  async testCredentials(
    mode: AccountMode,
    timeoutMs = 25_000,
  ): Promise<{ ok: true; balance: number | null } | { ok: false; error: string }> {
    const holder = `test:${Date.now()}`;
    let session: Session;
    try {
      session = this.sessions.acquire(mode, null, holder);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    try {
      const outcome = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
        if (session.isReady) {
          resolve({ ok: true });
          return;
        }
        const finish = (result: { ok: true } | { ok: false; error: string }): void => {
          clearTimeout(timer);
          offReady();
          offFail();
          resolve(result);
        };
        const timer = setTimeout(
          () => finish({ ok: false, error: 'no response from the broker in time' }),
          timeoutMs,
        );
        const offReady = session.on('ready', () => finish({ ok: true }));
        const offFail = session.on('authFailed', (reason) => finish({ ok: false, error: reason }));
      });

      if (!outcome.ok) return outcome;
      return { ok: true, balance: await this.balance(mode, timeoutMs) };
    } finally {
      this.sessions.release(mode, null, holder);
    }
  }

  private attach(order: Order): void {
    if (this.attachments.has(order.id)) return;

    let session: Session;
    try {
      session = this.sessions.acquire(order.accountMode, order.symbol, order.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = this.orders.update(order.id, { status: 'failed', note: message });
      if (updated) this.publish({ type: 'failed', order: updated, error: message });
      return;
    }

    session.ensureTimeframe(order.timeframeSeconds);

    const offTick = session.on('tick', () => this.onTick(order.id, session));
    const offDeal = session.on('dealClosed', (deal) =>
      this.onDealClosed(deal, session.client.timeOffset),
    );
    const offUp = session.on('ready', () =>
      this.publish({ type: 'session', mode: session.mode, symbol: session.symbol, state: 'up' }),
    );
    const offDown = session.on('disconnected', (reason) =>
      this.publish({ type: 'session', mode: session.mode, symbol: session.symbol, state: 'down', detail: reason }),
    );
    const offAuthFail = session.on('authFailed', (reason) =>
      this.publish({ type: 'auth_failed', mode: session.mode, detail: reason }),
    );

    this.attachments.set(order.id, {
      session,
      settlementWarned: false,
      detach: () => {
        offTick();
        offDeal();
        offUp();
        offDown();
        offAuthFail();
      },
    });
  }

  private detach(orderId: string): void {
    const attachment = this.attachments.get(orderId);
    if (!attachment) return;
    attachment.detach();
    this.attachments.delete(orderId);
    this.sessions.release(attachment.session.mode, attachment.session.symbol, orderId);
  }

  private onTick(orderId: string, session: Session): void {
    const order = this.orders.get(orderId);
    if (!order) {
      this.detach(orderId);
      return;
    }

    const price = session.price;
    const tickTime = session.lastTickTime;
    if (price === null || tickTime === null) return;

    if (order.status === 'pending') {
      if (order.referencePrice === null) {
        const side = resolveApproachSide(order.triggerPrice, price);
        this.orders.update(order.id, { referencePrice: price, approachSide: side });
        return;
      }
      if (isTouched(order, session.priorPrice, price)) {
        if (session.tickFollowsGap) {
          this.missed(order, price, 'the price crossed the trigger while the price stream was down');
          return;
        }
        this.onTriggered(order, price, tickTime, session.client.timeOffset);
      }
      return;
    }

    if (order.status === 'armed') {
      this.maybeEnterOnNewCandle(
        order,
        tickTime,
        price,
        session.client.timeOffset,
        session.tickFollowsGap,
      );
    }
  }

  private onTriggered(order: Order, price: number, tickTime: number, offset: number): void {
    if (order.triggerMode === 'next_candle') {
      const updated = this.orders.update(order.id, {
        status: 'armed',
        triggeredPrice: price,
        triggeredAt: tickTime - offset,
      });
      if (!updated) return;
      const entryAt = candleOpenTime(tickTime, order.timeframeSeconds) + order.timeframeSeconds - offset;
      this.logger.info(`order ${order.id} touched at ${price}; entering at candle open ${entryAt}`);
      this.publish({ type: 'armed', order: updated, price, entryAt });
      return;
    }

    const updated = this.orders.update(order.id, {
      status: 'placing',
      triggeredPrice: price,
      triggeredAt: tickTime - offset,
    });
    if (!updated) return;
    this.logger.info(`order ${order.id} touched at ${price}; entering now`);
    this.publish({ type: 'triggered', order: updated, price });
    void this.place(updated, tickTime);
  }
  private maybeEnterOnNewCandle(
    order: Order,
    tickTime: number,
    price: number,
    offset: number,
    followsGap: boolean,
  ): void {
    if (order.triggeredAt === null) return;
    const armedCandle = candleOpenTime(order.triggeredAt + offset, order.timeframeSeconds);
    const currentCandle = candleOpenTime(tickTime, order.timeframeSeconds);
    if (currentCandle <= armedCandle) return;

    if (currentCandle > armedCandle + order.timeframeSeconds) {
      const late = Math.round((currentCandle - armedCandle) / order.timeframeSeconds) - 1;
      this.missed(order, price, `the entry candle passed ${late} candle(s) ago`);
      return;
    }
    if (followsGap) {
      this.missed(order, price, 'the entry candle opened while the price stream was down');
      return;
    }

    const updated = this.orders.update(order.id, { status: 'placing' });
    if (!updated) return;
    this.logger.info(`order ${order.id} entering on new candle at ${price}`);
    this.publish({ type: 'triggered', order: updated, price });
    void this.place(updated, tickTime);
  }
  private resolveExpiry(
    order: Order,
    entryTime: number,
  ): { durationSeconds?: number; closeAtServerTime?: number; brokerCloseTime: number } {
    if (order.expiryMode === 'fixed') {
      return {
        durationSeconds: order.durationSeconds,
        brokerCloseTime: entryTime + order.durationSeconds,
      };
    }

    let close = nthCandleCloseTime(entryTime, order.timeframeSeconds, order.candleCount);
    const target = close;
    while (close - entryTime < this.config.limits.minDurationSeconds) {
      close += order.timeframeSeconds;
    }
    if (close !== target) {
      this.logger.info(
        `order ${order.id}: candle close at ${target} is under the ${this.config.limits.minDurationSeconds}s ` +
          `broker minimum, rolling the expiry forward to ${close}`,
      );
    }
    return { closeAtServerTime: close, brokerCloseTime: close };
  }

  private async place(order: Order, entryTime: number): Promise<void> {
    const attachment = this.attachments.get(order.id);
    const session = attachment?.session;
    if (!session) {
      this.fail(order, 'no live session for this order');
      return;
    }

    const offset = session.client.timeOffset;
    const { brokerCloseTime, ...expiry } = this.resolveExpiry(order, entryTime);
    const request = {
      asset: order.symbol,
      amount: order.amount,
      action: order.direction,
    };

    try {
      let ack: OpenOrderAck;
      try {
        ack = await session.client.openOrder({ ...request, ...expiry });
      } catch (error) {
        if (expiry.closeAtServerTime === undefined) throw error;
        const seconds = Math.max(
          this.config.limits.minDurationSeconds,
          Math.round(brokerCloseTime - entryTime),
        );
        this.logger.warn(`closeAt rejected for ${order.id}, retrying with ${seconds}s duration`, error);
        ack = await session.client.openOrder({ ...request, durationSeconds: seconds });
      }

      const updated = this.orders.update(order.id, {
        status: 'open',
        dealId: ack.dealId,
        openPrice: ack.openPrice,
        openedAt: nowSeconds(),
        closesAt: brokerCloseTime - offset,
      });
      if (updated) {
        this.logger.info(`order ${order.id} open as deal ${ack.dealId}`);
        this.publish({ type: 'opened', order: updated });
      }
    } catch (error) {
      this.fail(order, error instanceof Error ? error.message : String(error));
    }
  }

  private missed(order: Order, price: number, reason: string): void {
    const updated = this.orders.update(order.id, { status: 'expired', note: reason });
    this.detach(order.id);
    this.logger.warn(`order ${order.id} missed its entry at ${price}: ${reason}`);
    if (updated) this.publish({ type: 'missed', order: updated, price, reason });
  }

  private fail(order: Order, message: string): void {
    const updated = this.orders.update(order.id, { status: 'failed', note: message });
    this.detach(order.id);
    this.logger.warn(`order ${order.id} failed: ${message}`);
    if (updated) this.publish({ type: 'failed', order: updated, error: message });
  }

  private onDealClosed(deal: ClosedDeal, offset: number): void {
    const order = this.orders.findByDealId(deal.dealId);
    if (!order || order.closedAt !== null) return;

    const status = deal.profit > 0 ? 'won' : deal.profit < 0 ? 'lost' : 'draw';
    const updated = this.orders.update(order.id, {
      status,
      profit: deal.profit,
      closePrice: deal.closePrice,
      closedAt: deal.closeTimestamp !== null ? deal.closeTimestamp - offset : nowSeconds(),
    });
    this.detach(order.id);
    if (updated) {
      this.logger.info(`order ${order.id} settled ${status} (${deal.profit})`);
      this.publish({ type: 'settled', order: updated });
    }
  }

  private housekeeping(): void {
    const now = nowSeconds();

    for (const [orderId, attachment] of this.attachments) {
      const order = this.orders.get(orderId);
      if (!order) {
        this.detach(orderId);
        continue;
      }

      switch (order.status) {
        case 'pending': {
          if (order.validUntil !== null && now >= order.validUntil) {
            const updated = this.orders.update(orderId, {
              status: 'expired',
              note: 'the trigger price was never reached',
            });
            this.detach(orderId);
            if (updated) this.publish({ type: 'expired', order: updated });
          }
          break;
        }

        case 'armed': {
          const price = attachment.session.price;
          const offset = attachment.session.client.timeOffset;
          if (price !== null) {
            this.maybeEnterOnNewCandle(
              order,
              now + offset,
              price,
              offset,
              attachment.session.tickFollowsGap,
            );
          }
          break;
        }

        case 'open': {
          if (
            order.closesAt !== null &&
            !attachment.settlementWarned &&
            now > order.closesAt + this.config.engine.orderSettleGraceSeconds
          ) {
            attachment.settlementWarned = true;
            attachment.session.client.refreshBalance();
            this.logger.warn(`order ${orderId} has not settled ${Math.round(now - order.closesAt)}s after expiry`);
            this.publish({ type: 'settlement_pending', order });
          }
          break;
        }

        default:
          break;
      }
    }
  }
}
