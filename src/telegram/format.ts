import { formatDuration, formatTime, timeframeLabel } from '../util/time.ts';
import type { AssetInfo } from '../pocket/protocol.ts';
import type { AccountMode, ChartType, Direction, ExpiryMode, Order, OrderStatus, TriggerMode } from '../types.ts';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined || !Number.isFinite(price)) return '-';
  const decimals = Math.abs(price) >= 100 ? 3 : 5;
  return price.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '' : '-'}$${Math.abs(value).toFixed(2)}`;
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  call: '🟢 خرید (Buy / Call)',
  put: '🔴 فروش (Sell / Put)',
};

export const DIRECTION_SHORT: Record<Direction, string> = {
  call: '🟢 خرید',
  put: '🔴 فروش',
};

export const TRIGGER_LABEL: Record<TriggerMode, string> = {
  touch: 'همان لحظهٔ برخورد',
  next_candle: 'اولین لحظهٔ کندل بعدی',
};

export const EXPIRY_LABEL: Record<ExpiryMode, string> = {
  fixed: 'زمان ثابت',
  floating: 'شناور (تا پایان کندل)',
};

export const CHART_LABEL: Record<ChartType, string> = {
  candle: 'کندلی',
  heikin_ashi: 'هایکن‌آشی',
  line: 'خطی',
};

/** One-line answers to "این گزینه چه می‌کند؟" shown next to each choice in the wizard. */
export const CHART_HELP: Record<ChartType, string> = {
  candle:
    'کندل استاندارد (ژاپنی): هر کندل دقیقاً قیمت باز، بسته، بیشترین و کمترین همان بازه را نشان می‌دهد. قیمت واقعی بازار، بدون هیچ فیلتری.',
  heikin_ashi:
    'هایکن‌آشی: کندل‌ها از میانگین قیمت‌ها ساخته می‌شوند، پس نوسان‌های ریز حذف و روند صاف‌تر دیده می‌شود؛ اما قیمت روی کندل، قیمت واقعی معامله نیست و کمی با تأخیر می‌آید.',
  line: 'خطی: فقط قیمت بستهٔ هر بازه به هم وصل می‌شود؛ ساده‌ترین نما برای دیدن مسیر کلی قیمت.',
};

export const TRIGGER_HELP: Record<TriggerMode, string> = {
  touch: 'همان ثانیه‌ای که قیمت به عدد هدف برسد، معامله باز می‌شود.',
  next_candle: 'بعد از برخورد قیمت صبر می‌کند و معامله را دقیقاً در اولین لحظهٔ کندل بعدی باز می‌کند.',
};

export const EXPIRY_HELP: Record<ExpiryMode, string> = {
  fixed: 'معامله به اندازهٔ مدتی که خودتان می‌دهید باز می‌ماند (مثلاً ۶۰ ثانیه).',
  floating: 'معامله تا پایان کندل جاری باز می‌ماند؛ اگر تعداد کندل بیشتر بدهید، تا پایان همان تعداد کندل.',
};

export const ACCOUNT_LABEL: Record<AccountMode, string> = {
  demo: '🧪 دمو',
  real: '💰 ریل',
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: '⏳ در انتظار قیمت',
  armed: '🎯 مسلح (منتظر کندل بعدی)',
  placing: '📤 در حال ارسال',
  open: '🔵 باز',
  won: '✅ برد',
  lost: '🛑 باخت',
  draw: '🟰 مساوی',
  cancelled: '⚪️ لغو شده',
  failed: '⚠️ ناموفق',
  expired: '⌛️ منقضی شده',
};

/** One broker asset as a single line: symbol, whether its market is open, payout and name. */
export function assetLine(asset: AssetInfo): string {
  return (
    `<code>${escapeHtml(asset.symbol)}</code> · ${asset.isOpen ? '🟢 باز' : '🔴 بسته'}` +
    (asset.payout === null ? '' : ` · پرداخت ${asset.payout}٪`) +
    (asset.name ? ` · ${escapeHtml(asset.name)}` : '')
  );
}

export function expiryDescription(order: Order): string {
  if (order.expiryMode === 'fixed') return `${formatDuration(order.durationSeconds)} (ثابت)`;
  const count = order.candleCount > 1 ? `${order.candleCount} کندل` : 'پایان کندل جاری';
  return `${count} × ${timeframeLabel(order.timeframeSeconds)} (شناور)`;
}

export function orderHeadline(order: Order): string {
  return `<b>#${escapeHtml(order.id)}</b> · ${escapeHtml(order.symbol)} · ${DIRECTION_SHORT[order.direction]}`;
}

export function renderOrder(order: Order, timezone: string, options: { compact?: boolean } = {}): string {
  const lines: string[] = [
    orderHeadline(order),
    `وضعیت: ${STATUS_LABEL[order.status]}`,
    `قیمت ورود هدف: <code>${formatPrice(order.triggerPrice)}</code>`,
    `نحوهٔ ورود: ${TRIGGER_LABEL[order.triggerMode]}`,
    `مدت معامله: ${expiryDescription(order)}`,
    `چارت: ${timeframeLabel(order.timeframeSeconds)} · ${CHART_LABEL[order.chartType]}`,
    `مبلغ: ${formatMoney(order.amount)} · حساب: ${ACCOUNT_LABEL[order.accountMode]}`,
  ];

  if (options.compact !== true) {
    if (order.referencePrice !== null) {
      lines.push(`قیمت هنگام ثبت: <code>${formatPrice(order.referencePrice)}</code>`);
    }
    if (order.validUntil !== null) {
      lines.push(`اعتبار سفارش تا: ${formatTime(order.validUntil, timezone)}`);
    }
  }

  if (order.triggeredAt !== null) {
    lines.push(
      `برخورد قیمت: <code>${formatPrice(order.triggeredPrice)}</code> در ${formatTime(order.triggeredAt, timezone)}`,
    );
  }
  if (order.openedAt !== null) {
    lines.push(`باز شد در: ${formatTime(order.openedAt, timezone)} · قیمت <code>${formatPrice(order.openPrice)}</code>`);
  }
  if (order.closesAt !== null && order.closedAt === null) {
    lines.push(`زمان بسته شدن: ${formatTime(order.closesAt, timezone)}`);
  }
  if (order.closedAt !== null) {
    lines.push(`بسته شد در: ${formatTime(order.closedAt, timezone)} · قیمت <code>${formatPrice(order.closePrice)}</code>`);
    lines.push(`سود/زیان: <b>${formatMoney(order.profit)}</b>`);
  }
  if (order.note) lines.push(`یادداشت: ${escapeHtml(order.note)}`);

  return lines.join('\n');
}

export function withBalance(text: string, balance: number | null, show: boolean): string {
  if (!show || balance === null) return text;
  return `${text}\n\n💵 موجودی حساب: <b>${formatMoney(balance)}</b>`;
}
