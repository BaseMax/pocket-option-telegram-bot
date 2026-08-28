import { PocketOptionClient } from '../pocket/client.ts';
import { CandleSeries } from '../pocket/candles.ts';
import { Emitter } from '../util/emitter.ts';
import { createLogger, type Logger } from '../logger.ts';
import { parseSsid, type AuthPayload } from '../util/ssid.ts';
import type { AppConfig } from '../config.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { AccountMode, Candle, Tick } from '../types.ts';
import type { AssetInfo, ClosedDeal, OpenOrderAck } from '../pocket/protocol.ts';

export class MissingCredentialsError extends Error {
  readonly mode: AccountMode;
  constructor(mode: AccountMode) {
    super(`no Pocket Option session configured for the ${mode} account`);
    this.mode = mode;
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
  readonly mode: AccountMode;
  readonly symbol: string | null;
  readonly client: PocketOptionClient;

  private readonly logger: Logger;
  private readonly series = new Map<number, CandleSeries>();
  private lastTick: Tick | null = null;
  private previousPrice: number | null = null;
  private lostData = false;
  private followsGap = false;
  private readonly maxTickGapSeconds: number;

  constructor(mode: AccountMode, symbol: string | null, auth: AuthPayload, config: AppConfig) {
    super();
    this.mode = mode;
    this.symbol = symbol;
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
    this.client.on('history', ({ symbol, ticks }) => {
      if (symbol !== this.symbol) return;
      this.logger.debug(`seeded ${ticks.length} historical ticks`);
      for (const series of this.series.values()) series.seed(ticks);
      const last = ticks[ticks.length - 1];
      if (last) this.lastTick = last;
    });
    this.client.on('tick', (tick) => {
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
    });
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

/**
 * Borrows a session for one question and always gives it back, so a query never keeps a
 * connection alive after it is done with it.
 */
export async function borrowSession<T>(
  sessions: SessionManager,
  mode: AccountMode,
  symbol: string | null,
  label: string,
  ask: (session: Session) => Promise<T>,
): Promise<T> {
  const holder = `${label}:${Date.now()}`;
  const session = sessions.acquire(mode, symbol, holder);
  try {
    return await ask(session);
  } finally {
    sessions.release(mode, symbol, holder);
  }
}

interface SessionEntry {
  session: Session;
  holders: Set<string>;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

export class SessionManager {
  private readonly config: AppConfig;
  private readonly settings: SettingsStore;
  private readonly logger = createLogger('sessions');
  private readonly entries = new Map<string, SessionEntry>();

  constructor(config: AppConfig, settings: SettingsStore) {
    this.config = config;
    this.settings = settings;
  }

  private static key(mode: AccountMode, symbol: string | null): string {
    return `${mode}:${symbol ?? '*'}`;
  }
  private authFor(mode: AccountMode): AuthPayload {
    const raw = this.settings.get('ssid')[mode] || this.config.pocket.ssid[mode];
    if (!raw) throw new MissingCredentialsError(mode);
    const uid = this.settings.get('uid')[mode] || this.config.pocket.uid[mode];
    return parseSsid(raw, mode, uid);
  }

  hasCredentials(mode: AccountMode): boolean {
    return Boolean(this.settings.get('ssid')[mode] || this.config.pocket.ssid[mode]);
  }
  acquire(mode: AccountMode, symbol: string | null, holder: string): Session {
    const key = SessionManager.key(mode, symbol);
    let entry = this.entries.get(key);

    if (!entry) {
      const session = new Session(mode, symbol, this.authFor(mode), this.config);
      entry = { session, holders: new Set(), disposeTimer: null };
      this.entries.set(key, entry);
      this.logger.info(`opening session ${key}`);
      session.start();
    }

    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    entry.holders.add(holder);
    return entry.session;
  }

  release(mode: AccountMode, symbol: string | null, holder: string): void {
    const key = SessionManager.key(mode, symbol);
    const entry = this.entries.get(key);
    if (!entry) return;

    entry.holders.delete(holder);
    if (entry.holders.size > 0 || entry.disposeTimer) return;
    entry.disposeTimer = setTimeout(() => {
      if (entry.holders.size > 0) return;
      this.logger.info(`closing idle session ${key}`);
      entry.session.stop();
      this.entries.delete(key);
    }, this.config.engine.sessionIdleTtlSeconds * 1000);
  }
  resetMode(mode: AccountMode): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.session.mode !== mode) continue;
      if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
      this.logger.info(`recycling session ${key} after a credentials change`);
      entry.session.stop();
      this.entries.delete(key);
    }
  }

  get(mode: AccountMode, symbol: string | null): Session | undefined {
    return this.entries.get(SessionManager.key(mode, symbol))?.session;
  }

  list(): { key: string; session: Session; holders: number }[] {
    return [...this.entries.entries()].map(([key, entry]) => ({
      key,
      session: entry.session,
      holders: entry.holders.size,
    }));
  }

  stopAll(): void {
    for (const [key, entry] of this.entries) {
      if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
      entry.session.stop();
      this.entries.delete(key);
    }
  }
}
