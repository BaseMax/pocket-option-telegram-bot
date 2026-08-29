import { createLogger } from '../logger.ts';
import { errorMessage } from '../util/errors.ts';
import { awaitEvent } from '../util/async.ts';
import { MissingCredentialsError, type Session } from './session.ts';
import { SessionManager, borrowSession } from './session-manager.ts';
import { resolveExpiry } from './expiry.ts';
import { MarketData, type SymbolCheck } from './market.ts';
import { isTouched, resolveApproachSide } from './trigger.ts';
import { candleOpenTime, nowSeconds } from '../util/time.ts';
import type { AppConfig } from '../config.ts';
import type { OrderRepository } from '../storage/orders.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { AccountMode, NewOrder, Order } from '../types.ts';
import type { AssetInfo, ClosedDeal, OpenOrderAck } from '../pocket/protocol.ts';

export type { SymbolCheck } from './market.ts';

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
  private readonly market: MarketData;
  private readonly logger = createLogger('engine');
  private readonly handlers = new Set<EngineEventHandler>();
  private readonly attachments = new Map<string, Attachment>();
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly config: AppConfig,
    private readonly orders: OrderRepository,
    settings: SettingsStore,
    private readonly sessions: SessionManager = new SessionManager(config, settings),
  ) {
    this.market = new MarketData(this.sessions, settings);
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
  /** Read-only market questions, answered by borrowing a session when none is open. */
  cachedBalance(mode: AccountMode): number | null {
    return this.market.cachedBalance(mode);
  }

  balance(mode: AccountMode, timeoutMs?: number): Promise<number | null> {
    return this.market.balance(mode, timeoutMs);
  }

  assets(mode: AccountMode, timeoutMs?: number): Promise<readonly AssetInfo[]> {
    return this.market.assets(mode, timeoutMs);
  }

  price(mode: AccountMode, symbol: string, timeoutMs?: number): Promise<number | null> {
    return this.market.price(mode, symbol, timeoutMs);
  }

  checkSymbol(mode: AccountMode, raw: string): Promise<SymbolCheck> {
    return this.market.checkSymbol(mode, raw);
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
  /** Opens a throwaway session to prove a freshly stored SSID actually works. */
  async testCredentials(
    mode: AccountMode,
    timeoutMs = 25_000,
  ): Promise<{ ok: true; balance: number | null } | { ok: false; error: string }> {
    try {
      return await borrowSession(this.sessions, mode, null, 'test', async (session) => {
        const outcome = session.isReady
          ? { ok: true as const }
          : await awaitEvent<{ ok: true } | { ok: false; error: string }>({
              subscribe: (deliver) => {
                const offReady = session.on('ready', () => deliver({ ok: true }));
                const offFail = session.on('authFailed', (error) => deliver({ ok: false, error }));
                return () => {
                  offReady();
                  offFail();
                };
              },
              timeoutMs,
              onTimeout: () => ({ ok: false, error: 'no response from the broker in time' }),
            });

        if (!outcome.ok) return outcome;
        return { ok: true as const, balance: await this.balance(mode, timeoutMs) };
      });
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private attach(order: Order): void {
    if (this.attachments.has(order.id)) return;

    let session: Session;
    try {
      session = this.sessions.acquire(order.accountMode, order.symbol, order.id);
    } catch (error) {
      const message = errorMessage(error);
      const updated = this.orders.update(order.id, { status: 'failed', note: message });
      if (updated) this.publish({ type: 'failed', order: updated, error: message });
      return;
    }

    session.ensureTimeframe(order.timeframeSeconds);

    const { mode, symbol } = session;
    const unsubscribes = [
      session.on('tick', () => this.onTick(order.id, session)),
      session.on('dealClosed', (deal) => this.onDealClosed(deal, session.client.timeOffset)),
      session.on('ready', () => this.publish({ type: 'session', mode, symbol, state: 'up' })),
      session.on('disconnected', (detail) =>
        this.publish({ type: 'session', mode, symbol, state: 'down', detail }),
      ),
      session.on('authFailed', (detail) => this.publish({ type: 'auth_failed', mode, detail })),
    ];

    this.attachments.set(order.id, {
      session,
      settlementWarned: false,
      detach: () => {
        for (const off of unsubscribes) off();
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
  private async place(order: Order, entryTime: number): Promise<void> {
    const attachment = this.attachments.get(order.id);
    const session = attachment?.session;
    if (!session) {
      this.fail(order, 'no live session for this order');
      return;
    }

    const offset = session.client.timeOffset;
    const minDuration = this.config.limits.minDurationSeconds;
    const { brokerCloseTime, rolledForwardCandles, ...expiry } = resolveExpiry(order, entryTime, minDuration);
    if (rolledForwardCandles > 0) {
      this.logger.info(
        `order ${order.id}: the candle close was under the ${minDuration}s broker minimum, ` +
          `rolling the expiry forward ${rolledForwardCandles} candle(s) to ${brokerCloseTime}`,
      );
    }
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
        const seconds = Math.max(minDuration, Math.round(brokerCloseTime - entryTime));
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
      this.fail(order, errorMessage(error));
    }
  }

  /** Ends an order's life: record the outcome, let the session go, tell whoever is listening. */
  private finish(
    orderId: string,
    patch: Partial<Order>,
    event: (order: Order) => EngineEvent,
  ): void {
    const updated = this.orders.update(orderId, patch);
    this.detach(orderId);
    if (updated) this.publish(event(updated));
  }

  private missed(order: Order, price: number, reason: string): void {
    this.logger.warn(`order ${order.id} missed its entry at ${price}: ${reason}`);
    this.finish(order.id, { status: 'expired', note: reason }, (updated) => ({
      type: 'missed',
      order: updated,
      price,
      reason,
    }));
  }

  private fail(order: Order, message: string): void {
    this.logger.warn(`order ${order.id} failed: ${message}`);
    this.finish(order.id, { status: 'failed', note: message }, (updated) => ({
      type: 'failed',
      order: updated,
      error: message,
    }));
  }

  private onDealClosed(deal: ClosedDeal, offset: number): void {
    const order = this.orders.findByDealId(deal.dealId);
    if (!order || order.closedAt !== null) return;

    const status = deal.profit > 0 ? 'won' : deal.profit < 0 ? 'lost' : 'draw';
    this.logger.info(`order ${order.id} settled ${status} (${deal.profit})`);
    this.finish(
      order.id,
      {
        status,
        profit: deal.profit,
        closePrice: deal.closePrice,
        closedAt: deal.closeTimestamp !== null ? deal.closeTimestamp - offset : nowSeconds(),
      },
      (updated) => ({ type: 'settled', order: updated }),
    );
  }

  /** Once a second, look at every live order and do whatever its state has become due for. */
  private housekeeping(): void {
    const now = nowSeconds();

    for (const [orderId, attachment] of this.attachments) {
      const order = this.orders.get(orderId);
      if (!order) {
        this.detach(orderId);
        continue;
      }

      if (order.status === 'pending') this.expireIfPastDeadline(order, now);
      else if (order.status === 'armed') this.enterIfCandleOpened(order, attachment, now);
      else if (order.status === 'open') this.warnIfSettlementLate(order, attachment, now);
    }
  }

  /** A pending order whose validity ran out never gets its entry, so it ends here. */
  private expireIfPastDeadline(order: Order, now: number): void {
    if (order.validUntil === null || now < order.validUntil) return;
    this.finish(order.id, { status: 'expired', note: 'the trigger price was never reached' }, (updated) => ({
      type: 'expired',
      order: updated,
    }));
  }

  /** An armed order enters on the next candle, even in a symbol quiet enough to send no ticks. */
  private enterIfCandleOpened(order: Order, attachment: Attachment, now: number): void {
    const price = attachment.session.price;
    if (price === null) return;
    const offset = attachment.session.client.timeOffset;
    this.maybeEnterOnNewCandle(order, now + offset, price, offset, attachment.session.tickFollowsGap);
  }

  /** An open trade past its close time with no result yet: nudge the broker and say so once. */
  private warnIfSettlementLate(order: Order, attachment: Attachment, now: number): void {
    if (attachment.settlementWarned || order.closesAt === null) return;
    if (now <= order.closesAt + this.config.engine.orderSettleGraceSeconds) return;

    attachment.settlementWarned = true;
    attachment.session.client.refreshBalance();
    this.logger.warn(`order ${order.id} has not settled ${Math.round(now - order.closesAt)}s after expiry`);
    this.publish({ type: 'settlement_pending', order });
  }
}
