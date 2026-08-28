import { describe, expect, it } from 'bun:test';
import { normalizeSymbol, parseNumber, parseOrderCommand } from '../src/telegram/parse.ts';
import type { BotSettings } from '../src/storage/settings.ts';

const defaults: BotSettings = {
  defaultAccountMode: 'demo',
  defaultAmount: 1,
  defaultTimeframeSeconds: 60,
  defaultDurationSeconds: 60,
  defaultCandleCount: 1,
  defaultChartType: 'candle',
  defaultTriggerMode: 'touch',
  defaultExpiryMode: 'fixed',
  notifyBalance: true,
  ssid: { demo: '', real: '' },
  uid: { demo: 0, real: 0 },
  owners: [],
};

describe('normalizeSymbol', () => {
  it('matches the broker spelling', () => {
    expect(normalizeSymbol('gbpaud_otc')).toBe('GBPAUD_otc');
    expect(normalizeSymbol('GBPAUD-OTC')).toBe('GBPAUD_otc');
    expect(normalizeSymbol('eur/usd')).toBe('EURUSD');
  });
});

describe('parseNumber', () => {
  it('accepts Persian and Arabic-Indic digits', () => {
    expect(parseNumber('۱.۹۵۳۲')).toBeCloseTo(1.9532, 6);
    expect(parseNumber('١٢٣')).toBe(123);
    expect(parseNumber('1,250')).toBe(1250);
    expect(parseNumber('nope')).toBeNull();
  });
});

describe('parseOrderCommand', () => {
  it('accepts Persian words and mixed case for the choice parameters', () => {
    const result = parseOrderCommand('EURUSD فروش ۱٫۰۸۵۴ dur=۲دقیقه acc=واقعی chart=هایکن entry=بعدی exp=شناور', defaults);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.direction).toBe('put');
    expect(result.order.triggerPrice).toBeCloseTo(1.0854, 6);
    expect(result.order.durationSeconds).toBe(120);
    expect(result.order.accountMode).toBe('real');
    expect(result.order.chartType).toBe('heikin_ashi');
    expect(result.order.triggerMode).toBe('next_candle');
    expect(result.order.expiryMode).toBe('floating');
  });

  it('accepts long unit names and upper case in the time parameters', () => {
    const result = parseOrderCommand('EURUSD BUY 1.08 TF=5MIN DUR=2Hours VALID=1DAY', defaults);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.timeframeSeconds).toBe(300);
    expect(result.order.durationSeconds).toBe(7200);
    expect(result.order.validForSeconds).toBe(86400);
  });

  it('fills every field from the defaults', () => {
    const result = parseOrderCommand('gbpaud_otc buy 1.9532', defaults);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.symbol).toBe('GBPAUD_otc');
    expect(result.order.direction).toBe('call');
    expect(result.order.triggerPrice).toBeCloseTo(1.9532, 6);
    expect(result.order.timeframeSeconds).toBe(60);
    expect(result.order.amount).toBe(1);
    expect(result.order.accountMode).toBe('demo');
  });

  it('reads the optional key=value tail', () => {
    const result = parseOrderCommand(
      'EURUSD sell 1.0854 tf=5m dur=90 amount=7 acc=real entry=next chart=ha valid=30m',
      defaults,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.direction).toBe('put');
    expect(result.order.timeframeSeconds).toBe(300);
    expect(result.order.durationSeconds).toBe(90);
    expect(result.order.expiryMode).toBe('fixed');
    expect(result.order.amount).toBe(7);
    expect(result.order.accountMode).toBe('real');
    expect(result.order.triggerMode).toBe('next_candle');
    expect(result.order.chartType).toBe('heikin_ashi');
    expect(result.order.validForSeconds).toBe(1800);
  });

  it('switches to floating expiry when candles are given', () => {
    const result = parseOrderCommand('EURUSD buy 1.08 candles=2', defaults);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.expiryMode).toBe('floating');
    expect(result.order.candleCount).toBe(2);
  });

  it('accepts Persian direction words', () => {
    const result = parseOrderCommand('EURUSD فروش 1.08', defaults);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.direction).toBe('put');
  });

  it('rejects malformed input with a usable message', () => {
    expect(parseOrderCommand('EURUSD', defaults).ok).toBe(false);
    expect(parseOrderCommand('EURUSD sideways 1.08', defaults).ok).toBe(false);
    expect(parseOrderCommand('EURUSD buy abc', defaults).ok).toBe(false);
    expect(parseOrderCommand('EURUSD buy 1.08 nonsense', defaults).ok).toBe(false);
    expect(parseOrderCommand('EURUSD buy 1.08 wat=1', defaults).ok).toBe(false);
  });
});
