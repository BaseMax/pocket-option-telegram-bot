import { HTML, openNotice } from '../reply.ts';
import { normalizeSymbol } from '../parse.ts';
import { ACCOUNT_LABEL, assetLine, escapeHtml, formatMoney, formatPrice } from '../format.ts';
import type { AssetInfo } from '../../pocket/protocol.ts';
import type { BotRuntime } from '../runtime.ts';

const SYMBOLS_SHOWN = 30;

/** Open markets first, then the fattest payout: the order a trader wants to read. */
function rank(a: AssetInfo, b: AssetInfo): number {
  return a.isOpen === b.isOpen ? (b.payout ?? 0) - (a.payout ?? 0) : a.isOpen ? -1 : 1;
}

/**
 * The assets /symbols should list: everything matching the query by symbol or name, or every
 * open market when the query is empty, ranked for reading.
 */
export function searchAssets(assets: readonly AssetInfo[], query: string): AssetInfo[] {
  const needle = normalizeSymbol(query).replace(/_OTC$/i, '').replace(/^#/, '');
  const matched =
    needle === ''
      ? assets.filter((asset) => asset.isOpen)
      : assets.filter(
          (asset) =>
            asset.symbol.toUpperCase().includes(needle) || asset.name.toUpperCase().includes(query.toUpperCase()),
        );
  return matched.slice().sort(rank);
}

/** Reading the market: balance, live price, the symbol list and the state of the connections. */
export function registerMarketCommands(rt: BotRuntime): void {
  const { bot, settings, orders, engine } = rt;

  bot.command('balance', async (ctx) => {
    const mode = rt.resolveMode(ctx.match);
    if (!engine.hasCredentials(mode)) {
      await ctx.reply(`برای حساب ${ACCOUNT_LABEL[mode]} نشستی ثبت نشده است.`, HTML);
      return;
    }
    const notice = await openNotice(ctx, '⏳ در حال خواندن موجودی…');
    try {
      const balance = await engine.balance(mode);
      await notice.update(
        balance === null
          ? '⚠️ موجودی دریافت نشد. اتصال را با /status بررسی کنید.'
          : `💵 موجودی حساب ${ACCOUNT_LABEL[mode]}: <b>${formatMoney(balance)}</b>`,
      );
    } catch (error) {
      await notice.fail(error);
    }
  });

  bot.command('price', async (ctx) => {
    const [symbolRaw, modeRaw] = ctx.match.trim().split(/\s+/);
    if (!symbolRaw) {
      await ctx.reply('نماد را بدهید. مثال: <code>/price GBPAUD_otc</code>', HTML);
      return;
    }
    const mode = rt.resolveMode(modeRaw);
    const notice = await openNotice(ctx, `⏳ در حال بررسی ${escapeHtml(normalizeSymbol(symbolRaw))}…`);
    try {
      const verdict = await rt.verifySymbol(mode, symbolRaw);
      if (verdict.problem !== null) {
        await notice.update(`⚠️ ${verdict.problem}`);
        return;
      }
      const price = await engine.price(mode, verdict.symbol);
      await notice.update(
        price === null
          ? `⚠️ قیمتی برای <b>${escapeHtml(verdict.symbol)}</b> دریافت نشد. نماد یا باز بودن بازار را بررسی کنید.`
          : `💹 <b>${escapeHtml(verdict.symbol)}</b> (${ACCOUNT_LABEL[mode]}): <code>${formatPrice(price)}</code>`,
      );
    } catch (error) {
      await notice.fail(error);
    }
  });

  bot.command('symbols', async (ctx) => {
    const query = ctx.match.trim();
    const mode = settings.get('defaultAccountMode');
    const notice = await openNotice(ctx, '⏳ در حال گرفتن فهرست نمادها…');
    try {
      const assets = await engine.assets(mode);
      if (assets.length === 0) {
        await notice.update('⚠️ کارگزار فهرست نمادها را نفرستاد.');
        return;
      }

      const matched = searchAssets(assets, query);
      const shown = matched.slice(0, SYMBOLS_SHOWN);
      const header =
        query === ''
          ? `نمادهای باز حساب ${ACCOUNT_LABEL[mode]} (${matched.length} مورد)`
          : `نتیجهٔ جست‌وجوی <code>${escapeHtml(query)}</code> (${matched.length} مورد)`;
      const body =
        shown.length === 0
          ? 'چیزی پیدا نشد.'
          : shown.map((asset) => `• ${assetLine(asset)}`).join('\n') +
            (matched.length > shown.length ? `\n\n… و ${matched.length - shown.length} مورد دیگر.` : '');

      await notice.update(`📋 <b>${header}</b>\n\n${body}`);
    } catch (error) {
      await notice.fail(error);
    }
  });

  bot.command('status', async (ctx) => {
    const lines = engine.sessionManager.list().map(({ key, session, holders }) => {
      const state = session.isReady ? '🟢 متصل' : '🔴 قطع';
      const price = session.price === null ? '-' : formatPrice(session.price);
      const endpoint = session.client.endpoint?.url ?? '-';
      return (
        `<b>${escapeHtml(key)}</b> · ${state}\n` +
        `   سرور: <code>${escapeHtml(endpoint)}</code>\n` +
        `   قیمت: <code>${price}</code> · سفارش‌های وابسته: ${holders}\n` +
        `   موجودی: ${formatMoney(session.balance)} · اختلاف ساعت سرور: ${session.client.timeOffset}s`
      );
    });

    await ctx.reply(
      '📡 <b>وضعیت سرویس</b>\n\n' +
        `سفارش‌های فعال شما: <b>${orders.listActiveByChat(ctx.chat.id).length}</b>\n` +
        `حساب پیش‌فرض: ${ACCOUNT_LABEL[settings.get('defaultAccountMode')]}\n\n` +
        (lines.length > 0 ? lines.join('\n\n') : 'هیچ نشست زنده‌ای باز نیست.'),
      HTML,
    );
  });
}
