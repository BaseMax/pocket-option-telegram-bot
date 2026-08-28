import { describe, expect, it } from 'bun:test';
import { openDatabase } from '../src/storage/db.ts';
import { OrderRepository } from '../src/storage/orders.ts';
import { SettingsStore } from '../src/storage/settings.ts';
import { TradeEngine } from '../src/engine/engine.ts';
import { createBot } from '../src/telegram/bot.ts';
import { FakeSessionManager, flush, testConfig } from './fakes.ts';
import type { SessionManager } from '../src/engine/session.ts';
import type { Update } from 'grammy/types';

interface ApiCall {
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

function harness(adminIds: number[] = [1]) {
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

function textUpdate(text: string, chatId = 1): Update {
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

function callbackUpdate(
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

describe('Telegram commands', () => {
  it('answers /start with the help text', async () => {
    const { bot, texts } = harness();
    await bot.handleUpdate(textUpdate('/start'));
    expect(texts()[0]).toContain('ربات معاملات پاکت آپشن');
    expect(texts()[0]).toContain('/order');
  });

  it('walks the user through typing a value after tapping a wizard button', async () => {
    const { bot, calls, texts, panelId } = harness();
    await bot.handleUpdate(textUpdate('/new'));
    await bot.handleUpdate(callbackUpdate('w:valid', panelId()));

    const toast = calls.find((c) => c.method === 'answerCallbackQuery');
    expect(String(toast?.payload['text'])).toContain('تایپ کنید');

    const prompt = calls.filter((c) => c.method === 'sendMessage').at(-1)!;
    expect(String(prompt.payload['text'])).toContain('مدت اعتبار سفارش را تایپ کنید');
    expect(prompt.payload['reply_markup']).toMatchObject({ force_reply: true });
    expect(texts().join('\n')).toContain('۳۰ دقیقه');

    await bot.handleUpdate(textUpdate('1m'));
    const panel = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    expect(String(panel.payload['text'])).toContain('اعتبار سفارش: <b>1 دقیقه</b>');
    expect(calls.some((c) => c.method === 'deleteMessage')).toBe(true);
  });

  it('accepts a Persian duration for the order validity', async () => {
    const { bot, calls, panelId } = harness();
    await bot.handleUpdate(textUpdate('/new'));
    await bot.handleUpdate(callbackUpdate('w:valid', panelId()));
    await bot.handleUpdate(textUpdate('۲ ساعت و ۳۰ دقیقه'));

    const panel = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    expect(String(panel.payload['text'])).toContain('2 ساعت و 30 دقیقه');
  });

  it('explains the chart types when the chart button opens', async () => {
    const { bot, calls, panelId } = harness();
    await bot.handleUpdate(textUpdate('/new'));
    await bot.handleUpdate(callbackUpdate('w:chart', panelId()));

    const panel = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    const text = String(panel.payload['text']);
    expect(text).toContain('نوع چارت را انتخاب کنید');
    expect(text).toContain('هایکن‌آشی');
    expect(text).toContain('کندل استاندارد');
  });

  it('opens the chart explanation from the /start guide', async () => {
    const { bot, texts, calls, panelId } = harness();
    await bot.handleUpdate(textUpdate('/start'));
    expect(texts()[0]).toContain('✍️');

    await bot.handleUpdate(callbackUpdate('h:chart', panelId()));
    const page = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    expect(String(page.payload['text'])).toContain('کندلی، هایکن‌آشی یا خطی');
  });

  it('lets a command interrupt a pending wizard question', async () => {
    const { bot, calls, texts, panelId } = harness();
    await bot.handleUpdate(textUpdate('/new'));
    await bot.handleUpdate(callbackUpdate('w:amount', panelId()));
    await bot.handleUpdate(textUpdate('/settings'));

    expect(texts().at(-1)).toContain('تنظیمات پیش‌فرض');
    const panel = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    expect(String(panel.payload['text'])).not.toContain('مبلغ معامله را به دلار تایپ کنید');
  });

  it('freezes a panel whose draft the bot no longer has', async () => {
    const { bot, calls } = harness();
    await bot.handleUpdate(callbackUpdate('w:direction', 555));

    const edit = calls.find((c) => c.method === 'editMessageText')!;
    expect(edit.payload['message_id']).toBe(555);
    expect(String(edit.payload['text'])).toContain('panel text');
    expect(String(edit.payload['text'])).toContain('منقضی شده');
    expect(edit.payload['reply_markup']).toBeUndefined();
    expect(String(calls.find((c) => c.method === 'answerCallbackQuery')?.payload['text'])).toContain('منقضی');
  });

  it('does not touch a live panel when an older one is tapped', async () => {
    const { bot, calls, panelId } = harness();
    await bot.handleUpdate(textUpdate('/new'));
    const first = panelId();
    await bot.handleUpdate(textUpdate('/new'));
    const second = panelId();

    const replaced = calls.filter((c) => c.method === 'editMessageText' && c.payload['message_id'] === first);
    expect(replaced).toHaveLength(1);
    expect(String(replaced[0]!.payload['text'])).toContain('نماد:');
    expect(String(replaced[0]!.payload['text'])).toContain('باطل شد');
    expect(replaced[0]!.payload['reply_markup']).toBeUndefined();

    // Tapping the retired panel again touches nothing: not the live panel, and not the retired one either.
    const retired = String(replaced[0]!.payload['text']);
    await bot.handleUpdate(callbackUpdate('w:direction', first, { text: retired }));
    expect(calls.filter((c) => c.method === 'editMessageText' && c.payload['message_id'] === second)).toHaveLength(0);
    expect(calls.filter((c) => c.method === 'editMessageText' && c.payload['message_id'] === first)).toHaveLength(1);

    await bot.handleUpdate(callbackUpdate('w:direction', second));
    expect(calls.filter((c) => c.method === 'editMessageText' && c.payload['message_id'] === second)).toHaveLength(1);
  });

  it('keeps the summary on the panel when the draft is cancelled', async () => {
    const { bot, calls, panelId } = harness();
    await bot.handleUpdate(textUpdate('/new'));
    await bot.handleUpdate(callbackUpdate('w:cancel', panelId()));

    const edit = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    const text = String(edit.payload['text']);
    expect(text).toContain('نماد:');
    expect(text).toContain('❌ ساخت سفارش لغو شد.');
    expect(edit.payload['reply_markup']).toBeUndefined();
  });

  it('refuses chats that are not on the admin list and shows their id', async () => {
    const { bot, texts, calls } = harness([1]);
    await bot.handleUpdate(textUpdate('/start', 777));
    expect(texts()[0]).toContain('دسترسی ندارید');
    expect(texts()[0]).toContain('777');
    expect(calls.every((c) => c.payload['chat_id'] === 777)).toBe(true);
  });

  it('lets the first chat claim an unconfigured bot', async () => {
    const { bot, settings, texts } = harness([]);
    await bot.handleUpdate(textUpdate('/start', 42));
    expect(settings.get('owners')).toEqual([42]);
    expect(texts()[0]).toContain('ربات معاملات پاکت آپشن');
  });

  it('reads Persian and long-form units in the one-line command', async () => {
    const { bot, orders, sessions } = harness();
    sessions.acquire('demo', 'EURUSD').price = 1.07;
    await bot.handleUpdate(textUpdate('/order EURUSD BUY 1.08 dur=۲دقیقه tf=5MIN valid=1hour acc=دمو chart=هایکن'));
    await flush();

    const stored = orders.listActiveByChat(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      durationSeconds: 120,
      timeframeSeconds: 300,
      accountMode: 'demo',
      chartType: 'heikin_ashi',
    });
  });

  it('creates a pending order from the one-line command', async () => {
    const { bot, orders, sessions, texts } = harness();
    sessions.acquire('demo', 'GBPAUD_otc').price = 1.9;

    await bot.handleUpdate(textUpdate('/order GBPAUD_otc buy 1.9532 tf=1m dur=60 amount=3'));
    await flush();

    const stored = orders.listActiveByChat(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      symbol: 'GBPAUD_otc',
      direction: 'call',
      amount: 3,
      durationSeconds: 60,
      approachSide: 'below',
      referencePrice: 1.9,
    });
    expect(texts().join('\n')).toContain('در حال بررسی');
  });

  it('rejects an order whose amount is outside the configured limits', async () => {
    const { bot, orders, texts } = harness();
    await bot.handleUpdate(textUpdate('/order EURUSD buy 1.08 amount=999999'));
    await flush();

    expect(orders.listActiveByChat(1)).toHaveLength(0);
    expect(texts().join('\n')).toContain('مبلغ باید بین');
  });

  it('explains a malformed one-line command instead of silently failing', async () => {
    const { bot, orders, texts } = harness();
    await bot.handleUpdate(textUpdate('/order EURUSD sideways 1.08'));
    expect(orders.listActiveByChat(1)).toHaveLength(0);
    expect(texts().join('\n')).toContain('جهت معامله نامعتبر');
  });

  it('refuses an order when no session is configured for that account', async () => {
    const { bot, orders, sessions, texts } = harness();
    sessions.credentials = false;
    await bot.handleUpdate(textUpdate('/order EURUSD buy 1.08'));
    await flush();

    expect(orders.listActiveByChat(1)).toHaveLength(0);
    expect(texts().join('\n')).toContain('/session');
  });

  it('lists active orders and cancels one by id', async () => {
    const { bot, orders, sessions, texts } = harness();
    sessions.acquire('demo', 'GBPAUD_otc').price = 1.9;
    await bot.handleUpdate(textUpdate('/order GBPAUD_otc buy 1.9532'));
    await flush();

    const id = orders.listActiveByChat(1)[0]!.id;
    await bot.handleUpdate(textUpdate('/list'));
    expect(texts().join('\n')).toContain(id);

    await bot.handleUpdate(textUpdate(`/cancel ${id}`));
    expect(orders.get(id)!.status).toBe('cancelled');
    expect(texts().join('\n')).toContain('لغو شد');
  });

  it('does not let one chat cancel another chat\'s order', async () => {
    const { bot, orders, sessions } = harness([1, 2]);
    sessions.acquire('demo', 'GBPAUD_otc').price = 1.9;
    await bot.handleUpdate(textUpdate('/order GBPAUD_otc buy 1.9532', 1));
    await flush();

    const id = orders.listActiveByChat(1)[0]!.id;
    await bot.handleUpdate(textUpdate(`/cancel ${id}`, 2));
    expect(orders.get(id)!.status).toBe('pending');
  });

  it('switches the default account and warns about the missing session', async () => {
    const { bot, settings, sessions, texts } = harness();
    sessions.credentials = false;
    await bot.handleUpdate(textUpdate('/mode real'));
    expect(settings.get('defaultAccountMode')).toBe('real');
    expect(texts().join('\n')).toContain('/session real');
  });

  it('stores defaults through /set and shows them in /settings', async () => {
    const { bot, settings, texts } = harness();
    await bot.handleUpdate(textUpdate('/set amount 7'));
    await bot.handleUpdate(textUpdate('/set tf 5m'));
    await bot.handleUpdate(textUpdate('/set entry next'));
    await bot.handleUpdate(textUpdate('/set balance off'));

    expect(settings.get('defaultAmount')).toBe(7);
    expect(settings.get('defaultTimeframeSeconds')).toBe(300);
    expect(settings.get('defaultTriggerMode')).toBe('next_candle');
    expect(settings.get('notifyBalance')).toBe(false);

    await bot.handleUpdate(textUpdate('/settings'));
    const settingsText = texts().at(-1)!;
    expect(settingsText).toContain('5m');
    expect(settingsText).toContain('خاموش');
  });

  it('rejects an unknown /set key without changing anything', async () => {
    const { bot, settings, texts } = harness();
    await bot.handleUpdate(textUpdate('/set nonsense 5'));
    expect(texts().join('\n')).toContain('کلید ناشناخته');
    expect(settings.get('defaultAmount')).toBe(testConfig.defaults.amount);
  });

  it('deletes the message carrying an SSID', async () => {
    const { bot, calls } = harness();
    await bot.handleUpdate(textUpdate('/session demo 42["auth",{"session":"abc","isDemo":1,"uid":5,"platform":1}]'));
    expect(calls.some((c) => c.method === 'deleteMessage')).toBe(true);
  });

  it('rejects a symbol the broker does not list and suggests real ones', async () => {
    const { bot, orders, calls } = harness();
    await bot.handleUpdate(textUpdate('/order EURUSDD buy 1.9532'));
    await flush();

    const texts = calls.filter((c) => c.method === 'editMessageText').map((c) => String(c.payload.text));
    expect(texts.join('\n')).toContain('EURUSD_otc');
    expect(orders.listActive()).toHaveLength(0);
  });

  it('corrects a symbol that is missing its otc suffix', async () => {
    const { bot, orders, sessions } = harness();
    sessions.acquire('demo', 'GBPAUD_otc').price = 1.9;
    await bot.handleUpdate(textUpdate('/order gbpaudotc buy 1.9532'));
    await flush();

    expect(orders.listActive()[0]?.symbol).toBe('GBPAUD_otc');
  });

  it('reports engine events to the owning chat', async () => {
    const { bot, orders, engine, sessions, texts } = harness();
    sessions.acquire('demo', 'GBPAUD_otc').price = 1.9;
    await bot.handleUpdate(textUpdate('/order GBPAUD_otc buy 1.9532 dur=60'));
    await flush();

    const session = sessions.get('demo', 'GBPAUD_otc')!;
    session.tick(1000, 1.9532);
    await flush();

    const order = orders.listActiveByChat(1)[0]!;
    session.settle({
      dealId: order.dealId!,
      asset: 'GBPAUD_otc',
      profit: 1.8,
      amount: 1,
      closePrice: 1.96,
      closeTimestamp: 1060,
      raw: null,
    });
    await flush();

    const all = texts().join('\n');
    expect(all).toContain('قیمت به هدف رسید');
    expect(all).toContain('معامله باز شد');
    expect(all).toContain('برد');
    expect(all).toContain('موجودی حساب');
    void engine;
  });
});
