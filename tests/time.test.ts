import { describe, expect, it } from 'bun:test';
import {
  candleCloseTime,
  candleOpenTime,
  formatDuration,
  formatTime,
  nthCandleCloseTime,
  parseDuration,
  timeframeLabel,
} from '../src/util/time.ts';

describe('parseDuration', () => {
  it('understands bare seconds and suffixed units', () => {
    expect(parseDuration('60')).toBe(60);
    expect(parseDuration('31s')).toBe(31);
    expect(parseDuration('1m')).toBe(60);
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('1.5m')).toBe(90);
  });

  it('rejects nonsense', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('-5')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('round-trips through parseDuration', () => {
    for (const seconds of [5, 31, 60, 90, 3600, 5400]) {
      expect(parseDuration(formatDuration(seconds))).toBe(seconds);
    }
  });
});

describe('candle boundaries', () => {
  const t = 1787911237;

  it('aligns to the timeframe grid', () => {
    expect(candleOpenTime(t, 60) % 60).toBe(0);
    expect(candleCloseTime(t, 60) - candleOpenTime(t, 60)).toBe(60);
    expect(candleOpenTime(t, 300) % 300).toBe(0);
  });

  it('counts the containing candle as the first', () => {
    expect(nthCandleCloseTime(t, 60, 1)).toBe(candleCloseTime(t, 60));
    expect(nthCandleCloseTime(t, 60, 3)).toBe(candleOpenTime(t, 60) + 180);
  });
});

describe('timeframeLabel', () => {
  it('names known timeframes and falls back for odd ones', () => {
    expect(timeframeLabel(60)).toBe('1m');
    expect(timeframeLabel(300)).toBe('5m');
    expect(timeframeLabel(45)).toBe('45s');
  });
});

describe('formatTime', () => {
  it('renders in the requested timezone', () => {
    expect(formatTime(0, 'UTC')).toBe('1970-01-01 00:00:00');
    expect(formatTime(0, 'Asia/Tehran')).toBe('1970-01-01 03:30:00');
  });
});
