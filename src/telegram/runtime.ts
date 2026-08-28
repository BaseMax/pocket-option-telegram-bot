import { Bot, InlineKeyboard, type Context } from 'grammy';
import { createLogger } from '../logger.ts';
import { errorMessage } from '../util/errors.ts';
import { nowSeconds } from '../util/time.ts';
import { MissingCredentialsError } from '../engine/session.ts';
import { parseAccountMode } from './parse.ts';
import { checkLimits } from './limits.ts';
import { CallbackRouter } from './router.ts';
import { HTML, openNotice } from './reply.ts';
import { ACCOUNT_LABEL, assetLine, escapeHtml, renderOrder, withBalance } from './format.ts';
import { OrderWizard, draftToSpec } from './wizard/index.ts';
import type { AppConfig } from '../config.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { OrderRepository } from '../storage/orders.ts';
import type { TradeEngine } from '../engine/engine.ts';
import type { AccountMode, OrderSpec } from '../types.ts';

const logger = createLogger('telegram');

export interface BotDeps {
  config: AppConfig;
  settings: SettingsStore;
  orders: OrderRepository;
  engine: TradeEngine;
}

/** What the broker thinks of a symbol the user typed: the name to use, a blocker, or a warning. */
export interface SymbolVerdict {
  symbol: string;
  problem: string | null;
  note: string | null;
}

/**
 * The wiring every command shares: the bot, the stores, and the handful of operations
 * that would otherwise be re-implemented in each command module.
 */
export interface BotRuntime extends BotDeps {
  bot: Bot;
  wizard: OrderWizard;
  callbacks: CallbackRouter;
  /** Chats allowed to use this bot, and the audience for service-wide notices. */
  recipients(): number[];
  /** Sends a message, logging rather than throwing when Telegram refuses. */
  send(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  broadcast(text: string): void;
  /** The account a command should act on: the one named in its arguments, else the default. */
  resolveMode(raw: string | undefined): AccountMode;
  /** The balance to append to a notification, or null when the user turned that off. */
  balanceSuffix(mode: AccountMode): number | null;
  verifySymbol(mode: AccountMode, raw: string): Promise<SymbolVerdict>;
  /** Validates, registers and confirms one order, whatever screen it came from. */
  submitOrder(ctx: Context, spec: OrderSpec): Promise<void>;
}

export function createRuntime(deps: BotDeps): BotRuntime {
  const { config, settings, engine } = deps;
  const bot = new Bot(config.telegram.token);

  const recipients = (): number[] => [
    ...new Set<number>([...config.telegram.adminIds, ...settings.get('owners')]),
  ];

  const send = async (chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> => {
    try {
      await bot.api.sendMessage(chatId, text, { ...HTML, ...(keyboard ? { reply_markup: keyboard } : {}) });
    } catch (error) {
      logger.error(`failed to message chat ${chatId}: ${errorMessage(error)}`);
    }
  };

  const verifySymbol = async (mode: AccountMode, raw: string): Promise<SymbolVerdict> => {
    const check = await engine.checkSymbol(mode, raw);

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
  };

  const balanceSuffix = (mode: AccountMode): number | null =>
    settings.get('notifyBalance') ? engine.cachedBalance(mode) : null;

  const submitOrder = async (ctx: Context, spec: OrderSpec): Promise<void> => {
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

  const wizard = new OrderWizard(
    settings,
    async (draft, ctx) => {
      const spec = draftToSpec(draft);
      if (spec) await submitOrder(ctx, spec);
    },
    verifySymbol,
  );

  return {
    ...deps,
    bot,
    wizard,
    callbacks: new CallbackRouter(),
    recipients,
    send,
    broadcast: (text: string) => {
      for (const chatId of recipients()) void send(chatId, text);
    },
    resolveMode: (raw) => (raw === undefined ? undefined : parseAccountMode(raw)) ?? settings.get('defaultAccountMode'),
    balanceSuffix,
    verifySymbol,
    submitOrder,
  };
}
