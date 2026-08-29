export const TIMEFRAMES: readonly { label: string; seconds: number }[] = [
  { label: '5s', seconds: 5 },
  { label: '10s', seconds: 10 },
  { label: '15s', seconds: 15 },
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '2m', seconds: 120 },
  { label: '3m', seconds: 180 },
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
  { label: '4h', seconds: 14400 },
];

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Every spelling of a time unit we accept, in English and Persian, mapped to its length in seconds. */
const DURATION_UNITS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  ث: 1,
  ثانیه: 1,
  ثانیهها: 1,
  ثانیهای: 1,
  m: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  minute: MINUTE,
  minutes: MINUTE,
  د: MINUTE,
  دق: MINUTE,
  دقیقه: MINUTE,
  دقیقهها: MINUTE,
  دقیقهای: MINUTE,
  دقایق: MINUTE,
  h: HOUR,
  hr: HOUR,
  hrs: HOUR,
  hour: HOUR,
  hours: HOUR,
  س: HOUR,
  ساعت: HOUR,
  ساعتها: HOUR,
  ساعته: HOUR,
  d: DAY,
  day: DAY,
  days: DAY,
  ر: DAY,
  روز: DAY,
  روزها: DAY,
  روزه: DAY,
  w: WEEK,
  wk: WEEK,
  wks: WEEK,
  week: WEEK,
  weeks: WEEK,
  هفته: WEEK,
  هفتهها: WEEK,
  هفتهای: WEEK,
  mo: MONTH,
  mon: MONTH,
  mons: MONTH,
  month: MONTH,
  months: MONTH,
  ماه: MONTH,
  ماهها: MONTH,
  ماهه: MONTH,
  y: YEAR,
  yr: YEAR,
  yrs: YEAR,
  year: YEAR,
  years: YEAR,
  سال: YEAR,
  سالها: YEAR,
  ساله: YEAR,
};

/** Persian and Arabic-Indic digits and separators, rewritten to their ASCII shape. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '');
}

/** Lower-cases, unifies digits and Persian letter shapes, and turns every "and" spelling into a space. */
function normalizeDurationText(input: string): string {
  return normalizeDigits(input)
    .toLowerCase()
    .replace(/[‌‏‎]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[,+&،؛;]/g, ' ')
    .replace(/(^|\s)(و|and)(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reads a human duration and returns whole seconds.
 * Accepts `90`, `1m`, `1M`, `۳۰ دقیقه`, `1h 30m`, `2 ساعت و 15 دقیقه`, `3 days`, `1 ماه`.
 * A bare number counts as seconds. Returns null when anything in the text is not a number plus a unit.
 */
export function parseDuration(input: string): number | null {
  const text = normalizeDurationText(input);
  if (text === '') return null;

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const value = Math.round(Number(text));
    return value > 0 ? value : null;
  }

  const pattern = /(\d+(?:\.\d+)?)\s*([a-z؀-ۿ]*)/g;
  let total = 0;
  let matched = false;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (text.slice(cursor, match.index).trim() !== '') return null;
    cursor = match.index + match[0].length;

    const value = Number(match[1]);
    const word = match[2] ?? '';
    const multiplier = word === '' ? 1 : DURATION_UNITS[word];
    if (!Number.isFinite(value) || multiplier === undefined) return null;
    total += value * multiplier;
    matched = true;
  }
  if (!matched || text.slice(cursor).trim() !== '') return null;

  const seconds = Math.round(total);
  return seconds > 0 ? seconds : null;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const d = Math.floor(seconds / DAY);
  const h = Math.floor((seconds % DAY) / HOUR);
  const m = Math.floor((seconds % HOUR) / MINUTE);
  const s = seconds % MINUTE;
  return [d ? `${d}d` : '', h ? `${h}h` : '', m ? `${m}m` : '', s ? `${s}s` : ''].join('') || '0s';
}

const FA_UNITS: readonly { seconds: number; name: string }[] = [
  { seconds: DAY, name: 'روز' },
  { seconds: HOUR, name: 'ساعت' },
  { seconds: MINUTE, name: 'دقیقه' },
  { seconds: 1, name: 'ثانیه' },
];

/** The same duration spelled out in Persian, for panels and messages the user reads. */
export function formatDurationFa(seconds: number): string {
  let rest = Math.max(0, Math.round(seconds));
  if (rest === 0) return '0 ثانیه';

  const parts: string[] = [];
  for (const unit of FA_UNITS) {
    const count = Math.floor(rest / unit.seconds);
    if (count > 0) parts.push(`${count} ${unit.name}`);
    rest -= count * unit.seconds;
  }
  return parts.join(' و ');
}

export function timeframeLabel(seconds: number): string {
  return TIMEFRAMES.find((t) => t.seconds === seconds)?.label ?? formatDuration(seconds);
}

export function candleOpenTime(time: number, timeframeSeconds: number): number {
  return Math.floor(time / timeframeSeconds) * timeframeSeconds;
}

export function candleCloseTime(time: number, timeframeSeconds: number): number {
  return candleOpenTime(time, timeframeSeconds) + timeframeSeconds;
}

export function nthCandleCloseTime(time: number, timeframeSeconds: number, count: number): number {
  return candleOpenTime(time, timeframeSeconds) + timeframeSeconds * Math.max(1, count);
}

export function formatTime(unixSeconds: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(Math.round(unixSeconds * 1000)));

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}


export function nowSeconds(): number {
  return Date.now() / 1000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
