import { InlineKeyboard } from 'grammy';
import { formatTime, nowSeconds } from '../../util/time.ts';
import { attempt, HTML } from '../reply.ts';
import { parseOrderCommand } from '../parse.ts';
import { STATUS_LABEL, escapeHtml, formatMoney, formatPrice, orderHeadline, renderOrder } from '../format.ts';
import type { BotRuntime } from '../runtime.ts';
import type { Order } from '../../types.ts';

/** Only these two states can still be called off, so only they get a cancel button. */
function cancellable(order: Order): boolean {
  return order.status === 'pending' || order.status === 'armed';
}

const NOT_FOUND = 'سفارشی با این کد پیدا نشد.';

const CANCEL_REFUSAL: Record<string, string> = {
  already_open: 'این معامله باز شده و در باینری آپشن امکان بستن زودهنگام وجود ندارد.',
  not_found: NOT_FOUND,
};

/** Why the engine would not cancel, in words. */
function refusal(reason: string): string {
  return CANCEL_REFUSAL[reason] ?? 'این سفارش دیگر فعال نیست.';
}

/** Everything about making, listing and cancelling orders. */
export function registerOrderCommands(rt: BotRuntime): void {
  const { bot, callbacks, config, settings, orders, engine, wizard } = rt;

  bot.command('new', async (ctx) => {
    await wizard.open(ctx);
  });

  bot.command('order', async (ctx) => {
    const args = ctx.match.trim();
    if (args === '') {
      await wizard.open(ctx);
      return;
    }
    const parsed = parseOrderCommand(args, settings.all);
    if (!parsed.ok) {
      await ctx.reply(`⚠️ ${escapeHtml(parsed.error)}`, HTML);
      return;
    }
    await rt.submitOrder(ctx, parsed.order);
  });

  bot.command('list', async (ctx) => {
    const active = orders.listActiveByChat(ctx.chat.id);
    if (active.length === 0) {
      await ctx.reply('سفارش فعالی ندارید. با /new یکی بسازید.');
      return;
    }
    for (const order of active) {
      const live = engine.sessionManager.get(order.accountMode, order.symbol)?.price ?? null;
      const livePart = live === null ? '' : `\nقیمت لحظه‌ای: <code>${formatPrice(live)}</code>`;
      await ctx.reply(renderOrder(order, config.timezone) + livePart, {
        ...HTML,
        ...(cancellable(order) ? { reply_markup: new InlineKeyboard().text('❌ لغو', `c:${order.id}`) } : {}),
      });
    }
  });

  bot.command('cancel', async (ctx) => {
    const id = ctx.match.trim().replace(/^#/, '').toUpperCase();
    if (id === '') {
      await ctx.reply('کد سفارش را بدهید. مثال: <code>/cancel A7K2</code>', HTML);
      return;
    }
    const order = orders.get(id);
    if (!order || order.chatId !== ctx.chat.id) {
      await ctx.reply(NOT_FOUND);
      return;
    }
    const result = engine.cancel(id);
    await ctx.reply(
      result.ok
        ? `⚪️ سفارش <b>#${escapeHtml(id)}</b> لغو شد.`
        : refusal(result.reason),
      HTML,
    );
  });

  bot.command('history', async (ctx) => {
    const recent = orders.listRecentByChat(ctx.chat.id, 15);
    if (recent.length === 0) {
      await ctx.reply('هنوز سفارشی ثبت نشده است.');
      return;
    }
    const lines = recent.map((order) => {
      const profit = order.profit === null ? '' : ` · ${formatMoney(order.profit)}`;
      return `${orderHeadline(order)}\n   ${STATUS_LABEL[order.status]}${profit} · ${formatTime(order.createdAt, config.timezone)}`;
    });
    await ctx.reply(`🗂 <b>آخرین سفارش‌ها</b>\n\n${lines.join('\n')}`, HTML);
  });

  bot.command('stats', async (ctx) => {
    const summary = orders.summary(ctx.chat.id, nowSeconds() - 24 * 3600);
    const total = summary.won + summary.lost + summary.draw;
    const rate = total > 0 ? Math.round((summary.won / total) * 100) : 0;
    await ctx.reply(
      '📊 <b>آمار ۲۴ ساعت گذشته</b>\n\n' +
        `برد: <b>${summary.won}</b> · باخت: <b>${summary.lost}</b> · مساوی: <b>${summary.draw}</b>\n` +
        `نرخ برد: <b>${rate}%</b>\n` +
        `سود/زیان خالص: <b>${formatMoney(summary.profit)}</b>`,
      HTML,
    );
  });

  // The ❌ button riding along with an order message.
  callbacks.on('c', async (ctx, id) => {
    const order = orders.get(id);
    if (!order || order.chatId !== ctx.chat?.id) {
      await ctx.answerCallbackQuery({ text: NOT_FOUND });
      return;
    }
    const result = engine.cancel(id);
    await ctx.answerCallbackQuery({
      text: result.ok ? 'سفارش لغو شد.' : refusal(result.reason),
      show_alert: !result.ok,
    });
    // The button is dead once the order left the cancellable states, so take it away.
    if (result.ok || result.reason !== 'already_open') {
      await attempt('could not clear the cancel button', ctx.editMessageReplyMarkup({ reply_markup: undefined }));
    }
  });
}
