import { attempt, HTML } from '../reply.ts';
import { GUIDE, HELP, TOPICS, backKeyboard, topicsKeyboard } from '../texts.ts';
import type { BotRuntime } from '../runtime.ts';

/** /start and /help, plus the guide pages their buttons page through. */
export function registerHelpCommands({ bot, callbacks }: BotRuntime): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(GUIDE, { ...HTML, reply_markup: topicsKeyboard() });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP, { ...HTML, reply_markup: topicsKeyboard() });
  });

  bot.command('id', async (ctx) => {
    await ctx.reply(`شناسهٔ این چت: <code>${ctx.chat.id}</code>`, HTML);
  });

  callbacks.on('h', async (ctx, topic) => {
    const home = topic === 'home';
    const text = home ? GUIDE : TOPICS[topic];
    await ctx.answerCallbackQuery();
    if (text === undefined) return;
    await attempt(
      'could not switch the guide page',
      ctx.editMessageText(text, { ...HTML, reply_markup: home ? topicsKeyboard() : backKeyboard() }),
    );
  });
}
