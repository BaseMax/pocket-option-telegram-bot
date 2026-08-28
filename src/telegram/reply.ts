import { createLogger } from '../logger.ts';
import { errorMessage } from '../util/errors.ts';
import { escapeHtml } from './format.ts';
import type { Context } from 'grammy';

const logger = createLogger('telegram');

/** Every message this bot writes is HTML, and link previews only add noise. */
export const HTML = {
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
} as const;

/** Telegram refuses an edit that changes nothing, which for us means the screen already matches. */
function isUnchanged(error: unknown): boolean {
  return errorMessage(error).includes('message is not modified');
}

/**
 * Runs a Telegram call whose failure should not interrupt the user: an edit on a message they
 * already deleted, a delete on a message that is gone. Returns whether the screen now says what
 * we wanted, so "nothing to change" counts as success and is not worth a log line.
 */
export async function attempt(what: string, call: Promise<unknown>): Promise<boolean> {
  try {
    await call;
    return true;
  } catch (error) {
    if (isUnchanged(error)) return true;
    logger.debug(`${what}: ${errorMessage(error)}`);
    return false;
  }
}

/** A "⏳ working…" placeholder that later becomes the answer, so slow commands feel alive. */
export interface Notice {
  /** Rewrites the placeholder. Returns false when the message could not be edited. */
  update(text: string, extra?: Record<string, unknown>): Promise<boolean>;
  /** Rewrites the placeholder with a thrown error, already escaped. */
  fail(error: unknown): Promise<boolean>;
}

export async function openNotice(ctx: Context, placeholder: string): Promise<Notice> {
  const chatId = ctx.chat!.id;
  const message = await ctx.reply(placeholder, HTML);

  const update = (text: string, extra: Record<string, unknown> = {}): Promise<boolean> =>
    attempt(
      'could not edit the notice message',
      ctx.api.editMessageText(chatId, message.message_id, text, { ...HTML, ...extra }),
    );

  return {
    update,
    fail: (error: unknown) => update(`⚠️ ${escapeHtml(errorMessage(error))}`),
  };
}
