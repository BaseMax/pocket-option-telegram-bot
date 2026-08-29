import { describe, expect, it } from 'bun:test';
import { searchAssets } from '../src/telegram/commands/market.ts';
import type { AssetInfo } from '../src/pocket/protocol.ts';

const asset = (symbol: string, patch: Partial<AssetInfo> = {}): AssetInfo => ({
  symbol,
  name: symbol,
  payout: 50,
  isOpen: true,
  ...patch,
});

const assets: AssetInfo[] = [
  asset('EURUSD', { name: 'Euro/Dollar', payout: 70 }),
  asset('EURUSD_otc', { name: 'Euro/Dollar OTC', payout: 90 }),
  asset('GBPJPY', { name: 'Pound/Yen', isOpen: false, payout: 95 }),
  asset('#AAPL', { name: 'Apple', payout: 60 }),
];

describe('searchAssets', () => {
  it('lists only open markets when there is no query', () => {
    expect(searchAssets(assets, '').map((a) => a.symbol)).toEqual(['EURUSD_otc', 'EURUSD', '#AAPL']);
  });

  it('matches on the symbol, ignoring case and the OTC suffix', () => {
    expect(searchAssets(assets, 'eurusd').map((a) => a.symbol)).toEqual(['EURUSD_otc', 'EURUSD']);
    expect(searchAssets(assets, 'EURUSD_otc').map((a) => a.symbol)).toEqual(['EURUSD_otc', 'EURUSD']);
  });

  it('matches on the display name too', () => {
    expect(searchAssets(assets, 'apple').map((a) => a.symbol)).toEqual(['#AAPL']);
  });

  it('keeps closed markets in the results but ranks them last', () => {
    const found = searchAssets(assets, 'p');
    expect(found.map((a) => a.symbol)).toContain('GBPJPY');
    expect(found[found.length - 1]?.symbol).toBe('GBPJPY');
  });

  it('finds nothing rather than throwing on a query that matches nothing', () => {
    expect(searchAssets(assets, 'zzz')).toEqual([]);
  });
});
