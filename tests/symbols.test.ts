import { describe, expect, it } from 'bun:test';
import { normalizeSymbol, resolveSymbol, twinSymbol, isOtc } from '../src/pocket/symbols.ts';
import { FAKE_ASSETS } from './fakes.ts';

describe('normalizeSymbol', () => {
  it('uppercases the base and lowercases the otc suffix', () => {
    expect(normalizeSymbol('gbpaud_otc')).toBe('GBPAUD_otc');
    expect(normalizeSymbol('EURUSD')).toBe('EURUSD');
  });

  it('accepts any separator the user reaches for', () => {
    expect(normalizeSymbol('GBPAUD-OTC')).toBe('GBPAUD_otc');
    expect(normalizeSymbol('gbpaud.otc')).toBe('GBPAUD_otc');
    expect(normalizeSymbol('gbpaud otc')).toBe('GBPAUD_otc');
    expect(normalizeSymbol('gbpaud/otc')).toBe('GBPAUD_otc');
    expect(normalizeSymbol('eur/usd')).toBe('EURUSD');
    expect(normalizeSymbol('EUR USD')).toBe('EURUSD');
  });

  it('recovers a forgotten separator before otc', () => {
    expect(normalizeSymbol('eurusdotc')).toBe('EURUSD_otc');
    expect(normalizeSymbol('EURUSDOTC')).toBe('EURUSD_otc');
  });

  it('accepts otc written first', () => {
    expect(normalizeSymbol('otc eurusd')).toBe('EURUSD_otc');
  });

  it('keeps the # that Pocket Option puts on stocks', () => {
    expect(normalizeSymbol('#aapl-otc')).toBe('#AAPL_otc');
  });

  it('translates Persian and Arabic digits', () => {
    expect(normalizeSymbol('AUS۲۰۰')).toBe('AUS200');
    expect(normalizeSymbol('jpn٢٢٥')).toBe('JPN225');
  });

  it('survives padding and empty input', () => {
    expect(normalizeSymbol('  eurusd  ')).toBe('EURUSD');
    expect(normalizeSymbol('   ')).toBe('');
  });
});

describe('twinSymbol', () => {
  it('toggles the otc side', () => {
    expect(twinSymbol('EURUSD')).toBe('EURUSD_otc');
    expect(twinSymbol('EURUSD_otc')).toBe('EURUSD');
    expect(isOtc('EURUSD_otc')).toBe(true);
    expect(isOtc('EURUSD')).toBe(false);
  });
});

describe('resolveSymbol', () => {
  it('matches a symbol the broker really lists', () => {
    const match = resolveSymbol('eurusd otc', FAKE_ASSETS);
    expect(match.status).toBe('exact');
    expect(match.asset?.symbol).toBe('EURUSD_otc');
    expect(match.twin?.symbol).toBe('EURUSD');
  });

  it('adds the # prefix a user would not think to type', () => {
    const match = resolveSymbol('aapl otc', FAKE_ASSETS);
    expect(match.status).toBe('corrected');
    expect(match.asset?.symbol).toBe('#AAPL_otc');
  });

  it('falls back to the otc twin when only that one is listed', () => {
    const assets = FAKE_ASSETS.filter((asset) => asset.symbol !== 'EURUSD');
    const match = resolveSymbol('EURUSD', assets);
    expect(match.status).toBe('corrected');
    expect(match.asset?.symbol).toBe('EURUSD_otc');
  });

  it('suggests open markets first for a typo', () => {
    const match = resolveSymbol('eurusdd', FAKE_ASSETS);
    expect(match.status).toBe('unknown');
    expect(match.suggestions[0]?.symbol).toBe('EURUSD_otc');
  });

  it('finds an instrument by its name', () => {
    const match = resolveSymbol('apple', FAKE_ASSETS);
    expect(match.status).toBe('unknown');
    expect(match.suggestions.map((a) => a.symbol)).toContain('#AAPL_otc');
  });

  it('reports nothing for a symbol that does not exist at all', () => {
    const match = resolveSymbol('ZZZZZZ', FAKE_ASSETS);
    expect(match.status).toBe('unknown');
    expect(match.suggestions).toHaveLength(0);
  });
});
