import { HTML, attempt } from '../reply.ts';
import {
  CHART_CYCLE,
  ACCOUNT_CYCLE,
  DIRECTION_CYCLE,
  EXPIRY_CYCLE,
  TRIGGER_CYCLE,
  applyInput,
  cycle,
  freshDraft,
  type OrderDraft,
} from './draft.ts';
import {
  EXPIRED_NOTE,
  REPLACED_NOTE,
  RETIRED_MARK,
  renderKeyboard,
  renderPanel,
  snapshot,
  type PanelView,
} from './panel.ts';
import { PROMPTS, type PromptField } from './prompts.ts';
import { CHART_HELP, EXPIRY_HELP, TRIGGER_HELP } from '../format.ts';
import type { Context } from 'grammy';
import type { SettingsStore } from '../../storage/settings.ts';
import type { AccountMode } from '../../types.ts';

export { draftToSpec, type OrderDraft } from './draft.ts';

const PROMPT_FIELDS: readonly PromptField[] = ['symbol', 'price', 'amount', 'duration', 'candles', 'valid'];

function isPromptField(action: string | undefined): action is PromptField {
  return PROMPT_FIELDS.includes(action as PromptField);
}

interface DraftState extends PanelView {
  messageId: number | null;
  promptMessageId: number | null;
  rendered: string | null;
}

export type WizardSubmit = (draft: OrderDraft, ctx: Context) => Promise<void>;

export type WizardSymbolCheck = (
  mode: AccountMode,
  raw: string,
) => Promise<{ symbol: string; problem: string | null; note: string | null }>;

/** Drives one inline panel per chat: taps change the draft, prompts collect what has to be typed. */
export class OrderWizard {
  private readonly settings: SettingsStore;
  private readonly submit: WizardSubmit;
  private readonly checkSymbol: WizardSymbolCheck | null;
  private readonly states = new Map<number, DraftState>();

  constructor(settings: SettingsStore, submit: WizardSubmit, checkSymbol?: WizardSymbolCheck) {
    this.settings = settings;
    this.submit = submit;
    this.checkSymbol = checkSymbol ?? null;
  }

  async open(ctx: Context, seed?: Partial<OrderDraft>): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const previous = this.states.get(chatId);
    if (previous) {
      await this.dropPrompt(ctx, previous);
      await this.retirePanel(ctx, previous, REPLACED_NOTE);
    }

    const state: DraftState = {
      draft: { ...freshDraft(this.settings.all, chatId), ...seed, chatId },
      menu: null,
      info: false,
      awaiting: null,
      messageId: null,
      promptMessageId: null,
      rendered: null,
    };
    this.states.set(chatId, state);

    const text = renderPanel(state);
    const keyboard = renderKeyboard(state);
    const message = await ctx.reply(text, { ...HTML, reply_markup: keyboard });
    state.messageId = message.message_id;
    state.rendered = snapshot(text, keyboard);
  }

  /** Drops a pending "type a value" prompt, for when the user runs a command instead of answering. */
  async abortPrompt(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const state = chatId === undefined ? undefined : this.states.get(chatId);
    if (!state?.awaiting) return;

    state.awaiting = null;
    await this.dropPrompt(ctx, state);
    await this.refresh(ctx, state);
  }

  /** Handles one panel tap. `payload` is the callback data after the `w:` prefix. */
  async handleCallback(ctx: Context, payload: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const state = this.states.get(chatId);
    if (!state) return this.rejectTap(ctx, EXPIRED_NOTE, 'این پنل منقضی شده است. برای سفارش تازه /new را بزنید.');

    // A panel this chat has since replaced: retire the tapped one and leave the live one alone.
    const tapped = ctx.callbackQuery?.message?.message_id;
    if (state.messageId !== null && tapped !== undefined && tapped !== state.messageId) {
      return this.rejectTap(ctx, REPLACED_NOTE, 'این پنل باطل شده است. از پنل تازه‌تر پایین چت استفاده کنید.');
    }

    const [action, argument] = payload.split(':');
    const d = state.draft;

    // Any tap answers or abandons the question we were waiting on.
    if (state.awaiting !== null) {
      state.awaiting = null;
      await this.dropPrompt(ctx, state);
    }

    if (isPromptField(action)) {
      state.awaiting = action;
      state.menu = null;
      await ctx.answerCallbackQuery({ text: `⌨️ ${PROMPTS[action].toast}` });
      await this.refresh(ctx, state);
      await this.sendPrompt(ctx, state, action);
      return;
    }

    switch (action) {
      case 'direction':
        d.direction = cycle(DIRECTION_CYCLE, d.direction);
        break;
      case 'account':
        d.accountMode = cycle(ACCOUNT_CYCLE, d.accountMode);
        break;
      case 'trigger':
        d.triggerMode = cycle(TRIGGER_CYCLE, d.triggerMode);
        return this.applied(ctx, state, TRIGGER_HELP[d.triggerMode]);
      case 'expiry':
        d.expiryMode = cycle(EXPIRY_CYCLE, d.expiryMode);
        return this.applied(ctx, state, EXPIRY_HELP[d.expiryMode]);
      case 'info':
        state.info = !state.info;
        break;

      case 'chart': {
        if (argument === undefined) {
          state.menu = 'chart';
          return this.applied(ctx, state, 'توضیح هر نوع چارت را زیر پنل بخوانید.');
        }
        const chart = CHART_CYCLE.find((value) => value === argument);
        if (chart) d.chartType = chart;
        state.menu = null;
        return this.applied(ctx, state, chart ? CHART_HELP[chart] : '');
      }

      case 'tf': {
        if (argument === undefined) {
          state.menu = 'tf';
          break;
        }
        const seconds = Number(argument);
        if (Number.isFinite(seconds) && seconds > 0) d.timeframeSeconds = seconds;
        state.menu = null;
        break;
      }

      case 'refresh':
        state.menu = null;
        break;

      case 'cancel':
        this.states.delete(chatId);
        await ctx.answerCallbackQuery({ text: 'لغو شد.' });
        await this.retirePanel(ctx, state, '❌ ساخت سفارش لغو شد.');
        return;

      case 'submit': {
        if (d.symbol === null || d.triggerPrice === null) {
          await ctx.answerCallbackQuery({
            text: 'اول نماد و قیمت ورود را کامل کنید: روی دکمه‌شان بزنید و مقدار را تایپ کنید.',
            show_alert: true,
          });
          await this.refresh(ctx, state);
          return;
        }
        this.states.delete(chatId);
        state.menu = null;
        state.info = false;
        await ctx.answerCallbackQuery({ text: 'در حال ثبت…' });
        await this.freeze(ctx, state, renderPanel(state, true));
        await this.submit(d, ctx);
        return;
      }

      default:
        await ctx.answerCallbackQuery();
        return;
    }

    await this.applied(ctx, state);
  }

  async handleText(ctx: Context): Promise<boolean> {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;
    if (chatId === undefined || text === undefined) return false;

    const state = this.states.get(chatId);
    if (!state?.awaiting) return false;

    const field = state.awaiting;
    const problem = applyInput(state.draft, field, text);
    if (problem !== null) return this.askAgain(ctx, field, problem);

    if (field === 'symbol' && this.checkSymbol && state.draft.symbol !== null) {
      const verdict = await this.verifySymbol(ctx, state.draft.accountMode, state.draft.symbol);
      if (verdict.problem !== null) {
        state.draft.symbol = null;
        return this.askAgain(ctx, field, verdict.problem);
      }
      state.draft.symbol = verdict.symbol;
      if (verdict.note !== null) await ctx.reply(verdict.note, HTML);
    }

    state.awaiting = null;
    await this.dropPrompt(ctx, state);
    await this.refresh(ctx, state);
    await attempt('could not delete the answered prompt', ctx.api.deleteMessage(chatId, ctx.message!.message_id));
    return true;
  }

  /** Shows the "checking…" notice while the broker is asked whether the symbol exists. */
  private async verifySymbol(
    ctx: Context,
    mode: AccountMode,
    symbol: string,
  ): Promise<{ symbol: string; problem: string | null; note: string | null }> {
    const checking = await ctx.reply('⏳ در حال بررسی نماد نزد کارگزار…');
    try {
      return await this.checkSymbol!(mode, symbol);
    } finally {
      await attempt('could not delete the checking notice', ctx.api.deleteMessage(ctx.chat!.id, checking.message_id));
    }
  }

  /** Repeats the question with the reply box still open, so a typo does not end the conversation. */
  private async askAgain(ctx: Context, field: PromptField, problem: string): Promise<true> {
    await ctx.reply(`⚠️ ${problem}`, {
      ...HTML,
      reply_markup: { force_reply: true, input_field_placeholder: PROMPTS[field].placeholder },
    });
    return true;
  }

  /** Asks for one value in its own message, with the reply box already open on the user's phone. */
  private async sendPrompt(ctx: Context, state: DraftState, field: PromptField): Promise<void> {
    await this.dropPrompt(ctx, state);
    const copy = PROMPTS[field];
    const message = await ctx.reply(copy.message, {
      ...HTML,
      reply_markup: { force_reply: true, input_field_placeholder: copy.placeholder },
    });
    state.promptMessageId = message.message_id;
  }

  private async dropPrompt(ctx: Context, state: DraftState): Promise<void> {
    const messageId = state.promptMessageId;
    state.promptMessageId = null;
    if (messageId === null) return;
    await attempt('could not delete the prompt message', ctx.api.deleteMessage(state.draft.chatId, messageId));
  }

  /** The tail of most taps: acknowledge, then redraw the panel. */
  private async applied(ctx: Context, state: DraftState, toast?: string): Promise<void> {
    await ctx.answerCallbackQuery(toast === undefined ? undefined : { text: toast });
    await this.refresh(ctx, state);
  }

  private async rejectTap(ctx: Context, note: string, toast: string): Promise<void> {
    await this.retireOrphan(ctx, note);
    await ctx.answerCallbackQuery({ text: toast });
  }

  private async refresh(ctx: Context, state: DraftState): Promise<void> {
    if (state.messageId === null) return;

    const text = renderPanel(state);
    const markup = renderKeyboard(state);
    const next = snapshot(text, markup);
    if (next === state.rendered) return;

    // Claimed before the call so a second tap on the same button does not send the very same edit.
    state.rendered = next;
    const edited = await attempt(
      'could not refresh the wizard panel',
      ctx.api.editMessageText(state.draft.chatId, state.messageId, text, { ...HTML, reply_markup: markup }),
    );
    // A real failure: forget what is on screen so the next tap redraws instead of assuming it matched.
    if (!edited) state.rendered = null;
  }

  /** Leaves the panel readable but dead: the summary stays, the buttons go, a note says why. */
  private async freeze(ctx: Context, state: DraftState, text: string): Promise<void> {
    if (state.messageId === null) return;
    state.rendered = null;
    await attempt(
      'could not freeze the wizard panel',
      ctx.api.editMessageText(state.draft.chatId, state.messageId, text, HTML),
    );
  }

  private async retirePanel(ctx: Context, state: DraftState, note: string): Promise<void> {
    await this.freeze(ctx, state, `${renderPanel(state, true)}\n\n${note}`);
  }

  /**
   * Retires a panel whose draft we lost, after a restart or when an older panel is tapped.
   * Telegram hands back the text and its formatting, so the summary survives and we only append the note.
   */
  private async retireOrphan(ctx: Context, note: string): Promise<void> {
    const message = ctx.callbackQuery?.message;
    if (!message || !('text' in message) || typeof message.text !== 'string') return;
    if (message.text.includes(RETIRED_MARK)) return;

    await attempt(
      'could not retire an orphan panel',
      ctx.api.editMessageText(message.chat.id, message.message_id, `${message.text}\n\n${note}`, {
        entities: message.entities ?? [],
      }),
    );
  }
}
