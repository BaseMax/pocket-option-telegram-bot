/** One in-memory bot plus fake Telegram API, shared by every telegram test. */
import { createBot } from '../src/telegram/bot.ts';
import { openDatabase } from '../src/storage/db.ts';
import { OrderRepository } from '../src/storage/orders.ts';
import { SettingsStore } from '../src/storage/settings.ts';
import { TradeEngine } from '../src/engine/engine.ts';
import { FakeSessionManager, testConfig } from './fakes.ts';
import type { SessionManager } from '../src/engine/session.ts';
import type { Update } from 'grammy/types';

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
  /** message_id the fake API handed back, so tests can address the message the bot just sent. */
  sentId?: number;
}

const BOT_INFO = {
  id: 1,
  is_bot: true as const,
  first_name: 'Test',
  username: 'testbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

export function harness(adminIds: number[] = [1]) {
  const config = { ...testConfig, telegram: { ...testConfig.telegram, adminIds } };
  const db = openDatabase(':memory:');
  const settings = new SettingsStore(db, config);
  const orders = new OrderRepository(db);
  const sessions = new FakeSessionManager();
  const engine = new TradeEngine(config, orders, settings, sessions as unknown as SessionManager);
  const bot = createBot({ config, settings, orders, engine });

  const calls: ApiCall[] = [];
  let messageId = 100;
  bot.api.config.use((async (_prev: unknown, method: string, payload: Record<string, unknown>) => {
    const call: ApiCall = { method, payload };
    calls.push(call);
    if (method === 'sendMessage') {
      call.sentId = ++messageId;
      return {
        ok: true,
        result: {
          message_id: messageId,
          date: 0,
          chat: { id: payload['chat_id'], type: 'private' },
          text: payload['text'],
        },
      };
    }
    return { ok: true, result: true };
  }) as never);
  bot.botInfo = BOT_INFO;

  const texts = (): string[] =>
    calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload['text']));

  /** message_id of the last message the bot sent, i.e. the panel the user is looking at. */
  const panelId = (): number => calls.filter((c) => c.method === 'sendMessage').at(-1)!.sentId!;

  return { bot, calls, texts, panelId, orders, engine, settings, sessions };
}

let updateId = 0;
let msgId = 0;

export function textUpdate(text: string, chatId = 1): Update {
  updateId += 1;
  msgId += 1;
  const command = text.startsWith('/') ? (text.split(/\s/)[0] as string) : null;
  return {
    update_id: updateId,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: 'Tester' },
      from: { id: chatId, is_bot: false, first_name: 'Tester' },
      text,
      ...(command ? { entities: [{ type: 'bot_command' as const, offset: 0, length: command.length }] } : {}),
    },
  } as Update;
}

export function callbackUpdate(
  data: string,
  messageId: number,
  options: { chatId?: number; text?: string } = {},
): Update {
  const chatId = options.chatId ?? 1;
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from: { id: chatId, is_bot: false, first_name: 'Tester' },
      chat_instance: 'test',
      data,
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private', first_name: 'Tester' },
        text: options.text ?? 'panel text',
      },
    },
  } as Update;
}
