import { InlineKeyboard } from 'grammy';
import { formatDuration, formatDurationFa, timeframeLabel, TIMEFRAMES } from '../../util/time.ts';
import {
  ACCOUNT_LABEL,
  CHART_HELP,
  CHART_LABEL,
  DIRECTION_SHORT,
  EXPIRY_HELP,
  EXPIRY_LABEL,
  TRIGGER_HELP,
  TRIGGER_LABEL,
  escapeHtml,
  formatMoney,
  formatPrice,
} from '../format.ts';
import { CHART_CYCLE, type OrderDraft } from './draft.ts';
import { PROMPTS, type PromptField } from './prompts.ts';

/** The panel either shows the order, or one of the pickers that temporarily takes it over. */
export type Menu = 'tf' | 'chart' | null;

/** Everything the panel needs to draw itself. The wizard owns the rest of the state. */
export interface PanelView {
  draft: OrderDraft;
  menu: Menu;
  info: boolean;
  awaiting: PromptField | null;
}

/** The sentence stamped on a panel that no longer works. Its start also marks a panel as retired. */
export const RETIRED_MARK = '⌛️ این پنل';
export const EXPIRED_NOTE = `${RETIRED_MARK} منقضی شده و دکمه‌هایش دیگر کار نمی‌کنند. برای سفارش تازه /new را بزنید.`;
export const REPLACED_NOTE = `${RETIRED_MARK} باطل شد چون پنل تازه‌تری ساخته شد. از پنل جدید استفاده کنید.`;

function summary(draft: OrderDraft): string[] {
  return [
    '🧾 <b>ساخت سفارش جدید</b>',
    '',
    `نماد: <b>${draft.symbol ? escapeHtml(draft.symbol) : '(انتخاب نشده)'}</b>`,
    `قیمت ورود هدف: <b>${draft.triggerPrice === null ? '(تعیین نشده)' : formatPrice(draft.triggerPrice)}</b>`,
    `جهت: <b>${DIRECTION_SHORT[draft.direction]}</b>`,
    `نحوهٔ ورود: <b>${TRIGGER_LABEL[draft.triggerMode]}</b>`,
    draft.expiryMode === 'fixed'
      ? `مدت معامله: <b>${formatDurationFa(draft.durationSeconds)}</b> (${EXPIRY_LABEL.fixed})`
      : `مدت معامله: <b>${draft.candleCount} کندل ${timeframeLabel(draft.timeframeSeconds)}</b> (${EXPIRY_LABEL.floating})`,
    `چارت: <b>${timeframeLabel(draft.timeframeSeconds)} · ${CHART_LABEL[draft.chartType]}</b>`,
    `مبلغ: <b>${formatMoney(draft.amount)}</b>`,
    `حساب: <b>${ACCOUNT_LABEL[draft.accountMode]}</b>`,
    `اعتبار سفارش: <b>${draft.validForSeconds === null ? 'بدون محدودیت' : formatDurationFa(draft.validForSeconds)}</b>`,
  ];
}

function helpBlock(draft: OrderDraft): string[] {
  return [
    '',
    '❓ <b>هر گزینه چه می‌کند؟</b>',
    '',
    '<b>جهت</b> — خرید یعنی پیش‌بینی می‌کنید قیمت بالا برود، فروش یعنی پایین.',
    `<b>نحوهٔ ورود</b> — ${TRIGGER_HELP[draft.triggerMode]}`,
    `<b>انقضا</b> — ${EXPIRY_HELP[draft.expiryMode]}`,
    `<b>چارت</b> — ${CHART_HELP[draft.chartType]}`,
    '<b>اعتبار سفارش</b> — اگر تا این مدت قیمت به هدف نرسد، سفارش لغو می‌شود.',
    '',
    'دکمه‌های نماد، قیمت، مبلغ، مدت و اعتبار مقدارشان را از شما می‌پرسند: بعد از زدنشان باید مقدار را تایپ کنید و بفرستید.',
  ];
}

/**
 * Draws the panel body.
 * `final` renders the frozen panel left behind after submit, cancel or expiry, where no button hint applies.
 */
export function renderPanel(view: PanelView, final = false): string {
  const lines = summary(view.draft);
  if (final) return lines.join('\n');

  if (view.menu === 'chart') {
    lines.push('', '📈 <b>نوع چارت را انتخاب کنید</b>', '');
    for (const chart of CHART_CYCLE) lines.push(`• <b>${CHART_LABEL[chart]}</b> — ${CHART_HELP[chart]}`);
    lines.push(
      '',
      'نوع چارت فقط روی کندل‌هایی اثر دارد که ربات برای انقضای شناور می‌شمارد؛ قیمت ورود و بسته شدن همیشه قیمت واقعی بازار است.',
    );
    return lines.join('\n');
  }

  if (view.menu === 'tf') {
    lines.push(
      '',
      '⏱ <b>تایم‌فریم چارت را انتخاب کنید</b>',
      '',
      'طول هر کندل چقدر باشد. در انقضای شناور، معامله تا پایان همین کندل‌ها باز می‌ماند.',
    );
    return lines.join('\n');
  }

  if (view.info) lines.push(...helpBlock(view.draft));

  if (view.awaiting) {
    lines.push('', `✍️ ${PROMPTS[view.awaiting].panel}`, 'پاسخ را در همین چت بنویسید و بفرستید.');
  } else if (view.draft.symbol === null || view.draft.triggerPrice === null) {
    lines.push('', '⚠️ برای ثبت، نماد و قیمت ورود هدف الزامی است. روی دکمه‌شان بزنید و مقدار را تایپ کنید.');
  } else {
    lines.push('', '💡 روی هر دکمه بزنید تا تغییر کند. دکمه‌های ✍️ مقدارشان را از شما می‌پرسند.');
  }
  return lines.join('\n');
}

function timeframeKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  TIMEFRAMES.forEach((tf, index) => {
    keyboard.text(tf.label, `w:tf:${tf.seconds}`);
    if ((index + 1) % 4 === 0) keyboard.row();
  });
  return keyboard.row().text('« بازگشت', 'w:refresh');
}

function chartKeyboard(draft: OrderDraft): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const chart of CHART_CYCLE) {
    keyboard.text(`${draft.chartType === chart ? '✅ ' : ''}${CHART_LABEL[chart]}`, `w:chart:${chart}`).row();
  }
  return keyboard.text('« بازگشت', 'w:refresh');
}

export function renderKeyboard(view: PanelView): InlineKeyboard {
  const d = view.draft;
  if (view.menu === 'tf') return timeframeKeyboard();
  if (view.menu === 'chart') return chartKeyboard(d);

  const keyboard = new InlineKeyboard()
    .text(`✍️ نماد: ${d.symbol ?? '—'}`, 'w:symbol')
    .text(`✍️ قیمت: ${d.triggerPrice === null ? '—' : formatPrice(d.triggerPrice)}`, 'w:price')
    .row()
    .text(`جهت: ${d.direction === 'call' ? 'خرید' : 'فروش'}`, 'w:direction')
    .text(`حساب: ${d.accountMode === 'demo' ? 'دمو' : 'ریل'}`, 'w:account')
    .row()
    .text(`ورود: ${d.triggerMode === 'touch' ? 'لحظه‌ای' : 'کندل بعدی'}`, 'w:trigger')
    .text(`انقضا: ${d.expiryMode === 'fixed' ? 'ثابت' : 'شناور'}`, 'w:expiry')
    .row();

  if (d.expiryMode === 'fixed') keyboard.text(`✍️ مدت: ${formatDuration(d.durationSeconds)}`, 'w:duration');
  else keyboard.text(`✍️ تعداد کندل: ${d.candleCount}`, 'w:candles');

  return keyboard
    .text(`تایم‌فریم: ${timeframeLabel(d.timeframeSeconds)}`, 'w:tf')
    .row()
    .text(`چارت: ${CHART_LABEL[d.chartType]}`, 'w:chart')
    .text(`✍️ مبلغ: ${formatMoney(d.amount)}`, 'w:amount')
    .row()
    .text(`✍️ اعتبار: ${d.validForSeconds === null ? '∞' : formatDuration(d.validForSeconds)}`, 'w:valid')
    .text(view.info ? '✖️ بستن راهنما' : '❓ راهنما', 'w:info')
    .row()
    .text('✅ ثبت سفارش', 'w:submit')
    .text('❌ انصراف', 'w:cancel');
}

/** What the panel currently looks like, so we never send an edit Telegram would reject as identical. */
export function snapshot(text: string, keyboard: InlineKeyboard): string {
  return JSON.stringify({ text, markup: keyboard.inline_keyboard });
}
