import { assetLine, escapeHtml } from './format.ts';
import type { TradeEngine } from '../engine/engine.ts';
import type { SymbolCheck } from '../engine/market.ts';
import type { AccountMode } from '../types.ts';

/** What the broker thinks of a symbol the user typed: the name to use, a blocker, or a warning. */
export interface SymbolVerdict {
  symbol: string;
  /** Set when the order cannot go ahead with this symbol. */
  problem: string | null;
  /** Set when it can, but the user should know something first. */
  note: string | null;
}

/** Turns the engine's symbol check into the Persian the user reads. */
export function describeSymbolCheck(check: SymbolCheck): SymbolVerdict {
  if (check.state === 'unknown') {
    const list = check.suggestions.map((asset) => `• ${assetLine(asset)}`).join('\n');
    return {
      symbol: check.input,
      problem:
        `نماد <code>${escapeHtml(check.input)}</code> در فهرست کارگزار نیست.` +
        (list
          ? `\n\nشاید یکی از این‌ها باشد:\n${list}`
          : '\nبا <code>/symbols &lt;بخشی از نام&gt;</code> جست‌وجو کنید.'),
      note: null,
    };
  }

  if (check.state === 'unverified') {
    return {
      symbol: check.symbol,
      problem: null,
      note: '⚠️ فهرست نمادها از کارگزار گرفته نشد، بدون بررسی ادامه می‌دهیم.',
    };
  }

  const notes: string[] = [];
  if (check.corrected) notes.push(`✅ نماد اصلاح شد به ${assetLine(check.asset)}`);
  if (!check.asset.isOpen) {
    notes.push('🔴 بازار این نماد الان بسته است؛ سفارش تا باز شدن بازار منتظر می‌ماند.');
    if (check.twin?.isOpen) notes.push(`نسخهٔ باز: ${assetLine(check.twin)}`);
  }
  return { symbol: check.symbol, problem: null, note: notes.length > 0 ? notes.join('\n') : null };
}

export function createSymbolVerifier(engine: TradeEngine) {
  return async (mode: AccountMode, raw: string): Promise<SymbolVerdict> =>
    describeSymbolCheck(await engine.checkSymbol(mode, raw));
}
