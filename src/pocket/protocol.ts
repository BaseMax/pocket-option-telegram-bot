import { createLogger } from '../logger.ts';
import { asNumber, asRecord, asString } from '../util/values.ts';
import type { Tick } from '../types.ts';

const logger = createLogger('protocol');

export const OUT = {
  handshake: '40',
  auth: 'auth',
  userInit: 'user_init',
  ping: '3',
  playerState: 'ps',
  subscribe: 'subfor',
  unsubscribe: 'unsubfor',
  changeSymbol: 'changeSymbol',
  loadHistoryPeriod: 'loadHistoryPeriod',
  openOrder: 'openOrder',
} as const;

export const IN = {
  sid: 'sid',
  successauth: 'successauth',
  authSuccess: 'auth/success',
  authError: 'auth/error',
  notAuthorized: 'NotAuthorized',
  updateStream: 'updateStream',
  updateAssets: 'updateAssets',
  updateBalance: 'updateBalance',
  successupdateBalance: 'successupdateBalance',
  successopenOrder: 'successopenOrder',
  failopenOrder: 'failopenOrder',
  successcloseOrder: 'successcloseOrder',
  updateClosedDeals: 'updateClosedDeals',
  updateHistoryNew: 'updateHistoryNew',
  loadHistoryPeriod: 'loadHistoryPeriod',
} as const;

export interface OpenOrderRequest {
  asset: string;
  amount: number;
  action: 'call' | 'put';
  isDemo: 0 | 1;
  requestId: number;
  optionType: number;
  time?: number;
  closeAt?: number;
}

export interface OpenOrderAck {
  dealId: string;
  requestId: number | null;
  asset: string | null;
  amount: number | null;
  openPrice: number | null;
  openTimestamp: number | null;
  closeTimestamp: number | null;
  raw: unknown;
}

export interface ClosedDeal {
  dealId: string;
  asset: string | null;
  profit: number;
  amount: number | null;
  closePrice: number | null;
  closeTimestamp: number | null;
  raw: unknown;
}

export interface AssetInfo {
  symbol: string;
  name: string;
  payout: number | null;
  isOpen: boolean;
}

export function decodeFrame(arg: unknown): unknown {
  if (arg instanceof Uint8Array || Buffer.isBuffer(arg)) {
    try {
      return JSON.parse(Buffer.from(arg as Uint8Array).toString('utf8'));
    } catch (error) {
      logger.debug('binary frame was not JSON', error);
      return null;
    }
  }
  return arg ?? null;
}

export function parseTicks(frame: unknown): Tick[] {
  if (!Array.isArray(frame)) return [];
  const out: Tick[] = [];
  for (const entry of frame) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const symbol = asString(entry[0]);
    const time = asNumber(entry[1]);
    const price = asNumber(entry[2]);
    if (symbol === null || time === null || price === null) continue;
    out.push({ symbol, time, price });
  }
  return out;
}

export function parseHistory(frame: unknown): { symbol: string; period: number; ticks: Tick[] } | null {
  const obj = asRecord(frame);
  if (!obj) return null;
  const symbol = asString(obj['asset']);
  if (symbol === null) return null;
  const period = asNumber(obj['period']) ?? 0;
  const raw = obj['history'] ?? obj['data'];
  const ticks: Tick[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const time = asNumber(entry[0]);
        const price = asNumber(entry[1]);
        if (time !== null && price !== null) ticks.push({ symbol, time, price });
        continue;
      }
      const point = asRecord(entry);
      if (point) {
        const time = asNumber(point['time']);
        const price = asNumber(point['price'] ?? point['close']);
        if (time !== null && price !== null) ticks.push({ symbol, time, price });
      }
    }
  }
  ticks.sort((a, b) => a.time - b.time);
  return { symbol, period, ticks };
}

export function parseBalance(frame: unknown): number | null {
  const obj = asRecord(frame);
  if (!obj) return asNumber(frame);
  return asNumber(obj['balance']);
}

export function parseOpenOrderAck(frame: unknown): OpenOrderAck | null {
  const obj = asRecord(frame);
  if (!obj) return null;
  const dealId = asString(obj['id']);
  if (dealId === null) return null;
  return {
    dealId,
    requestId: asNumber(obj['requestId']),
    asset: asString(obj['asset']),
    amount: asNumber(obj['amount']),
    openPrice: asNumber(obj['openPrice']),
    openTimestamp: asNumber(obj['openTimestamp'] ?? obj['openTime']),
    closeTimestamp: asNumber(obj['closeTimestamp'] ?? obj['closeTime']),
    raw: frame,
  };
}

export function parseOpenOrderFailure(frame: unknown): { requestId: number | null; error: string } {
  const obj = asRecord(frame);
  if (!obj) return { requestId: null, error: typeof frame === 'string' ? frame : 'unknown error' };
  const message =
    asString(obj['error']) ?? asString(obj['message']) ?? asString(obj['reason']) ?? JSON.stringify(frame);
  return { requestId: asNumber(obj['requestId']), error: message };
}

function parseDeal(entry: unknown): ClosedDeal | null {
  const obj = asRecord(entry);
  if (!obj) return null;
  const dealId = asString(obj['id']);
  const profit = asNumber(obj['profit']);
  if (dealId === null || profit === null) return null;
  return {
    dealId,
    asset: asString(obj['asset']),
    profit,
    amount: asNumber(obj['amount']),
    closePrice: asNumber(obj['closePrice']),
    closeTimestamp: asNumber(obj['closeTimestamp'] ?? obj['closeTime']),
    raw: entry,
  };
}

export function parseClosedDeals(frame: unknown): ClosedDeal[] {
  const list = Array.isArray(frame) ? frame : (asRecord(frame)?.['deals'] ?? null);
  if (!Array.isArray(list)) return [];
  const out: ClosedDeal[] = [];
  for (const entry of list) {
    const deal = parseDeal(entry);
    if (deal) out.push(deal);
  }
  return out;
}

export function parseAssets(frame: unknown): AssetInfo[] {
  if (!Array.isArray(frame)) return [];
  const out: AssetInfo[] = [];
  for (const entry of frame) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const symbol = asString(entry[1]);
    if (symbol === null) continue;
    const openFlag = entry.find((v, i) => i >= 12 && typeof v === 'boolean');
    out.push({
      symbol,
      name: asString(entry[2]) ?? symbol,
      payout: asNumber(entry[5]),
      isOpen: typeof openFlag === 'boolean' ? openFlag : true,
    });
  }
  return out;
}
