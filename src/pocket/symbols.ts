import type { AssetInfo } from './protocol.ts';

const OTC_SUFFIX = '_otc';
const MAX_SUGGESTIONS = 5;

function asciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function normalizeSymbol(raw: string): string {
  const cleaned = asciiDigits(raw).replace(/[​-‏‪-‮]/g, '').trim();
  const tokens = cleaned.toUpperCase().replace(/[\s._/\\|,+-]+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length === 0) return '';

  let otc = false;
  if (tokens.length > 1 && tokens[tokens.length - 1] === 'OTC') {
    otc = true;
    tokens.pop();
  } else if (tokens.length > 1 && tokens[0] === 'OTC') {
    otc = true;
    tokens.shift();
  }

  let base = tokens.join('');
  if (!otc && base.length > 3 && base.endsWith('OTC')) {
    otc = true;
    base = base.slice(0, -3);
  }
  if (base === '') return '';

  return otc ? `${base}${OTC_SUFFIX}` : base;
}

export function isOtc(symbol: string): boolean {
  return symbol.toUpperCase().endsWith('_OTC');
}

export function twinSymbol(symbol: string): string {
  return isOtc(symbol) ? symbol.slice(0, -OTC_SUFFIX.length) : `${symbol}${OTC_SUFFIX}`;
}

export interface SymbolResolution {
  status: 'exact' | 'corrected' | 'unknown';
  input: string;
  asset: AssetInfo | null;
  twin: AssetInfo | null;
  suggestions: AssetInfo[];
}

function rank(a: AssetInfo, b: AssetInfo): number {
  if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
  return (b.payout ?? 0) - (a.payout ?? 0);
}

export function resolveSymbol(raw: string, assets: readonly AssetInfo[]): SymbolResolution {
  const input = normalizeSymbol(raw);
  const bySymbol = new Map<string, AssetInfo>();
  for (const asset of assets) bySymbol.set(asset.symbol.toUpperCase(), asset);

  const find = (candidate: string): AssetInfo | null => bySymbol.get(candidate.toUpperCase()) ?? null;
  const twinOf = (symbol: string | null): AssetInfo | null =>
    symbol === null ? null : find(twinSymbol(symbol));

  const exact = find(input);
  if (exact) {
    return { status: 'exact', input, asset: exact, twin: twinOf(exact.symbol), suggestions: [] };
  }

  const variants = [`#${input}`, twinSymbol(input), `#${twinSymbol(input)}`];
  for (const variant of variants) {
    const hit = find(variant);
    if (hit) {
      return { status: 'corrected', input, asset: hit, twin: twinOf(hit.symbol), suggestions: [] };
    }
  }

  const base = input.replace(/_OTC$/i, '').replace(/^#/, '');
  const suggestions = assets
    .filter((asset) => {
      const symbol = asset.symbol.toUpperCase().replace(/_OTC$/, '').replace(/^#/, '');
      const name = asset.name.toUpperCase();
      return (
        base.length > 1 && (symbol.includes(base) || base.includes(symbol) || name.includes(base))
      );
    })
    .sort(rank)
    .slice(0, MAX_SUGGESTIONS);

  return { status: 'unknown', input, asset: null, twin: null, suggestions };
}
