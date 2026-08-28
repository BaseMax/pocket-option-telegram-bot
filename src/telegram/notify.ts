import { formatTime } from '../util/time.ts';
import {
  ACCOUNT_LABEL,
  DIRECTION_LABEL,
  TRIGGER_LABEL,
  escapeHtml,
  formatMoney,
  formatPrice,
  orderHeadline,
  renderOrder,
  withBalance,
} from './format.ts';
import type { EngineEvent } from '../engine/engine.ts';
import type { BotRuntime } from './runtime.ts';
import type { Order } from '../types.ts';

/** Events that carry an order, i.e. everything except the service-wide connection notices. */
type OrderEvent = Extract<EngineEvent, { order: Order }>;

const SETTLED_TITLE: Record<string, string> = {
  won: '✅ <b>برد</b>',
  lost: '🛑 <b>باخت</b>',
  draw: '🟰 <b>مساوی</b>',
};

/** The message announcing one order event, or null when the event needs no announcement. */
export function orderEventText(event: OrderEvent, timezone: string): string | null {
  const order = event.order;
  const head = orderHeadline(order);

  switch (event.type) {
    case 'armed':
      return (
        `🎯 <b>قیمت به هدف رسید</b>\n\n${head}\n` +
        `قیمت برخورد: <code>${formatPrice(event.price)}</code>\n` +
        `ورود در ابتدای کندل بعدی، ساعت ${formatTime(event.entryAt, timezone)}.`
      );

    case 'triggered':
      return (
        `🎯 <b>قیمت به هدف رسید، در حال ورود</b>\n\n${head}\n` +
        `قیمت برخورد: <code>${formatPrice(event.price)}</code>\n` +
        `${DIRECTION_LABEL[order.direction]} · ${TRIGGER_LABEL[order.triggerMode]}`
      );

    case 'opened':
      return (
        `🔵 <b>معامله باز شد</b>\n\n${renderOrder(order, timezone, { compact: true })}\n` +
        `قیمت ورود: <code>${formatPrice(order.openPrice)}</code>` +
        (order.closesAt === null ? '' : `\nبسته می‌شود در: ${formatTime(order.closesAt, timezone)}`)
      );

    case 'settled':
      return (
        `${SETTLED_TITLE[order.status] ?? '🟰 <b>پایان معامله</b>'}\n\n${head}\n` +
        `قیمت ورود: <code>${formatPrice(order.openPrice)}</code> · قیمت خروج: <code>${formatPrice(order.closePrice)}</code>\n` +
        `سود/زیان: <b>${formatMoney(order.profit)}</b>`
      );

    case 'failed':
      return `⚠️ <b>سفارش ناموفق</b>\n\n${head}\n${escapeHtml(event.error)}`;

    case 'expired':
      return (
        `⌛️ <b>سفارش منقضی شد</b>\n\n${head}\n` +
        `قیمت تا پایان مهلت به <code>${formatPrice(order.triggerPrice)}</code> نرسید.`
      );

    case 'missed':
      return (
        `🚫 <b>فرصت از دست رفت، سفارش لغو شد</b>\n\n${head}\n` +
        `قیمت هنگام قطعی جریان قیمت از <code>${formatPrice(order.triggerPrice)}</code> عبور کرد.\n` +
        `قیمت فعلی: <code>${formatPrice(event.price)}</code>\n` +
        'برای ورود با قیمت تازه، سفارش جدید ثبت کنید.'
      );

    case 'settlement_pending':
      return (
        `⏱ <b>نتیجهٔ معامله هنوز نرسیده</b>\n\n${head}\n` +
        'زمان انقضا گذشته اما کارگزار هنوز نتیجه را اعلام نکرده است. پیگیری ادامه دارد.'
      );

    default:
      return null;
  }
}

/**
 * Turns engine events into chat messages. Connection notices are deduplicated per session,
 * because a flapping socket would otherwise spam every owner.
 */
export function registerEngineNotifications(rt: BotRuntime): void {
  const { config, settings, engine } = rt;
  const sessionState = new Map<string, 'up' | 'down'>();

  const onSession = (event: Extract<EngineEvent, { type: 'session' }>): void => {
    const key = `${event.mode}:${event.symbol ?? '*'}`;
    if (sessionState.get(key) === event.state) return;
    const first = !sessionState.has(key);
    sessionState.set(key, event.state);
    // A session's very first "up" is just it starting; only a recovery is worth a message.
    if (first && event.state === 'up') return;

    rt.broadcast(
      event.state === 'up'
        ? `🟢 اتصال <b>${escapeHtml(key)}</b> دوباره برقرار شد.`
        : `🔴 اتصال <b>${escapeHtml(key)}</b> قطع شد. تلاش برای اتصال مجدد ادامه دارد.\n` +
            `<code>${escapeHtml(event.detail ?? '')}</code>`,
    );
  };

  engine.onEvent((event: EngineEvent) => {
    if (event.type === 'session') return onSession(event);

    if (event.type === 'auth_failed') {
      rt.broadcast(
        `🔑 <b>نشست ${ACCOUNT_LABEL[event.mode]} رد شد</b>\n\n` +
          `${escapeHtml(event.detail)}\n\n` +
          'سفارش‌های شما دست‌نخورده باقی مانده‌اند اما تا ثبت نشست تازه دنبال نمی‌شوند.\n' +
          `برای ثبت مجدد: <code>/session ${event.mode} &lt;SSID&gt;</code>؛ راهنمای برداشتن SSID را با /session ببینید.`,
      );
      return;
    }

    const text = orderEventText(event, config.timezone);
    if (text === null) return;
    const showBalance = settings.get('notifyBalance');
    void rt.send(event.order.chatId, withBalance(text, rt.balanceSuffix(event.order.accountMode), showBalance));
  });
}
