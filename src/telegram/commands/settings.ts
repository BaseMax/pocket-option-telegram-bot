import { formatDuration, parseDuration, timeframeLabel } from '../../util/time.ts';
import { attempt, HTML, openNotice } from '../reply.ts';
import { parseSsid, SsidParseError } from '../../util/ssid.ts';
import { errorMessage } from '../../util/errors.ts';
import {
  parseAccountMode,
  parseChartType,
  parseExpiryMode,
  parseNumber,
  parseTriggerMode,
} from '../parse.ts';
import {
  ACCOUNT_LABEL,
  CHART_LABEL,
  EXPIRY_LABEL,
  TRIGGER_LABEL,
  escapeHtml,
  formatMoney,
} from '../format.ts';
import { SESSION_HELP } from '../texts.ts';
import { TIME_FORMAT_HINT } from '../wizard/prompts.ts';
import type { SettingsStore } from '../../storage/settings.ts';
import type { BotRuntime } from '../runtime.ts';

const TRUE_WORDS = ['on', 'true', '1', 'yes', 'روشن', 'بله'];
const FALSE_WORDS = ['off', 'false', '0', 'no', 'خاموش', 'نه'];

interface SettingField {
  /** Every spelling of this field accepted by /set. */
  keys: readonly string[];
  /** Stores the value, or returns why it could not be stored. */
  apply(settings: SettingsStore, value: string): string | null;
}

/** One row per default the user can change, so /set stays a lookup rather than a growing switch. */
const FIELDS: readonly SettingField[] = [
  {
    keys: ['mode', 'account'],
    apply: (settings, value) => {
      const mode = parseAccountMode(value);
      if (mode === undefined) return 'فقط demo یا real.';
      settings.set('defaultAccountMode', mode);
      return null;
    },
  },
  {
    keys: ['amount'],
    apply: (settings, value) => {
      const amount = parseNumber(value);
      if (amount === null || amount <= 0) return 'مبلغ نامعتبر.';
      settings.set('defaultAmount', amount);
      return null;
    },
  },
  {
    keys: ['tf', 'timeframe'],
    apply: (settings, value) => {
      const seconds = parseDuration(value);
      if (seconds === null) return `تایم‌فریم نامعتبر.\n\n${TIME_FORMAT_HINT}`;
      settings.set('defaultTimeframeSeconds', seconds);
      return null;
    },
  },
  {
    keys: ['dur', 'duration'],
    apply: (settings, value) => {
      const seconds = parseDuration(value);
      if (seconds === null) return `مدت نامعتبر.\n\n${TIME_FORMAT_HINT}`;
      settings.set('defaultDurationSeconds', seconds);
      return null;
    },
  },
  {
    keys: ['candles'],
    apply: (settings, value) => {
      const count = parseNumber(value);
      if (count === null || count < 1) return 'تعداد کندل نامعتبر.';
      settings.set('defaultCandleCount', Math.round(count));
      return null;
    },
  },
  {
    keys: ['chart'],
    apply: (settings, value) => {
      const chart = parseChartType(value);
      if (chart === undefined) return 'نوع چارت نامعتبر (candle / ha / line).';
      settings.set('defaultChartType', chart);
      return null;
    },
  },
  {
    keys: ['entry'],
    apply: (settings, value) => {
      const mode = parseTriggerMode(value);
      if (mode === undefined) return 'نحوهٔ ورود نامعتبر (touch / next).';
      settings.set('defaultTriggerMode', mode);
      return null;
    },
  },
  {
    keys: ['expiry'],
    apply: (settings, value) => {
      const mode = parseExpiryMode(value);
      if (mode === undefined) return 'نوع انقضا نامعتبر (fixed / float).';
      settings.set('defaultExpiryMode', mode);
      return null;
    },
  },
  {
    keys: ['balance'],
    apply: (settings, value) => {
      const word = value.toLowerCase();
      if (!TRUE_WORDS.includes(word) && !FALSE_WORDS.includes(word)) return 'فقط on یا off.';
      settings.set('notifyBalance', TRUE_WORDS.includes(word));
      return null;
    },
  },
];

const FIELD_BY_KEY = new Map(FIELDS.flatMap((field) => field.keys.map((key) => [key, field] as const)));

/** Defaults, the account switch and the Pocket Option session. */
export function registerSettingsCommands(rt: BotRuntime): void {
  const { bot, settings, engine, config } = rt;

  bot.command('mode', async (ctx) => {
    const raw = ctx.match.trim();
    if (raw === '') {
      await ctx.reply(
        `حساب پیش‌فرض فعلی: ${ACCOUNT_LABEL[settings.get('defaultAccountMode')]}\n` +
          'برای تغییر: <code>/mode demo</code> یا <code>/mode real</code>',
        HTML,
      );
      return;
    }
    const mode = parseAccountMode(raw);
    if (mode === undefined) {
      await ctx.reply('فقط <code>demo</code> یا <code>real</code>.', HTML);
      return;
    }
    settings.set('defaultAccountMode', mode);
    const warning = engine.hasCredentials(mode)
      ? ''
      : `\n\n⚠️ هنوز برای این حساب نشستی ثبت نشده: <code>/session ${mode} &lt;SSID&gt;</code>`;
    await ctx.reply(`حساب پیش‌فرض روی ${ACCOUNT_LABEL[mode]} تنظیم شد.${warning}`, HTML);
  });

  bot.command('settings', async (ctx) => {
    const s = settings.all;
    const stored = (mode: 'demo' | 'real'): string =>
      s.ssid[mode] || config.pocket.ssid[mode] ? '✅ ثبت شده' : '❌ ثبت نشده';

    await ctx.reply(
      '⚙️ <b>تنظیمات پیش‌فرض</b>\n\n' +
        `<code>mode</code> حساب: ${ACCOUNT_LABEL[s.defaultAccountMode]}\n` +
        `<code>amount</code> مبلغ: ${formatMoney(s.defaultAmount)}\n` +
        `<code>tf</code> تایم‌فریم: ${timeframeLabel(s.defaultTimeframeSeconds)}\n` +
        `<code>dur</code> مدت ثابت: ${formatDuration(s.defaultDurationSeconds)}\n` +
        `<code>candles</code> تعداد کندل: ${s.defaultCandleCount}\n` +
        `<code>chart</code> نوع چارت: ${CHART_LABEL[s.defaultChartType]}\n` +
        `<code>entry</code> نحوهٔ ورود: ${TRIGGER_LABEL[s.defaultTriggerMode]}\n` +
        `<code>expiry</code> نوع انقضا: ${EXPIRY_LABEL[s.defaultExpiryMode]}\n` +
        `<code>balance</code> نمایش موجودی در اعلان‌ها: ${s.notifyBalance ? 'روشن' : 'خاموش'}\n\n` +
        `نشست دمو: ${stored('demo')}\n` +
        `نشست ریل: ${stored('real')}\n\n` +
        'تغییر: <code>/set amount 5</code> · <code>/set tf 1m</code> · <code>/set balance off</code>',
      HTML,
    );
  });

  bot.command('set', async (ctx) => {
    const [key, ...valueParts] = ctx.match.trim().split(/\s+/);
    const value = valueParts.join(' ').trim();
    if (!key || value === '') {
      await ctx.reply('ساختار: <code>/set &lt;کلید&gt; &lt;مقدار&gt;</code>؛ کلیدها را با /settings ببینید.', HTML);
      return;
    }

    const field = FIELD_BY_KEY.get(key.toLowerCase());
    const problem = field ? field.apply(settings, value) : `کلید ناشناخته: ${escapeHtml(key)}`;
    await ctx.reply(problem === null ? '✅ ذخیره شد.' : `⚠️ ${problem}`, HTML);
  });

  bot.command('session', async (ctx) => {
    const raw = ctx.match.trim();
    const separator = raw.search(/\s/);
    const mode = parseAccountMode(separator < 0 ? raw : raw.slice(0, separator));
    const ssid = separator < 0 ? '' : raw.slice(separator + 1).trim();

    if (mode === undefined || ssid === '') {
      await ctx.reply(SESSION_HELP, HTML);
      return;
    }
    await attempt(
      'could not delete the message carrying the SSID',
      ctx.api.deleteMessage(ctx.chat.id, ctx.message!.message_id),
    );

    let uid: number;
    try {
      uid = parseSsid(ssid, mode, settings.get('uid')[mode]).uid;
    } catch (error) {
      const message = error instanceof SsidParseError ? error.message : errorMessage(error);
      await ctx.reply(`⚠️ SSID خوانده نشد: ${escapeHtml(message)}\n\n${SESSION_HELP}`, HTML);
      return;
    }

    settings.setCredentials(mode, ssid, uid);
    engine.reloadCredentials(mode);

    const notice = await openNotice(
      ctx,
      `⏳ نشست حساب ${ACCOUNT_LABEL[mode]} ذخیره شد (uid: <code>${uid}</code>). در حال تست اتصال…`,
    );
    const result = await engine.testCredentials(mode);
    await notice.update(
      result.ok
        ? `✅ اتصال به حساب ${ACCOUNT_LABEL[mode]} برقرار شد.\n` +
            `موجودی: <b>${formatMoney(result.balance)}</b>\n` +
            'پیام حاوی SSID برای امنیت حذف شد.'
        : `❌ کارگزار این نشست را نپذیرفت.\n<code>${escapeHtml(result.error)}</code>\n\n${SESSION_HELP}`,
    );
  });
}
