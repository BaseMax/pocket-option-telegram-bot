import { InlineKeyboard, type Context } from 'grammy';
import { createLogger } from '../logger.ts';
import { errorMessage } from '../util/errors.ts';
import { nowSeconds } from '../util/time.ts';
import { MissingCredentialsError } from '../engine/session.ts';
import { checkLimits } from './limits.ts';
import { HTML, openNotice } from './reply.ts';
import { ACCOUNT_LABEL, escapeHtml, renderOrder, withBalance } from './format.ts';
import type { AppConfig } from '../config.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { TradeEngine } from '../engine/engine.ts';
import type { AccountMode, OrderSpec } from '../types.ts';
import type { SymbolVerdict } from './symbol-check.ts';

const logger = createLogger('telegram');

interface SubmitDeps {
  config: AppConfig;
  settings: SettingsStore;
  engine: TradeEngine;
  verifySymbol: (mode: AccountMode, raw: string) => Promise<SymbolVerdict>;
  balanceSuffix: (mode: AccountMode) => number | null;
  send: (chatId: number, text: string) => Promise<void>;
}

/**
 * Registers one order, whatever screen it came from: the wizard panel and the one-line command
 * both end here, so the limits, the symbol check and the confirmation are identical either way.
 */
export function createOrderSubmitter(deps: SubmitDeps) {
  const { config, settings, engine, verifySymbol, balanceSuffix, send } = deps;

  return async (ctx: Context, spec: OrderSpec): Promise<void> => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const problem = checkLimits(spec, config.limits);
    if (problem) {
      await ctx.reply(`⚠️ ${problem}`, HTML);
      return;
    }

    if (!engine.hasCredentials(spec.accountMode)) {
      await ctx.reply(
        `⚠️ برای حساب ${ACCOUNT_LABEL[spec.accountMode]} هنوز نشستی ثبت نشده است.\n` +
          `با دستور <code>/session ${spec.accountMode} &lt;SSID&gt;</code> آن را ثبت کنید.`,
        HTML,
      );
      return;
    }

    const notice = await openNotice(ctx, '⏳ در حال بررسی نماد و ثبت سفارش…');

    const verdict = await verifySymbol(spec.accountMode, spec.symbol);
    if (verdict.problem !== null) {
      await notice.update(`⚠️ ${verdict.problem}`);
      return;
    }

    const { validForSeconds, ...rest } = spec;
    try {
      const order = await engine.createOrder({
        ...rest,
        chatId,
        symbol: verdict.symbol,
        validUntil: validForSeconds === null ? null : nowSeconds() + validForSeconds,
      });

      const text = withBalance(
        `✅ <b>سفارش ثبت شد</b>\n\n${renderOrder(order, config.timezone)}\n\n` +
          (verdict.note === null ? '' : `${verdict.note}\n\n`) +
          `از این لحظه قیمت لحظه‌ای <b>${escapeHtml(order.symbol)}</b> زنده دنبال می‌شود.`,
        balanceSuffix(order.accountMode),
        settings.get('notifyBalance'),
      );
      const shown = await notice.update(text, {
        reply_markup: new InlineKeyboard().text('❌ لغو این سفارش', `c:${order.id}`),
      });
      if (!shown) await send(chatId, text);
    } catch (error) {
      logger.error('failed to create order', error);
      const message =
        error instanceof MissingCredentialsError
          ? 'نشست پاکت آپشن برای این حساب ثبت نشده است.'
          : errorMessage(error);
      await notice.update(`⚠️ ثبت سفارش ناموفق بود: ${escapeHtml(message)}`);
    }
  };
}
