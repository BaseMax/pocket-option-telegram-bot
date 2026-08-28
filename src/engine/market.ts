import { createLogger } from '../logger.ts';
import { errorMessage } from '../util/errors.ts';
import { awaitEvent } from '../util/async.ts';
import { normalizeSymbol, resolveSymbol } from '../pocket/symbols.ts';
import { borrowSession } from './session.ts';
import type { SessionManager, Session } from './session.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { AccountMode } from '../types.ts';
import type { AssetInfo } from '../pocket/protocol.ts';

/** What the broker knows about a symbol the user typed. */
export type SymbolCheck =
  | { state: 'ok'; symbol: string; asset: AssetInfo; twin: AssetInfo | null; corrected: boolean }
  | { state: 'unknown'; input: string; suggestions: AssetInfo[] }
  | { state: 'unverified'; symbol: string; reason: string };

const READY_TIMEOUT_MS = 20_000;
/** How long to wait for a value once the socket is up, before answering with whatever we have. */
const VALUE_TIMEOUT_MS = 8_000;
const TICK_TIMEOUT_MS = 10_000;

/**
 * Read-only questions about the market: balance, asset list, live price.
 *
 * Each one may need a session that no order is holding, so it borrows one under its own holder
 * name and always gives it back; the session manager closes it once it goes idle.
 */
export class MarketData {
  private readonly sessions: SessionManager;
  private readonly settings: SettingsStore;
  private readonly logger = createLogger('market');

  constructor(sessions: SessionManager, settings: SettingsStore) {
    this.sessions = sessions;
    this.settings = settings;
  }

  /** The first live session for this account that already knows the answer, if there is one. */
  private fromLiveSession<T>(mode: AccountMode, read: (session: Session) => T | null): T | null {
    for (const { session } of this.sessions.list()) {
      if (session.mode !== mode) continue;
      const value = read(session);
      if (value !== null) return value;
    }
    return null;
  }

  /** The balance we were last told about, without opening a connection. */
  cachedBalance(mode: AccountMode): number | null {
    return this.fromLiveSession(mode, (session) => session.balance);
  }

  async balance(mode: AccountMode, timeoutMs = READY_TIMEOUT_MS): Promise<number | null> {
    const cached = this.cachedBalance(mode);
    if (cached !== null) return cached;

    return borrowSession(this.sessions, mode, null, 'balance', async (session) => {
      await session.client.waitUntilReady(timeoutMs);
      return awaitEvent<number | null>({
        known: () => session.balance,
        subscribe: (deliver) => session.on('balance', deliver),
        timeoutMs: VALUE_TIMEOUT_MS,
        onTimeout: () => session.balance,
        request: () => session.client.refreshBalance(),
      });
    });
  }

  async assets(mode: AccountMode, timeoutMs = READY_TIMEOUT_MS): Promise<readonly AssetInfo[]> {
    const live = this.fromLiveSession(mode, (session) => (session.assets.length > 0 ? session.assets : null));
    if (live) return live;

    return borrowSession(this.sessions, mode, null, 'assets', async (session) => {
      await session.client.waitUntilReady(timeoutMs);
      return awaitEvent<readonly AssetInfo[]>({
        known: () => (session.assets.length > 0 ? session.assets : null),
        subscribe: (deliver) => session.on('assets', deliver),
        timeoutMs: VALUE_TIMEOUT_MS,
        onTimeout: () => session.assets,
      });
    });
  }

  async price(mode: AccountMode, symbol: string, timeoutMs = READY_TIMEOUT_MS): Promise<number | null> {
    const existing = this.sessions.get(mode, symbol)?.price ?? null;
    if (existing !== null) return existing;

    return borrowSession(this.sessions, mode, symbol, 'price', async (session) => {
      session.ensureTimeframe(this.settings.get('defaultTimeframeSeconds'));
      await session.client.waitUntilReady(timeoutMs);
      return awaitEvent<number | null>({
        known: () => session.price,
        subscribe: (deliver) => session.on('tick', (tick) => deliver(tick.price)),
        timeoutMs: TICK_TIMEOUT_MS,
        onTimeout: () => session.price,
      });
    });
  }

  /** Matches what the user typed against the broker's asset list, correcting near misses. */
  async checkSymbol(mode: AccountMode, raw: string): Promise<SymbolCheck> {
    const symbol = normalizeSymbol(raw);
    try {
      const assets = await this.assets(mode);
      if (assets.length === 0) {
        return { state: 'unverified', symbol, reason: 'the broker sent no asset list' };
      }

      const match = resolveSymbol(raw, assets);
      if (match.status === 'unknown' || !match.asset) {
        return { state: 'unknown', input: match.input, suggestions: match.suggestions };
      }
      return {
        state: 'ok',
        symbol: match.asset.symbol,
        asset: match.asset,
        twin: match.twin,
        corrected: match.status === 'corrected',
      };
    } catch (error) {
      this.logger.warn(`could not verify ${symbol} against the broker asset list`, error);
      return { state: 'unverified', symbol, reason: errorMessage(error) };
    }
  }
}
