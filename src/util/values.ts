/**
 * Coercions for values that arrive from outside the process: broker frames, stored settings,
 * pasted SSIDs. Everything here answers "is this usable?" with a value or null, never a throw.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

/** A finite number, or null. Strings are accepted, anything else (null, booleans, {}) is not. */
export function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Text, or null. Numbers are spelled out, since brokers send ids both ways. */
export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}
