import { PocketOptionClient } from '../pocket/client.ts';
import { CandleSeries } from '../pocket/candles.ts';
import { Emitter } from '../util/emitter.ts';
import { createLogger, type Logger } from '../logger.ts';
import type { AuthPayload } from '../util/ssid.ts';
import type { AppConfig } from '../config.ts';
import type { AccountMode, Candle, Tick } from '../types.ts';
import type { AssetInfo, ClosedDeal, OpenOrderAck } from '../pocket/protocol.ts';

export class MissingCredentialsError extends Error {
  constructor(readonly mode: AccountMode) {
    super(`no Pocket Option session configured for the ${mode} account`);
  }
}

interface SessionEvents extends Record<string, readonly unknown[]> {
  tick: [Tick];
  ready: [];
  disconnected: [string];
  balance: [number];
  dealClosed: [ClosedDeal];
  assets: [AssetInfo[]];
  orderAccepted: [OpenOrderAck];
  authFailed: [string];
}

export class Session extends Emitter<SessionEvents> {
  readonly client: PocketOptionClient;

  private readonly logger: Logger;
  private readonly series = new Map<number, CandleSeries>();
  private lastTick: Tick | null = null;
  private previousPrice: number | null = null;
  private lostData = false;
  private followsGap = false;
  private readonly maxTickGapSeconds: number;

  constructor(
    readonly mode: AccountMode,
    readonly symbol: string | null,
    auth: AuthPayload,
    config: AppConfig,
  ) {
    super();
    this.logger = createLogger(`session:${mode}/${symbol ?? 'control'}`);
    this.maxTickGapSeconds = config.engine.maxTickGapSeconds;

    this.client = new PocketOptionClient({
      mode,
      auth,
      servers: config.pocket.servers[mode],
      serverTimeOffset: config.pocket.serverTimeOffset,
      label: `${mode}/${symbol ?? 'control'}`,
      ackTimeoutMs: config.engine.orderAckTimeoutSeconds * 1000,
    });

    this.client.on('authenticated', () => {
      if (this.symbol) this.client.subscribe(this.symbol, this.primaryPeriod());
      this.emit('ready');
    });
    this.client.on('disconnected', (reason) => {
      this.lostData = true;
      this.emit('disconnected', reason);
    });
    this.client.on('authFailed', (reason) => this.emit('authFailed', reason));
    this.client.on('balance', (balance) => this.emit('balance', balance));
    this.client.on('assets', (assets) => this.emit('assets', assets));
    this.client.on('dealClosed', (deal) => this.emit('dealClosed', deal));
    this.client.on('orderAccepted', (ack) => this.emit('orderAccepted', ack));
    this.client.on('history', (history) => this.onHistory(history));
    this.client.on('tick', (tick) => this.onTick(tick));
  }

  /** Historical ticks arrive once per subscription and seed every candle series we keep. */
  private onHistory({ symbol, ticks }: { symbol: string; ticks: Tick[] }): void {
    if (symbol !== this.symbol) return;
    this.logger.debug(`seeded ${ticks.length} historical ticks`);
    for (const series of this.series.values()) series.seed(ticks);
    const last = ticks[ticks.length - 1];
    if (last) this.lastTick = last;
  }

  /**
   * A live tick. A long silence or a dropped socket means the price may have moved through a
   * trigger unseen, so the tick that resumes the stream is flagged and the engine treats orders
   * that would enter on it as missed rather than entering at a price that is no longer real.
   */
  private onTick(tick: Tick): void {
    if (tick.symbol !== this.symbol) return;

    const previousTime = this.lastTick?.time ?? null;
    const silence = previousTime === null ? 0 : tick.time - previousTime;
    this.followsGap = this.lostData || silence > this.maxTickGapSeconds;
    if (this.followsGap && previousTime !== null) {
      this.logger.warn(
        `resuming after a ${Math.round(silence)}s gap in the price stream; ` +
          'orders that would enter on this tick are treated as missed',
      );
    }

    this.lostData = false;
    this.previousPrice = this.lastTick?.price ?? null;
    this.lastTick = tick;
    for (const series of this.series.values()) series.addTick(tick);
    this.emit('tick', tick);
  }

  start(): void {
    this.client.start();
  }

  stop(): void {
    this.client.stop();
    this.removeAllListeners();
  }

  get isReady(): boolean {
    return this.client.isReady;
  }

  get isAuthRejected(): boolean {
    return this.client.isAuthRejected;
  }

  get assets(): readonly AssetInfo[] {
    return this.client.assets;
  }

  get balance(): number | null {
    return this.client.balance;
  }

  get price(): number | null {
    return this.lastTick?.price ?? null;
  }

  get lastTickTime(): number | null {
    return this.lastTick?.time ?? null;
  }
  get priorPrice(): number | null {
    return this.previousPrice;
  }

  get tickFollowsGap(): boolean {
    return this.followsGap;
  }
  private primaryPeriod(): number {
    if (this.series.size === 0) return 60;
    return Math.min(...this.series.keys());
  }

  ensureTimeframe(timeframeSeconds: number): CandleSeries {
    const existing = this.series.get(timeframeSeconds);
    if (existing) return existing;

    const created = new CandleSeries(timeframeSeconds);
    this.series.set(timeframeSeconds, created);
    if (this.symbol && this.client.isReady) {
      this.client.subscribe(this.symbol, this.primaryPeriod());
    }
    return created;
  }

  candles(timeframeSeconds: number): Candle[] {
    return this.series.get(timeframeSeconds)?.snapshot() ?? [];
  }

  currentCandle(timeframeSeconds: number): Candle | null {
    return this.series.get(timeframeSeconds)?.currentCandle ?? null;
  }
}
