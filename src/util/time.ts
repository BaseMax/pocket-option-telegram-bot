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

export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (text === '') return null;

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const value = Math.round(Number(text));
    return value > 0 ? value : null;
  }

  const pattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/g;
  let total = 0;
  let matched = false;
  for (const match of text.matchAll(pattern)) {
    const value = Number(match[1]);
    const unit = match[2] ?? 's';
    if (!Number.isFinite(value)) return null;
    const multiplier = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
    total += value * multiplier;
    matched = true;
  }
  if (!matched || text.replace(pattern, '').trim() !== '') return null;

  const seconds = Math.round(total);
  return seconds > 0 ? seconds : null;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : '', s ? `${s}s` : ''].join('') || '0s';
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

export function formatClock(unixSeconds: number, timeZone: string): string {
  return formatTime(unixSeconds, timeZone).slice(11);
}

export function nowSeconds(): number {
  return Date.now() / 1000;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
