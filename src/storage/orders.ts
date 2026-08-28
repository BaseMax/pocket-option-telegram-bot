import type { Database, Statement } from 'bun:sqlite';
import { ACTIVE_STATUSES, type NewOrder, type Order } from '../types.ts';
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

/** The single source of truth for how a domain field maps to its column. */
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

const FIELDS = Object.keys(COLUMN_OF) as (keyof Order)[];

const ACTIVE_PLACEHOLDERS = ACTIVE_STATUSES.map(() => '?').join(', ');

/** Rebuilds the domain object from a row, one field per entry in COLUMN_OF. */
function toOrder(row: OrderRow): Order {
  const order = {} as Record<keyof Order, unknown>;
  for (const field of FIELDS) order[field] = row[COLUMN_OF[field] as keyof OrderRow];
  return order as Order;
}

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
      ...input,
      id: this.generateId(),
      approachSide: input.approachSide ?? 'any',
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

    const params: Bindings = {};
    for (const field of FIELDS) params[`$${field}`] = (order[field] ?? null) as Bindings[string];

    this.db
      .query<void, Bindings>(
        `INSERT INTO orders (${FIELDS.map((field) => COLUMN_OF[field]).join(', ')})
         VALUES (${FIELDS.map((field) => `$${field}`).join(', ')})`,
      )
      .run(params);

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
    return this.db
      .query<OrderRow, string[]>(
        `SELECT * FROM orders WHERE status IN (${ACTIVE_PLACEHOLDERS}) ORDER BY created_at ASC`,
      )
      .all(...ACTIVE_STATUSES)
      .map(toOrder);
  }

  listActiveByChat(chatId: number): Order[] {
    return this.db
      .query<OrderRow, (string | number)[]>(
        `SELECT * FROM orders WHERE chat_id = ? AND status IN (${ACTIVE_PLACEHOLDERS}) ORDER BY created_at ASC`,
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
