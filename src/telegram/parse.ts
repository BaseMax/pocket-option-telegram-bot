import { parseDuration } from '../util/time.ts';
import type { AccountMode, ChartType, Direction, ExpiryMode, TriggerMode } from '../types.ts';
import type { BotSettings } from '../storage/settings.ts';

export interface ParsedOrder {
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

export type ParseResult = { ok: true; order: ParsedOrder } | { ok: false; error: string };

const DIRECTION_ALIASES: Record<string, Direction> = {
  buy: 'call',
  call: 'call',
  up: 'call',
  long: 'call',
  خرید: 'call',
  بالا: 'call',
  sell: 'put',
  put: 'put',
  down: 'put',
  short: 'put',
  فروش: 'put',
  پایین: 'put',
};

const TRIGGER_ALIASES: Record<string, TriggerMode> = {
  touch: 'touch',
  now: 'touch',
  instant: 'touch',
  next: 'next_candle',
  next_candle: 'next_candle',
  candle: 'next_candle',
};

const EXPIRY_ALIASES: Record<string, ExpiryMode> = {
  fixed: 'fixed',
  static: 'fixed',
  float: 'floating',
  floating: 'floating',
  candle: 'floating',
};

const CHART_ALIASES: Record<string, ChartType> = {
  candle: 'candle',
  candles: 'candle',
  ohlc: 'candle',
  ha: 'heikin_ashi',
  heikin: 'heikin_ashi',
  heikin_ashi: 'heikin_ashi',
  line: 'line',
  area: 'line',
};

const ACCOUNT_ALIASES: Record<string, AccountMode> = {
  demo: 'demo',
  practice: 'demo',
  real: 'real',
  live: 'real',
};

export function normalizeSymbol(raw: string): string {
  const upper = raw.trim().toUpperCase().replace(/[\s/-]+/g, '');
  return upper.replace(/_?OTC$/, '_otc');
}

export function parseNumber(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/,/g, '');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseOrderCommand(input: string, defaults: BotSettings): ParseResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) {
    return { ok: false, error: 'ساختار درست: /order SYMBOL buy|sell PRICE [tf=1m dur=60 amount=1 ...]' };
  }

  const [symbolToken, directionToken, priceToken, ...rest] = tokens as [string, string, string, ...string[]];

  const direction = DIRECTION_ALIASES[directionToken.toLowerCase()];
  if (!direction) return { ok: false, error: `جهت معامله نامعتبر است: ${directionToken}` };

  const triggerPrice = parseNumber(priceToken);
  if (triggerPrice === null || triggerPrice <= 0) {
    return { ok: false, error: `قیمت نامعتبر است: ${priceToken}` };
  }

  const order: ParsedOrder = {
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
    const key = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1);

    switch (key) {
      case 'tf':
      case 'timeframe': {
        const seconds = parseDuration(value);
        if (seconds === null) return { ok: false, error: `تایم‌فریم نامعتبر: ${value}` };
        order.timeframeSeconds = seconds;
        break;
      }
      case 'dur':
      case 'duration':
      case 'time': {
        const seconds = parseDuration(value);
        if (seconds === null) return { ok: false, error: `مدت معامله نامعتبر: ${value}` };
        order.durationSeconds = seconds;
        order.expiryMode = 'fixed';
        break;
      }
      case 'candles':
      case 'candle': {
        const count = parseNumber(value);
        if (count === null || count < 1) return { ok: false, error: `تعداد کندل نامعتبر: ${value}` };
        order.candleCount = Math.round(count);
        order.expiryMode = 'floating';
        break;
      }
      case 'amount':
      case 'amt': {
        const amount = parseNumber(value);
        if (amount === null || amount <= 0) return { ok: false, error: `مبلغ نامعتبر: ${value}` };
        order.amount = amount;
        break;
      }
      case 'entry':
      case 'trigger': {
        const mode = TRIGGER_ALIASES[value.toLowerCase()];
        if (!mode) return { ok: false, error: `نحوهٔ ورود نامعتبر: ${value} (touch یا next)` };
        order.triggerMode = mode;
        break;
      }
      case 'exp':
      case 'expiry': {
        const mode = EXPIRY_ALIASES[value.toLowerCase()];
        if (!mode) return { ok: false, error: `نوع انقضا نامعتبر: ${value} (fixed یا float)` };
        order.expiryMode = mode;
        break;
      }
      case 'chart': {
        const chart = CHART_ALIASES[value.toLowerCase()];
        if (!chart) return { ok: false, error: `نوع چارت نامعتبر: ${value}` };
        order.chartType = chart;
        break;
      }
      case 'acc':
      case 'account': {
        const account = ACCOUNT_ALIASES[value.toLowerCase()];
        if (!account) return { ok: false, error: `نوع حساب نامعتبر: ${value} (demo یا real)` };
        order.accountMode = account;
        break;
      }
      case 'valid':
      case 'ttl': {
        const seconds = parseDuration(value);
        if (seconds === null) return { ok: false, error: `مدت اعتبار نامعتبر: ${value}` };
        order.validForSeconds = seconds;
        break;
      }
      default:
        return { ok: false, error: `پارامتر ناشناخته: ${key}` };
    }
  }

  return { ok: true, order };
}
