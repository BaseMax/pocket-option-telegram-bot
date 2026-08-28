import { normalizeDigits, parseDuration } from '../util/time.ts';
import { normalizeSymbol } from '../pocket/symbols.ts';
import type { AccountMode, ChartType, Direction, ExpiryMode, OrderSpec, TriggerMode } from '../types.ts';
import type { BotSettings } from '../storage/settings.ts';

export { normalizeSymbol };

export type ParseResult = { ok: true; order: OrderSpec } | { ok: false; error: string };

/** Lower-cases and unifies the Persian letter shapes so an alias matches however it was typed. */
export function normalizeWord(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u200c\u200e\u200f]/g, '')
    .replace(/\u064a/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9');
}

const DIRECTION_ALIASES: Record<string, Direction> = {
  buy: 'call',
  call: 'call',
  up: 'call',
  long: 'call',
  خرید: 'call',
  بالا: 'call',
  صعودی: 'call',
  sell: 'put',
  put: 'put',
  down: 'put',
  short: 'put',
  فروش: 'put',
  پایین: 'put',
  نزولی: 'put',
};

const TRIGGER_ALIASES: Record<string, TriggerMode> = {
  touch: 'touch',
  now: 'touch',
  instant: 'touch',
  لحظهای: 'touch',
  لحظه: 'touch',
  برخورد: 'touch',
  next: 'next_candle',
  next_candle: 'next_candle',
  candle: 'next_candle',
  بعدی: 'next_candle',
  کندلبعدی: 'next_candle',
};

const EXPIRY_ALIASES: Record<string, ExpiryMode> = {
  fixed: 'fixed',
  static: 'fixed',
  ثابت: 'fixed',
  float: 'floating',
  floating: 'floating',
  candle: 'floating',
  شناور: 'floating',
};

const CHART_ALIASES: Record<string, ChartType> = {
  candle: 'candle',
  candles: 'candle',
  ohlc: 'candle',
  japanese: 'candle',
  کندل: 'candle',
  کندلی: 'candle',
  شمعی: 'candle',
  ha: 'heikin_ashi',
  heikin: 'heikin_ashi',
  heikin_ashi: 'heikin_ashi',
  heikinashi: 'heikin_ashi',
  'heikin-ashi': 'heikin_ashi',
  هایکن: 'heikin_ashi',
  هایکنآشی: 'heikin_ashi',
  line: 'line',
  area: 'line',
  خطی: 'line',
};

const ACCOUNT_ALIASES: Record<string, AccountMode> = {
  demo: 'demo',
  practice: 'demo',
  دمو: 'demo',
  آزمایشی: 'demo',
  تمرینی: 'demo',
  real: 'real',
  live: 'real',
  ریل: 'real',
  واقعی: 'real',
};

/** Shared readers for the choice words, so /set, /mode and /order all accept the same spellings. */
export function parseDirection(raw: string): Direction | undefined {
  return DIRECTION_ALIASES[normalizeWord(raw)];
}

export function parseTriggerMode(raw: string): TriggerMode | undefined {
  return TRIGGER_ALIASES[normalizeWord(raw)];
}

export function parseExpiryMode(raw: string): ExpiryMode | undefined {
  return EXPIRY_ALIASES[normalizeWord(raw)];
}

export function parseChartType(raw: string): ChartType | undefined {
  return CHART_ALIASES[normalizeWord(raw)];
}

export function parseAccountMode(raw: string): AccountMode | undefined {
  return ACCOUNT_ALIASES[normalizeWord(raw)];
}

export function parseNumber(raw: string): number | null {
  const normalized = normalizeDigits(raw.trim())
    .replace(/[,\s]/g, '')
    .replace(/^\+/, '');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

interface ParamHandler {
  /** Every spelling of this parameter accepted in the one-line command. */
  keys: readonly string[];
  /** Applies one `key=value` pair to the order, or says what was wrong with the value. */
  apply(order: OrderSpec, value: string): string | null;
}

/** Builds the handler for a parameter whose value is one word out of a fixed set. */
function choice<K extends keyof OrderSpec>(
  field: K,
  read: (raw: string) => OrderSpec[K] | undefined,
  complaint: string,
): ParamHandler['apply'] {
  return (order, value) => {
    const parsed = read(value);
    if (parsed === undefined) return `${complaint}: ${value}`;
    order[field] = parsed;
    return null;
  };
}

const PARAMS: readonly ParamHandler[] = [
  {
    keys: ['tf', 'timeframe'],
    apply: (order, value) => {
      const seconds = parseDuration(value);
      if (seconds === null) return `تایم‌فریم نامعتبر: ${value}`;
      order.timeframeSeconds = seconds;
      return null;
    },
  },
  {
    keys: ['dur', 'duration', 'time'],
    apply: (order, value) => {
      const seconds = parseDuration(value);
      if (seconds === null) return `مدت معامله نامعتبر: ${value}`;
      order.durationSeconds = seconds;
      order.expiryMode = 'fixed';
      return null;
    },
  },
  {
    keys: ['candles', 'candle'],
    apply: (order, value) => {
      const count = parseNumber(value);
      if (count === null || count < 1) return `تعداد کندل نامعتبر: ${value}`;
      order.candleCount = Math.round(count);
      order.expiryMode = 'floating';
      return null;
    },
  },
  {
    keys: ['amount', 'amt'],
    apply: (order, value) => {
      const amount = parseNumber(value);
      if (amount === null || amount <= 0) return `مبلغ نامعتبر: ${value}`;
      order.amount = amount;
      return null;
    },
  },
  {
    keys: ['valid', 'ttl'],
    apply: (order, value) => {
      const seconds = parseDuration(value);
      if (seconds === null) return `مدت اعتبار نامعتبر: ${value}`;
      order.validForSeconds = seconds;
      return null;
    },
  },
  { keys: ['entry', 'trigger'], apply: choice('triggerMode', parseTriggerMode, 'نحوهٔ ورود نامعتبر (touch یا next)') },
  { keys: ['exp', 'expiry'], apply: choice('expiryMode', parseExpiryMode, 'نوع انقضا نامعتبر (fixed یا float)') },
  { keys: ['chart'], apply: choice('chartType', parseChartType, 'نوع چارت نامعتبر') },
  { keys: ['acc', 'account'], apply: choice('accountMode', parseAccountMode, 'نوع حساب نامعتبر (demo یا real)') },
];

const PARAM_BY_KEY = new Map(PARAMS.flatMap((param) => param.keys.map((key) => [key, param] as const)));

/**
 * Reads the one-line form: `SYMBOL buy|sell PRICE [key=value …]`.
 * Anything the tail leaves alone keeps the user's stored default.
 */
export function parseOrderCommand(input: string, defaults: BotSettings): ParseResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) {
    return { ok: false, error: 'ساختار درست: /order SYMBOL buy|sell PRICE [tf=1m dur=60 amount=1 ...]' };
  }

  const [symbolToken, directionToken, priceToken, ...rest] = tokens as [string, string, string, ...string[]];

  const direction = parseDirection(directionToken);
  if (!direction) return { ok: false, error: `جهت معامله نامعتبر است: ${directionToken}` };

  const triggerPrice = parseNumber(priceToken);
  if (triggerPrice === null || triggerPrice <= 0) {
    return { ok: false, error: `قیمت نامعتبر است: ${priceToken}` };
  }

  const order: OrderSpec = {
    symbol: normalizeSymbol(symbolToken),
    direction,
    triggerPrice,
    triggerMode: defaults.defaultTriggerMode,
    timeframeSeconds: defaults.defaultTimeframeSeconds,
    chartType: defaults.defaultChartType,
    expiryMode: defaults.defaultExpiryMode,
    durationSeconds: defaults.defaultDurationSeconds,
    candleCount: defaults.defaultCandleCount,
    amount: defaults.defaultAmount,
    accountMode: defaults.defaultAccountMode,
    validForSeconds: null,
  };

  for (const token of rest) {
    const separator = token.indexOf('=');
    if (separator < 0) return { ok: false, error: `پارامتر نامعتبر: ${token} (باید به شکل key=value باشد)` };

    const key = normalizeWord(token.slice(0, separator));
    const param = PARAM_BY_KEY.get(key);
    if (!param) return { ok: false, error: `پارامتر ناشناخته: ${key}` };

    const problem = param.apply(order, token.slice(separator + 1));
    if (problem !== null) return { ok: false, error: problem };
  }

  return { ok: true, order };
}
