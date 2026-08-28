import { parseDuration } from '../../util/time.ts';
import { normalizeSymbol, parseNumber } from '../parse.ts';
import { TIME_FORMAT_HINT, type PromptField } from './prompts.ts';
import type { BotSettings } from '../../storage/settings.ts';
import type { AccountMode, ChartType, Direction, ExpiryMode, OrderSpec, TriggerMode } from '../../types.ts';

/** An order the user is still assembling: the same shape as an OrderSpec, minus what is still missing. */
export interface OrderDraft extends Omit<OrderSpec, 'symbol' | 'triggerPrice'> {
  chatId: number;
  symbol: string | null;
  triggerPrice: number | null;
}

/** The values each toggle button steps through, in the order the taps walk them. */
export const DIRECTION_CYCLE: readonly Direction[] = ['call', 'put'];
export const TRIGGER_CYCLE: readonly TriggerMode[] = ['touch', 'next_candle'];
export const EXPIRY_CYCLE: readonly ExpiryMode[] = ['fixed', 'floating'];
export const CHART_CYCLE: readonly ChartType[] = ['candle', 'heikin_ashi', 'line'];
export const ACCOUNT_CYCLE: readonly AccountMode[] = ['demo', 'real'];

export function cycle<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] as T;
}

export function freshDraft(settings: BotSettings, chatId: number): OrderDraft {
  return {
    chatId,
    symbol: null,
    direction: 'call',
    triggerPrice: null,
    triggerMode: settings.defaultTriggerMode,
    timeframeSeconds: settings.defaultTimeframeSeconds,
    chartType: settings.defaultChartType,
    expiryMode: settings.defaultExpiryMode,
    durationSeconds: settings.defaultDurationSeconds,
    candleCount: settings.defaultCandleCount,
    amount: settings.defaultAmount,
    accountMode: settings.defaultAccountMode,
    validForSeconds: null,
  };
}

/** A draft becomes submittable only once the two values the user must type are in. */
export function draftToSpec({ chatId: _chatId, symbol, triggerPrice, ...rest }: OrderDraft): OrderSpec | null {
  if (symbol === null || triggerPrice === null) return null;
  return { ...rest, symbol, triggerPrice };
}

/** Writes one typed answer into the draft, or explains why it was not usable. */
export function applyInput(draft: OrderDraft, field: PromptField, raw: string): string | null {
  const badDuration = (examples: string): string => `${examples}\n\n${TIME_FORMAT_HINT}`;

  switch (field) {
    case 'symbol': {
      const symbol = normalizeSymbol(raw);
      if (symbol.length < 3) return 'نماد نامعتبر است. مثلاً <code>EURUSD</code> یا <code>GBPAUD_otc</code> را بفرستید.';
      draft.symbol = symbol;
      return null;
    }
    case 'price': {
      const price = parseNumber(raw);
      if (price === null || price <= 0) return 'قیمت نامعتبر است. فقط عدد بفرستید، مثلاً <code>1.95320</code>.';
      draft.triggerPrice = price;
      return null;
    }
    case 'amount': {
      const amount = parseNumber(raw);
      if (amount === null || amount <= 0) return 'مبلغ نامعتبر است. فقط عدد بفرستید، مثلاً <code>5</code>.';
      draft.amount = amount;
      return null;
    }
    case 'duration': {
      const seconds = parseDuration(raw);
      if (seconds === null) {
        return badDuration('مدت نامعتبر است. مثلاً <code>60</code> یا <code>1m</code> یا <code>۹۰ ثانیه</code> یا <code>2 دقیقه</code>.');
      }
      draft.durationSeconds = seconds;
      draft.expiryMode = 'fixed';
      return null;
    }
    case 'candles': {
      const count = parseNumber(raw);
      if (count === null || count < 1) return 'تعداد کندل نامعتبر است. یک عدد بزرگ‌تر از صفر بفرستید، مثلاً <code>1</code>.';
      draft.candleCount = Math.round(count);
      draft.expiryMode = 'floating';
      return null;
    }
    case 'valid': {
      const trimmed = raw.trim();
      if (/^[0۰٠]+$/.test(trimmed)) {
        draft.validForSeconds = null;
        return null;
      }
      const seconds = parseDuration(trimmed);
      if (seconds === null) {
        return badDuration(
          'مدت اعتبار نامعتبر است. مثلاً <code>30m</code> یا <code>۳۰ دقیقه</code> یا <code>2h</code> یا <code>1 روز</code>؛ برای بی‌نهایت <code>0</code>.',
        );
      }
      draft.validForSeconds = seconds;
      return null;
    }
    default:
      return 'فیلد ناشناخته.';
  }
}
