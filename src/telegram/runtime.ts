import { Bot, InlineKeyboard, type Context } from 'grammy';
import { createLogger } from '../logger.ts';
import { errorMessage } from '../util/errors.ts';
import { parseAccountMode } from './parse.ts';
import { CallbackRouter } from './router.ts';
import { HTML } from './reply.ts';
import { createSymbolVerifier, type SymbolVerdict } from './symbol-check.ts';
import { createOrderSubmitter } from './submit.ts';
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

  const balanceSuffix = (mode: AccountMode): number | null =>
    settings.get('notifyBalance') ? engine.cachedBalance(mode) : null;

  const verifySymbol = createSymbolVerifier(engine);
  const submitOrder = createOrderSubmitter({ config, settings, engine, verifySymbol, balanceSuffix, send });

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
