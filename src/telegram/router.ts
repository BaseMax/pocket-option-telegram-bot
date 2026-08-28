import { createLogger } from '../logger.ts';
import { errorMessage } from '../util/errors.ts';
import type { Context } from 'grammy';

const logger = createLogger('telegram');

/** Handles one family of inline buttons. `payload` is the callback data after the `prefix:`. */
export type CallbackHandler = (ctx: Context, payload: string) => Promise<void>;

/**
 * Inline buttons carry `prefix:payload` data; each feature claims a prefix and gets its taps.
 * Keeping the table here means a new button family never has to touch the dispatch code.
 */
export class CallbackRouter {
  private readonly routes = new Map<string, CallbackHandler>();

  on(prefix: string, handler: CallbackHandler): void {
    this.routes.set(prefix, handler);
  }

  async dispatch(ctx: Context): Promise<void> {
    const data = ctx.callbackQuery?.data ?? '';
    const separator = data.indexOf(':');
    const handler = separator < 0 ? undefined : this.routes.get(data.slice(0, separator));
    if (!handler) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      await handler(ctx, data.slice(separator + 1));
    } catch (error) {
      logger.error(`callback ${data} failed: ${errorMessage(error)}`);
      await ctx.answerCallbackQuery({ text: '⚠️ انجام نشد. دوباره تلاش کنید.' }).catch(() => undefined);
    }
  }
}
