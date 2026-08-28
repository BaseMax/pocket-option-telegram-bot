export type AccountMode = 'demo' | 'real';

export type Direction = 'call' | 'put';

export type TriggerMode = 'touch' | 'next_candle';

export type ExpiryMode = 'fixed' | 'floating';

export type ChartType = 'candle' | 'heikin_ashi' | 'line';

export type ApproachSide = 'above' | 'below' | 'any';

export type OrderStatus =
  | 'pending'
  | 'armed'
  | 'placing'
  | 'open'
  | 'won'
  | 'lost'
  | 'draw'
  | 'cancelled'
  | 'failed'
  | 'expired';

export const ACTIVE_STATUSES: readonly OrderStatus[] = ['pending', 'armed', 'placing', 'open'];

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'won',
  'lost',
  'draw',
  'cancelled',
  'failed',
  'expired',
];

/**
 * What the user asked for, before the engine turns it into a stored Order.
 * The one-line command, the wizard panel and the order submitter all speak this shape.
 */
export interface OrderSpec {
  symbol: string;
  direction: Direction;
  triggerPrice: number;
  triggerMode: TriggerMode;
  timeframeSeconds: number;
  chartType: ChartType;
  expiryMode: ExpiryMode;
  durationSeconds: number;
  candleCount: number;
  amount: number;
  accountMode: AccountMode;
  validForSeconds: number | null;
}

export interface Order {
  id: string;
  chatId: number;
  accountMode: AccountMode;

  symbol: string;
  direction: Direction;

  triggerPrice: number;
  triggerMode: TriggerMode;
  approachSide: ApproachSide;

  amount: number;

  expiryMode: ExpiryMode;
  durationSeconds: number;
  candleCount: number;
  timeframeSeconds: number;
  chartType: ChartType;

  status: OrderStatus;
  referencePrice: number | null;
  validUntil: number | null;
  triggeredPrice: number | null;
  triggeredAt: number | null;
  dealId: string | null;
  openPrice: number | null;
  openedAt: number | null;
  closesAt: number | null;

  closePrice: number | null;
  closedAt: number | null;
  profit: number | null;
  note: string | null;

  createdAt: number;
  updatedAt: number;
}

export type NewOrder = Pick<
  Order,
  | 'chatId'
  | 'accountMode'
  | 'symbol'
  | 'direction'
  | 'triggerPrice'
  | 'triggerMode'
  | 'amount'
  | 'expiryMode'
  | 'durationSeconds'
  | 'candleCount'
  | 'timeframeSeconds'
  | 'chartType'
> &
  Partial<Pick<Order, 'validUntil' | 'referencePrice' | 'approachSide'>>;

export interface Tick {
  symbol: string;
  time: number;
  price: number;
}

export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ticks: number;
  live: boolean;
}
