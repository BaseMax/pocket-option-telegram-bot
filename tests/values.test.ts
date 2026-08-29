import { describe, expect, it } from 'bun:test';
import { asNumber, asRecord, asString, isPlainObject } from '../src/util/values.ts';

describe('isPlainObject / asRecord', () => {
  it('accepts objects and rejects everything else', () => {
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toBeNull();
  });
});

describe('asNumber', () => {
  it('reads numbers and numeric strings', () => {
    expect(asNumber(12.5)).toBe(12.5);
    expect(asNumber('12.5')).toBe(12.5);
    expect(asNumber(0)).toBe(0);
  });

  it('treats a missing value as unknown rather than zero', () => {
    expect(asNumber(null)).toBeNull();
    expect(asNumber(undefined)).toBeNull();
    expect(asNumber('')).toBeNull();
    expect(asNumber('  ')).toBeNull();
    expect(asNumber(true)).toBeNull();
    expect(asNumber({})).toBeNull();
    expect(asNumber(Number.NaN)).toBeNull();
    expect(asNumber(Infinity)).toBeNull();
  });
});

describe('asString', () => {
  it('spells out ids that arrive as numbers', () => {
    expect(asString('abc')).toBe('abc');
    expect(asString(42)).toBe('42');
    expect(asString(null)).toBeNull();
    expect(asString({})).toBeNull();
  });
});
