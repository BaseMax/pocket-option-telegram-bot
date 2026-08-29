import { Emitter } from '../src/util/emitter.ts';
import { loadConfig } from '../src/config.ts';
import type { AccountMode, NewOrder, Order, Tick } from '../src/types.ts';
import type { AssetInfo, OpenOrderAck, ClosedDeal } from '../src/pocket/protocol.ts';

export const testConfig = loadConfig({
  TELEGRAM_BOT_TOKEN: '123456:test-token-value',
  DB_PATH: ':memory:',
  MIN_DURATION_SECONDS: '5',
} as NodeJS.ProcessEnv);

/** The order every test starts from; pass a patch for whatever the test is actually about. */
export function newOrder(patch: Partial<NewOrder> = {}): NewOrder {
  return {
    chatId: 1,
    accountMode: 'demo',
    symbol: 'GBPAUD_otc',
    direction: 'call',
    triggerPrice: 1.9532,
    triggerMode: 'touch',
    amount: 1,
    expiryMode: 'fixed',
    durationSeconds: 60,
    candleCount: 1,
    timeframeSeconds: 60,
    chartType: 'candle',
    ...patch,
  };
}

/** A stored order, for the pure functions that read one without a database behind them. */
export function storedOrder(patch: Partial<Order> = {}): Order {
  return {
    ...newOrder(),
    id: 'A7K2',
    approachSide: 'below',
    status: 'pending',
    referencePrice: null,
    validUntil: null,
    triggeredPrice: null,
    triggeredAt: null,
    dealId: null,
    openPrice: null,
    openedAt: null,
    closesAt: null,
    closePrice: null,
    closedAt: null,
    profit: null,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

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
  assets: AssetInfo[] = [];
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

export const FAKE_ASSETS: AssetInfo[] = [
  { symbol: 'GBPAUD_otc', name: 'GBP/AUD OTC', payout: 86, isOpen: true },
  { symbol: 'GBPAUD', name: 'GBP/AUD', payout: 50, isOpen: false },
  { symbol: 'EURUSD_otc', name: 'EUR/USD OTC', payout: 92, isOpen: true },
  { symbol: 'EURUSD', name: 'EUR/USD', payout: 50, isOpen: false },
  { symbol: '#AAPL_otc', name: 'Apple OTC', payout: 41, isOpen: true },
];

export class FakeSessionManager {
  readonly sessions = new Map<string, FakeSession>();
  credentials = true;
  assets: AssetInfo[] = [...FAKE_ASSETS];

  hasCredentials(): boolean {
    return this.credentials;
  }
  acquire(mode: AccountMode, symbol: string | null): FakeSession {
    const key = `${mode}:${symbol ?? '*'}`;
    let session = this.sessions.get(key);
    if (!session) {
      session = new FakeSession(mode, symbol);
      session.assets = this.assets;
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
