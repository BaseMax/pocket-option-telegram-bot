import { createLogger } from '../logger.ts';
import { HTML } from './reply.ts';
import { COMMAND_LIST } from './texts.ts';
import { createRuntime, type BotDeps, type BotRuntime } from './runtime.ts';
import { registerHelpCommands } from './commands/help.ts';
import { registerOrderCommands } from './commands/orders.ts';
import { registerMarketCommands } from './commands/market.ts';
import { registerSettingsCommands } from './commands/settings.ts';
import { registerEngineNotifications } from './notify.ts';
import type { Bot } from 'grammy';

export type { BotDeps } from './runtime.ts';

const logger = createLogger('telegram');

export async function publishCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([...COMMAND_LIST]);
  } catch (error) {
    logger.warn('could not publish command list', error);
  }
}

/** Only the owners may drive the bot; an unclaimed bot belongs to whoever speaks to it first. */
function guardAccess(rt: BotRuntime): void {
  const { bot, settings } = rt;

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const allowed = rt.recipients();
    if (allowed.length === 0) {
      settings.addOwner(chatId);
      logger.warn(`chat ${chatId} claimed ownership of this bot`);
    } else if (!allowed.includes(chatId)) {
      await ctx.reply(
        `⛔️ دسترسی ندارید.\nشناسهٔ چت شما: <code>${chatId}</code>\n` +
          'برای دسترسی، این شناسه را در <code>TELEGRAM_ADMIN_IDS</code> قرار دهید.',
        HTML,
      );
      return;
    }
    await next();
  });
}

/** Text that is not a command belongs to the wizard when it is waiting for a value. */
function routeMessages(rt: BotRuntime): void {
  const { bot, wizard } = rt;

  // Registered before the commands so a command can interrupt a pending question.
  bot.on('message:text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) await wizard.abortPrompt(ctx);
    await next();
  });
}

function routeLeftovers(rt: BotRuntime): void {
  const { bot, wizard, callbacks } = rt;

  bot.on('callback_query:data', (ctx) => callbacks.dispatch(ctx));

  bot.on('message:text', async (ctx) => {
    if (await wizard.handleText(ctx)) return;
    if (ctx.message.text.startsWith('/')) return;
    await ctx.reply('برای ساخت سفارش /new را بزنید یا /help را ببینید.');
  });

  bot.catch((error) => logger.error('unhandled bot error', error.error));
}

export function createBot(deps: BotDeps): Bot {
  const rt = createRuntime(deps);

  guardAccess(rt);
  routeMessages(rt);

  registerHelpCommands(rt);
  registerOrderCommands(rt);
  registerMarketCommands(rt);
  registerSettingsCommands(rt);

  rt.callbacks.on('w', (ctx, payload) => rt.wizard.handleCallback(ctx, payload));

  routeLeftovers(rt);
  registerEngineNotifications(rt);

  return rt.bot;
}
