import { describe, expect, it } from 'bun:test';
import { describeSymbolCheck } from '../src/telegram/symbol-check.ts';
import type { AssetInfo } from '../src/pocket/protocol.ts';

const asset = (patch: Partial<AssetInfo> = {}): AssetInfo => ({
  symbol: 'EURUSD',
  name: 'Euro/Dollar',
  payout: 80,
  isOpen: true,
  ...patch,
});

describe('describeSymbolCheck', () => {
  it('accepts a known open symbol without comment', () => {
    const verdict = describeSymbolCheck({
      state: 'ok',
      symbol: 'EURUSD',
      asset: asset(),
      twin: null,
      corrected: false,
    });
    expect(verdict).toEqual({ symbol: 'EURUSD', problem: null, note: null });
  });

  it('says when it corrected the spelling', () => {
    const verdict = describeSymbolCheck({
      state: 'ok',
      symbol: 'GBPAUD_otc',
      asset: asset({ symbol: 'GBPAUD_otc' }),
      twin: null,
      corrected: true,
    });
    expect(verdict.problem).toBeNull();
    expect(verdict.note).toContain('نماد اصلاح شد');
  });

  it('warns about a closed market and points at the open twin', () => {
    const verdict = describeSymbolCheck({
      state: 'ok',
      symbol: 'EURUSD',
      asset: asset({ isOpen: false }),
      twin: asset({ symbol: 'EURUSD_otc' }),
      corrected: false,
    });
    expect(verdict.problem).toBeNull();
    expect(verdict.note).toContain('بازار این نماد الان بسته است');
    expect(verdict.note).toContain('EURUSD_otc');
  });

  it('blocks an unknown symbol and lists what it might have meant', () => {
    const verdict = describeSymbolCheck({
      state: 'unknown',
      input: 'EURSUD',
      suggestions: [asset()],
    });
    expect(verdict.problem).toContain('در فهرست کارگزار نیست');
    expect(verdict.problem).toContain('EURUSD');
    expect(verdict.symbol).toBe('EURSUD');
  });

  it('tells the unknown symbol to use /symbols when it has no suggestion', () => {
    const verdict = describeSymbolCheck({ state: 'unknown', input: 'ZZZ', suggestions: [] });
    expect(verdict.problem).toContain('/symbols');
  });

  it('lets an unverified symbol through with a warning', () => {
    const verdict = describeSymbolCheck({ state: 'unverified', symbol: 'EURUSD', reason: 'no list' });
    expect(verdict.problem).toBeNull();
    expect(verdict.note).toContain('بدون بررسی ادامه می‌دهیم');
  });
});
