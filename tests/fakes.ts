import { Emitter } from '../src/util/emitter.ts';
import { loadConfig } from '../src/config.ts';
import type { AccountMode, Tick } from '../src/types.ts';
import type { OpenOrderAck, ClosedDeal } from '../src/pocket/protocol.ts';

export const testConfig = loadConfig({
  TELEGRAM_BOT_TOKEN: '123456:test-token-value',
  DB_PATH: ':memory:',
  MIN_DURATION_SECONDS: '5',
} as NodeJS.ProcessEnv);

export interface OpenCall {
  asset: string;
  amount: number;
  action: 'call' | 'put';
  durationSeconds?: number;
  closeAtServerTime?: number;
}

export class FakeSession extends Emitter<Record<string, readonly unknown[]>> {
  price: number | null = null;
  priorPrice: number | null = null;
  lastTickTime: number | null = null;
  tickFollowsGap = false;
  balance: number | null = 500;
  readonly opens: OpenCall[] = [];
  failWith: string | null = null;
  failOnlyCloseAt = false;

  readonly client = {
    timeOffset: 7200,
    refreshBalance: (): void => undefined,
    waitUntilReady: async (): Promise<void> => undefined,
    openOrder: async (params: OpenCall): Promise<OpenOrderAck> => {
      this.opens.push(params);
      if (this.failWith !== null && (!this.failOnlyCloseAt || params.closeAtServerTime !== undefined)) {
        throw new Error(this.failWith);
      }
      return {
        dealId: `deal-${this.opens.length}`,
        requestId: null,
        asset: params.asset,
        amount: params.amount,
        openPrice: this.price,
        openTimestamp: null,
        closeTimestamp: null,
        raw: null,
      };
    },
  };

  constructor(
    readonly mode: AccountMode,
    readonly symbol: string | null,
  ) {
    super();
  }

  ensureTimeframe(): void {}

  get isReady(): boolean {
    return true;
  }
  tick(time: number, price: number, followsGap = false): void {
    this.priorPrice = this.price;
    this.price = price;
    this.lastTickTime = time;
    this.tickFollowsGap = followsGap;
    this.emit('tick', { symbol: this.symbol ?? '', time, price } satisfies Tick);
  }

  settle(deal: ClosedDeal): void {
    this.emit('dealClosed', deal);
  }
}

export class FakeSessionManager {
  readonly sessions = new Map<string, FakeSession>();
  credentials = true;

  hasCredentials(): boolean {
    return this.credentials;
  }
  acquire(mode: AccountMode, symbol: string | null): FakeSession {
    const key = `${mode}:${symbol ?? '*'}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = new FakeSession(mode, symbol);
      this.sessions.set(key, session);
    }
    return session;
  }
  release(): void {}
  get(mode: AccountMode, symbol: string | null): FakeSession | undefined {
    return this.sessions.get(`${mode}:${symbol ?? '*'}`);
  }
  list(): { key: string; session: FakeSession; holders: number }[] {
    return [...this.sessions.entries()].map(([key, session]) => ({ key, session, holders: 1 }));
  }
  resetMode(): void {}
  stopAll(): void {}
}

export const flush = (): Promise<void> => Bun.sleep(5);
