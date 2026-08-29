import { describe, expect, it } from 'bun:test';
import { applyInput, draftToSpec, freshDraft } from '../src/telegram/wizard/draft.ts';
import { SettingsStore } from '../src/storage/settings.ts';
import { openDatabase } from '../src/storage/db.ts';
import { testConfig } from './fakes.ts';
import type { OrderDraft } from '../src/telegram/wizard/draft.ts';

function draft(): OrderDraft {
  const settings = new SettingsStore(openDatabase(':memory:'), testConfig);
  return freshDraft(settings.all, 1);
}

describe('applyInput', () => {
  it('normalises a symbol and refuses one too short to be real', () => {
    const d = draft();
    expect(applyInput(d, 'symbol', ' gbpaud-otc ')).toBeNull();
    expect(d.symbol).toBe('GBPAUD_otc');

    expect(applyInput(d, 'symbol', 'ab')).toContain('نامعتبر');
    expect(d.symbol).toBe('GBPAUD_otc');
  });

  it('takes a price in either digit set and rejects zero or nonsense', () => {
    const d = draft();
    expect(applyInput(d, 'price', '۱٫۹۵۳۲۰')).toBeNull();
    expect(d.triggerPrice).toBeCloseTo(1.9532, 6);

    expect(applyInput(d, 'price', '0')).toContain('نامعتبر');
    expect(applyInput(d, 'price', 'abc')).toContain('نامعتبر');
    expect(d.triggerPrice).toBeCloseTo(1.9532, 6);
  });

  it('rejects an amount that is not a positive number', () => {
    const d = draft();
    expect(applyInput(d, 'amount', '12.5')).toBeNull();
    expect(d.amount).toBe(12.5);
    expect(applyInput(d, 'amount', '-3')).toContain('نامعتبر');
  });

  it('switches to a fixed expiry when a duration is typed', () => {
    const d = draft();
    d.expiryMode = 'floating';
    expect(applyInput(d, 'duration', '۲ دقیقه')).toBeNull();
    expect(d.durationSeconds).toBe(120);
    expect(d.expiryMode as string).toBe('fixed');
  });

  it('explains the accepted time formats when a duration makes no sense', () => {
    const d = draft();
    const problem = applyInput(d, 'duration', 'soon');
    expect(problem).toContain('نامعتبر');
    expect(problem).toContain('ثانیه');
  });

  it('switches to a floating expiry when a candle count is typed, rounding to whole candles', () => {
    const d = draft();
    expect(applyInput(d, 'candles', '2.6')).toBeNull();
    expect(d.candleCount).toBe(3);
    expect(d.expiryMode).toBe('floating');
    expect(applyInput(d, 'candles', '0')).toContain('نامعتبر');
  });

  it('reads zero validity, in either digit set, as no expiry at all', () => {
    const d = draft();
    expect(applyInput(d, 'valid', '30m')).toBeNull();
    expect(d.validForSeconds).toBe(1800);

    expect(applyInput(d, 'valid', '۰')).toBeNull();
    expect(d.validForSeconds).toBeNull();

    expect(applyInput(d, 'valid', '0')).toBeNull();
    expect(d.validForSeconds).toBeNull();
  });
});

describe('draftToSpec', () => {
  it('refuses a draft that is still missing what the user must type', () => {
    const d = draft();
    expect(draftToSpec(d)).toBeNull();

    d.symbol = 'EURUSD';
    expect(draftToSpec(d)).toBeNull();

    d.triggerPrice = 1.08;
    expect(draftToSpec(d)).toMatchObject({ symbol: 'EURUSD', triggerPrice: 1.08 });
  });

  it('carries every field across and drops the chat id the order does not need', () => {
    const d = draft();
    d.symbol = 'EURUSD';
    d.triggerPrice = 1.08;
    d.amount = 7;
    d.chartType = 'heikin_ashi';

    const spec = draftToSpec(d)!;
    expect(spec).toMatchObject({ amount: 7, chartType: 'heikin_ashi', accountMode: 'demo' });
    expect('chatId' in spec).toBe(false);
  });
});
