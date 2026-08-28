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
        const mode = parseTriggerMode(value);
        if (!mode) return { ok: false, error: `نحوهٔ ورود نامعتبر: ${value} (touch یا next)` };
        order.triggerMode = mode;
        break;
      }
      case 'exp':
      case 'expiry': {
        const mode = parseExpiryMode(value);
        if (!mode) return { ok: false, error: `نوع انقضا نامعتبر: ${value} (fixed یا float)` };
        order.expiryMode = mode;
        break;
      }
      case 'chart': {
        const chart = parseChartType(value);
        if (!chart) return { ok: false, error: `نوع چارت نامعتبر: ${value}` };
        order.chartType = chart;
        break;
      }
      case 'acc':
      case 'account': {
        const account = parseAccountMode(value);
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
