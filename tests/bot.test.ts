import { describe, expect, it } from 'bun:test';
import { flush, testConfig } from './fakes.ts';
import { harness, textUpdate, callbackUpdate } from './harness.ts';

describe('Telegram commands', () => {
  it('answers /start with the help text', async () => {
    const { bot, texts } = harness();
    await bot.handleUpdate(textUpdate('/start'));
    expect(texts()[0]).toContain('ربات معاملات پاکت آپشن');
    expect(texts()[0]).toContain('/order');
  });

  it('opens the chart explanation from the /start guide', async () => {
    const { bot, texts, calls, panelId } = harness();
    await bot.handleUpdate(textUpdate('/start'));
    expect(texts()[0]).toContain('✍️');

    await bot.handleUpdate(callbackUpdate('h:chart', panelId()));
    const page = calls.filter((c) => c.method === 'editMessageText').at(-1)!;
    expect(String(page.payload['text'])).toContain('کندلی، هایکن‌آشی یا خطی');
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
