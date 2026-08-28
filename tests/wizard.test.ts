import { describe, expect, it } from 'bun:test';
import { harness, textUpdate, callbackUpdate } from './harness.ts';

describe('order wizard panel', () => {

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

  it('does not re-send an identical panel when the same button is tapped twice', async () => {
    const { bot, calls, panelId } = harness();
    await bot.handleUpdate(textUpdate('/new'));
    const panel = panelId();

    await bot.handleUpdate(callbackUpdate('w:valid', panel));
    await bot.handleUpdate(callbackUpdate('w:valid', panel));

    const edits = calls.filter((c) => c.method === 'editMessageText' && c.payload['message_id'] === panel);
    expect(edits).toHaveLength(1);
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
});
