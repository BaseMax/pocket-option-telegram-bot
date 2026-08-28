import type { Database, Statement } from 'bun:sqlite';
import { ACTIVE_STATUSES, type AccountMode, type Order, type NewOrder, type OrderStatus } from '../types.ts';
import { nowSeconds } from '../util/time.ts';
import { createLogger } from '../logger.ts';

type Bindings = Record<string, string | number | boolean | null>;

const logger = createLogger('orders');

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_LENGTH = 4;

interface OrderRow {
  id: string;
  chat_id: number;
  account_mode: string;
  symbol: string;
  direction: string;
  trigger_price: number;
  trigger_mode: string;
  approach_side: string;
  amount: number;
  expiry_mode: string;
  duration_seconds: number;
  candle_count: number;
  timeframe_seconds: number;
  chart_type: string;
  status: string;
  reference_price: number | null;
  valid_until: number | null;
  triggered_price: number | null;
  triggered_at: number | null;
  deal_id: string | null;
  open_price: number | null;
  opened_at: number | null;
  closes_at: number | null;
  close_price: number | null;
  closed_at: number | null;
  profit: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    chatId: row.chat_id,
    accountMode: row.account_mode as AccountMode,
    symbol: row.symbol,
    direction: row.direction as Order['direction'],
    triggerPrice: row.trigger_price,
    triggerMode: row.trigger_mode as Order['triggerMode'],
    approachSide: row.approach_side as Order['approachSide'],
    amount: row.amount,
    expiryMode: row.expiry_mode as Order['expiryMode'],
    durationSeconds: row.duration_seconds,
    candleCount: row.candle_count,
    timeframeSeconds: row.timeframe_seconds,
    chartType: row.chart_type as Order['chartType'],
    status: row.status as OrderStatus,
    referencePrice: row.reference_price,
    validUntil: row.valid_until,
    triggeredPrice: row.triggered_price,
    triggeredAt: row.triggered_at,
    dealId: row.deal_id,
    openPrice: row.open_price,
    openedAt: row.opened_at,
    closesAt: row.closes_at,
    closePrice: row.close_price,
    closedAt: row.closed_at,
    profit: row.profit,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const COLUMN_OF: Record<keyof Order, string> = {
  id: 'id',
  chatId: 'chat_id',
  accountMode: 'account_mode',
  symbol: 'symbol',
  direction: 'direction',
  triggerPrice: 'trigger_price',
  triggerMode: 'trigger_mode',
  approachSide: 'approach_side',
  amount: 'amount',
  expiryMode: 'expiry_mode',
  durationSeconds: 'duration_seconds',
  candleCount: 'candle_count',
  timeframeSeconds: 'timeframe_seconds',
  chartType: 'chart_type',
  status: 'status',
  referencePrice: 'reference_price',
  validUntil: 'valid_until',
  triggeredPrice: 'triggered_price',
  triggeredAt: 'triggered_at',
  dealId: 'deal_id',
  openPrice: 'open_price',
  openedAt: 'opened_at',
  closesAt: 'closes_at',
  closePrice: 'close_price',
  closedAt: 'closed_at',
  profit: 'profit',
  note: 'note',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

export class OrderRepository {
  private readonly db: Database;
  private readonly selectById: Statement<OrderRow, [string]>;
  private readonly selectByDeal: Statement<OrderRow, [string]>;

  constructor(db: Database) {
    this.db = db;
    this.selectById = db.query<OrderRow, [string]>('SELECT * FROM orders WHERE id = ?');
    this.selectByDeal = db.query<OrderRow, [string]>('SELECT * FROM orders WHERE deal_id = ?');
  }

  private generateId(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let id = '';
      for (let i = 0; i < ID_LENGTH; i += 1) {
        id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
      }
      if (!this.selectById.get(id)) return id;
    }
    const fallback = `X${Date.now().toString(36).toUpperCase()}`;
    logger.warn(`could not find a free order id, falling back to ${fallback}`);
    return fallback;
  }

  create(input: NewOrder): Order {
    const now = nowSeconds();
    const order: Order = {
      id: this.generateId(),
      chatId: input.chatId,
      accountMode: input.accountMode,
      symbol: input.symbol,
      direction: input.direction,
      triggerPrice: input.triggerPrice,
      triggerMode: input.triggerMode,
      approachSide: input.approachSide ?? 'any',
      amount: input.amount,
      expiryMode: input.expiryMode,
      durationSeconds: input.durationSeconds,
      candleCount: input.candleCount,
      timeframeSeconds: input.timeframeSeconds,
      chartType: input.chartType,
      status: 'pending',
      referencePrice: input.referencePrice ?? null,
      validUntil: input.validUntil ?? null,
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
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .query(
        `INSERT INTO orders (
           id, chat_id, account_mode, symbol, direction, trigger_price, trigger_mode,
           approach_side, amount, expiry_mode, duration_seconds, candle_count,
           timeframe_seconds, chart_type, status, reference_price, valid_until,
           created_at, updated_at
         ) VALUES (
           $id, $chatId, $accountMode, $symbol, $direction, $triggerPrice, $triggerMode,
           $approachSide, $amount, $expiryMode, $durationSeconds, $candleCount,
           $timeframeSeconds, $chartType, $status, $referencePrice, $validUntil,
           $createdAt, $updatedAt
         )`,
      )
      .run({
        $id: order.id,
        $chatId: order.chatId,
        $accountMode: order.accountMode,
        $symbol: order.symbol,
        $direction: order.direction,
        $triggerPrice: order.triggerPrice,
        $triggerMode: order.triggerMode,
        $approachSide: order.approachSide,
        $amount: order.amount,
        $expiryMode: order.expiryMode,
        $durationSeconds: order.durationSeconds,
        $candleCount: order.candleCount,
        $timeframeSeconds: order.timeframeSeconds,
        $chartType: order.chartType,
        $status: order.status,
        $referencePrice: order.referencePrice,
        $validUntil: order.validUntil,
        $createdAt: order.createdAt,
        $updatedAt: order.updatedAt,
      });

    return order;
  }
  update(id: string, patch: Partial<Omit<Order, 'id' | 'createdAt'>>): Order | null {
    const entries = Object.entries(patch).filter(([key]) => key in COLUMN_OF);
    const assignments: string[] = [];
    const params: Bindings = { $id: id, $updatedAt: nowSeconds() };

    for (const [key, value] of entries) {
      const column = COLUMN_OF[key as keyof Order];
      assignments.push(`${column} = $${key}`);
      params[`$${key}`] = (value ?? null) as Bindings[string];
    }
    assignments.push('updated_at = $updatedAt');

    this.db.query<void, Bindings>(`UPDATE orders SET ${assignments.join(', ')} WHERE id = $id`).run(params);
    return this.get(id);
  }

  get(id: string): Order | null {
    const row = this.selectById.get(id);
    return row ? toOrder(row) : null;
  }

  findByDealId(dealId: string): Order | null {
    const row = this.selectByDeal.get(dealId);
    return row ? toOrder(row) : null;
  }
  listActive(): Order[] {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    return this.db
      .query<OrderRow, string[]>(
        `SELECT * FROM orders WHERE status IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .all(...ACTIVE_STATUSES)
      .map(toOrder);
  }

  listActiveByChat(chatId: number): Order[] {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    return this.db
      .query<OrderRow, (string | number)[]>(
        `SELECT * FROM orders WHERE chat_id = ? AND status IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .all(chatId, ...ACTIVE_STATUSES)
      .map(toOrder);
  }

  listRecentByChat(chatId: number, limit = 15): Order[] {
    return this.db
      .query<OrderRow, [number, number]>(
        'SELECT * FROM orders WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(chatId, limit)
      .map(toOrder);
  }
  summary(chatId: number, sinceUnix: number): { won: number; lost: number; draw: number; profit: number } {
    const row = this.db
      .query<
        { won: number; lost: number; draw: number; profit: number | null },
        [number, number]
      >(
        `SELECT
           SUM(status = 'won')  AS won,
           SUM(status = 'lost') AS lost,
           SUM(status = 'draw') AS draw,
           SUM(COALESCE(profit, 0)) AS profit
         FROM orders
         WHERE chat_id = ? AND closed_at IS NOT NULL AND closed_at >= ?`,
      )
      .get(chatId, sinceUnix);
    return {
      won: row?.won ?? 0,
      lost: row?.lost ?? 0,
      draw: row?.draw ?? 0,
      profit: row?.profit ?? 0,
    };
  }
}
