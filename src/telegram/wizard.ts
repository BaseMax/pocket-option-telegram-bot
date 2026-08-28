import { InlineKeyboard } from 'grammy';
import { createLogger } from '../logger.ts';
import type { Context } from 'grammy';
import { parseDuration, formatDuration, timeframeLabel, TIMEFRAMES } from '../util/time.ts';
import { normalizeSymbol, parseNumber } from './parse.ts';
import {
  ACCOUNT_LABEL,
  CHART_LABEL,
  DIRECTION_SHORT,
  EXPIRY_LABEL,
  TRIGGER_LABEL,
  escapeHtml,
  formatMoney,
  formatPrice,
} from './format.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { AccountMode, ChartType, Direction, ExpiryMode, TriggerMode } from '../types.ts';

export interface OrderDraft {
  chatId: number;
  symbol: string | null;
  direction: Direction;
  triggerPrice: number | null;
  triggerMode: TriggerMode;
  timeframeSeconds: number;
  chartType: ChartType;
  expiryMode: ExpiryMode;
  durationSeconds: number;
  candleCount: number;
  amount: number;
  accountMode: AccountMode;
  validForSeconds: number | null;
}

type PromptField = 'symbol' | 'price' | 'amount' | 'duration' | 'candles' | 'valid';

interface DraftState {
  draft: OrderDraft;
  messageId: number | null;
  awaiting: PromptField | null;
}

const PROMPTS: Record<PromptField, string> = {
  symbol: 'نماد را بفرستید (مثلاً <code>GBPAUD_otc</code> یا <code>EURUSD</code>):',
  price: 'قیمت ورود هدف را بفرستید (مثلاً <code>1.95320</code>):',
  amount: 'مبلغ معامله را به دلار بفرستید (مثلاً <code>5</code>):',
  duration: 'مدت ماندن در معامله را بفرستید (مثلاً <code>60</code> یا <code>1m</code> یا <code>31s</code>):',
  candles: 'چند کندل در معامله بماند؟ (مثلاً <code>1</code>):',
  valid: 'اعتبار سفارش تا چه مدت؟ (مثلاً <code>30m</code>، برای بی‌نهایت بفرستید <code>0</code>):',
};

const DIRECTION_CYCLE: Direction[] = ['call', 'put'];
const TRIGGER_CYCLE: TriggerMode[] = ['touch', 'next_candle'];
const EXPIRY_CYCLE: ExpiryMode[] = ['fixed', 'floating'];
const CHART_CYCLE: ChartType[] = ['candle', 'heikin_ashi', 'line'];
const ACCOUNT_CYCLE: AccountMode[] = ['demo', 'real'];

function cycle<T>(values: T[], current: T): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] as T;
}

export type WizardSubmit = (draft: OrderDraft, ctx: Context) => Promise<void>;

const logger = createLogger('wizard');

export class OrderWizard {
  private readonly settings: SettingsStore;
  private readonly submit: WizardSubmit;
  private readonly states = new Map<number, DraftState>();

  constructor(settings: SettingsStore, submit: WizardSubmit) {
    this.settings = settings;
    this.submit = submit;
  }

  private freshDraft(chatId: number): OrderDraft {
    const s = this.settings.all;
    return {
      chatId,
      symbol: null,
      direction: 'call',
      triggerPrice: null,
      triggerMode: s.defaultTriggerMode,
      timeframeSeconds: s.defaultTimeframeSeconds,
      chartType: s.defaultChartType,
      expiryMode: s.defaultExpiryMode,
      durationSeconds: s.defaultDurationSeconds,
      candleCount: s.defaultCandleCount,
      amount: s.defaultAmount,
      accountMode: s.defaultAccountMode,
      validForSeconds: null,
    };
  }
  async open(ctx: Context, seed?: Partial<OrderDraft>): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const draft = { ...this.freshDraft(chatId), ...seed, chatId };
    const state: DraftState = { draft, messageId: null, awaiting: null };
    this.states.set(chatId, state);

    const message = await ctx.reply(this.renderText(state), {
      parse_mode: 'HTML',
      reply_markup: this.renderKeyboard(state),
    });
    state.messageId = message.message_id;
  }

  hasDraft(chatId: number): boolean {
    return this.states.has(chatId);
  }

  isAwaitingInput(chatId: number): boolean {
    return this.states.get(chatId)?.awaiting !== null && this.states.has(chatId);
  }

  private renderText(state: DraftState): string {
    const d = state.draft;
    const lines = [
      '🧾 <b>ساخت سفارش جدید</b>',
      '',
      `نماد: <b>${d.symbol ? escapeHtml(d.symbol) : '(انتخاب نشده)'}</b>`,
      `قیمت ورود هدف: <b>${d.triggerPrice === null ? '(تعیین نشده)' : formatPrice(d.triggerPrice)}</b>`,
      `جهت: <b>${DIRECTION_SHORT[d.direction]}</b>`,
      `نحوهٔ ورود: <b>${TRIGGER_LABEL[d.triggerMode]}</b>`,
      d.expiryMode === 'fixed'
        ? `مدت معامله: <b>${formatDuration(d.durationSeconds)}</b> (${EXPIRY_LABEL.fixed})`
        : `مدت معامله: <b>${d.candleCount} کندل ${timeframeLabel(d.timeframeSeconds)}</b> (${EXPIRY_LABEL.floating})`,
      `چارت: <b>${timeframeLabel(d.timeframeSeconds)} · ${CHART_LABEL[d.chartType]}</b>`,
      `مبلغ: <b>${formatMoney(d.amount)}</b>`,
      `حساب: <b>${ACCOUNT_LABEL[d.accountMode]}</b>`,
      `اعتبار سفارش: <b>${d.validForSeconds === null ? 'بدون محدودیت' : formatDuration(d.validForSeconds)}</b>`,
    ];

    if (state.awaiting) {
      lines.push('', `✍️ ${PROMPTS[state.awaiting]}`);
    } else if (d.symbol === null || d.triggerPrice === null) {
      lines.push('', '⚠️ برای ثبت، نماد و قیمت ورود هدف الزامی است.');
    }
    return lines.join('\n');
  }

  private renderKeyboard(state: DraftState): InlineKeyboard {
    const d = state.draft;
    const keyboard = new InlineKeyboard()
      .text(`نماد: ${d.symbol ?? '-'}`, 'w:symbol')
      .text(`قیمت: ${d.triggerPrice === null ? '-' : formatPrice(d.triggerPrice)}`, 'w:price')
      .row()
      .text(`جهت: ${d.direction === 'call' ? 'خرید' : 'فروش'}`, 'w:direction')
      .text(`حساب: ${d.accountMode === 'demo' ? 'دمو' : 'ریل'}`, 'w:account')
      .row()
      .text(`ورود: ${d.triggerMode === 'touch' ? 'لحظه‌ای' : 'کندل بعدی'}`, 'w:trigger')
      .text(`انقضا: ${d.expiryMode === 'fixed' ? 'ثابت' : 'شناور'}`, 'w:expiry')
      .row();

    if (d.expiryMode === 'fixed') {
      keyboard.text(`مدت: ${formatDuration(d.durationSeconds)}`, 'w:duration');
    } else {
      keyboard.text(`تعداد کندل: ${d.candleCount}`, 'w:candles');
    }
    keyboard.text(`تایم‌فریم: ${timeframeLabel(d.timeframeSeconds)}`, 'w:tf').row();

    keyboard
      .text(`چارت: ${CHART_LABEL[d.chartType]}`, 'w:chart')
      .text(`مبلغ: ${formatMoney(d.amount)}`, 'w:amount')
      .row()
      .text(`اعتبار: ${d.validForSeconds === null ? '∞' : formatDuration(d.validForSeconds)}`, 'w:valid')
      .row()
      .text('✅ ثبت سفارش', 'w:submit')
      .text('❌ انصراف', 'w:cancel');

    return keyboard;
  }

  private timeframeKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    TIMEFRAMES.forEach((tf, index) => {
      keyboard.text(tf.label, `w:tf:${tf.seconds}`);
      if ((index + 1) % 4 === 0) keyboard.row();
    });
    keyboard.row().text('« بازگشت', 'w:refresh');
    return keyboard;
  }

  private async refresh(ctx: Context, state: DraftState, keyboard?: InlineKeyboard): Promise<void> {
    if (state.messageId === null) return;
    try {
      await ctx.api.editMessageText(state.draft.chatId, state.messageId, this.renderText(state), {
        parse_mode: 'HTML',
        reply_markup: keyboard ?? this.renderKeyboard(state),
      });
    } catch (error) {
      logger.debug('panel refresh rejected by Telegram', error);
    }
  }
  async handleCallback(ctx: Context): Promise<boolean> {
    const data = ctx.callbackQuery?.data;
    const chatId = ctx.chat?.id;
    if (!data?.startsWith('w:') || chatId === undefined) return false;

    const state = this.states.get(chatId);
    if (!state) {
      await ctx.answerCallbackQuery({ text: 'این پنل منقضی شده است. دوباره /new بزنید.' });
      return true;
    }

    const [, action, argument] = data.split(':');
    const d = state.draft;

    switch (action) {
      case 'direction':
        d.direction = cycle(DIRECTION_CYCLE, d.direction);
        break;
      case 'account':
        d.accountMode = cycle(ACCOUNT_CYCLE, d.accountMode);
        break;
      case 'trigger':
        d.triggerMode = cycle(TRIGGER_CYCLE, d.triggerMode);
        break;
      case 'expiry':
        d.expiryMode = cycle(EXPIRY_CYCLE, d.expiryMode);
        break;
      case 'chart':
        d.chartType = cycle(CHART_CYCLE, d.chartType);
        break;

      case 'tf': {
        if (argument === undefined) {
          await ctx.answerCallbackQuery();
          await this.refresh(ctx, state, this.timeframeKeyboard());
          return true;
        }
        const seconds = Number(argument);
        if (Number.isFinite(seconds) && seconds > 0) d.timeframeSeconds = seconds;
        break;
      }

      case 'refresh':
        break;

      case 'symbol':
      case 'price':
      case 'amount':
      case 'duration':
      case 'candles':
      case 'valid':
        state.awaiting = action;
        await ctx.answerCallbackQuery();
        await this.refresh(ctx, state);
        return true;

      case 'cancel':
        this.states.delete(chatId);
        await ctx.answerCallbackQuery({ text: 'لغو شد.' });
        if (state.messageId !== null) {
          await ctx.api
            .editMessageText(chatId, state.messageId, '❌ ساخت سفارش لغو شد.', { parse_mode: 'HTML' })
            .catch((error: unknown) => logger.debug('could not update the wizard panel', error));
        }
        return true;

      case 'submit': {
        if (d.symbol === null || d.triggerPrice === null) {
          await ctx.answerCallbackQuery({ text: 'نماد و قیمت ورود را کامل کنید.', show_alert: true });
          return true;
        }
        await ctx.answerCallbackQuery({ text: 'در حال ثبت…' });
        this.states.delete(chatId);
        if (state.messageId !== null) {
          await ctx.api
            .editMessageText(chatId, state.messageId, this.renderText(state), { parse_mode: 'HTML' })
            .catch((error: unknown) => logger.debug('could not update the wizard panel', error));
        }
        await this.submit(d, ctx);
        return true;
      }

      default:
        await ctx.answerCallbackQuery();
        return true;
    }

    await ctx.answerCallbackQuery();
    await this.refresh(ctx, state);
    return true;
  }
  async handleText(ctx: Context): Promise<boolean> {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;
    if (chatId === undefined || text === undefined) return false;

    const state = this.states.get(chatId);
    if (!state?.awaiting) return false;

    const field = state.awaiting;
    const error = this.applyInput(state.draft, field, text);
    if (error !== null) {
      await ctx.reply(`⚠️ ${error}`, { parse_mode: 'HTML' });
      return true;
    }

    state.awaiting = null;
    await this.refresh(ctx, state);
    await ctx.api
      .deleteMessage(chatId, ctx.message!.message_id)
      .catch((error: unknown) => logger.debug('could not delete the answered prompt', error));
    return true;
  }
  private applyInput(draft: OrderDraft, field: PromptField, raw: string): string | null {
    switch (field) {
      case 'symbol': {
        const symbol = normalizeSymbol(raw);
        if (symbol.length < 3) return 'نماد نامعتبر است.';
        draft.symbol = symbol;
        return null;
      }
      case 'price': {
        const price = parseNumber(raw);
        if (price === null || price <= 0) return 'قیمت نامعتبر است.';
        draft.triggerPrice = price;
        return null;
      }
      case 'amount': {
        const amount = parseNumber(raw);
        if (amount === null || amount <= 0) return 'مبلغ نامعتبر است.';
        draft.amount = amount;
        return null;
      }
      case 'duration': {
        const seconds = parseDuration(raw);
        if (seconds === null) return 'مدت نامعتبر است. مثلاً 60 یا 1m یا 31s.';
        draft.durationSeconds = seconds;
        draft.expiryMode = 'fixed';
        return null;
      }
      case 'candles': {
        const count = parseNumber(raw);
        if (count === null || count < 1) return 'تعداد کندل نامعتبر است.';
        draft.candleCount = Math.round(count);
        draft.expiryMode = 'floating';
        return null;
      }
      case 'valid': {
        const trimmed = raw.trim();
        if (trimmed === '0' || trimmed === '۰') {
          draft.validForSeconds = null;
          return null;
        }
        const seconds = parseDuration(trimmed);
        if (seconds === null) return 'مدت اعتبار نامعتبر است. مثلاً 30m.';
        draft.validForSeconds = seconds;
        return null;
      }
      default:
        return 'فیلد ناشناخته.';
    }
  }
}
