import { Bot, InlineKeyboard, type Context } from 'grammy';
import { OrderWizard, TIME_FORMAT_HINT, type OrderDraft } from './wizard.ts';
import {
  parseOrderCommand,
  normalizeSymbol,
  parseNumber,
  parseAccountMode,
  parseChartType,
  parseExpiryMode,
  parseTriggerMode,
} from './parse.ts';
import {
  ACCOUNT_LABEL,
  CHART_HELP,
  CHART_LABEL,
  DIRECTION_LABEL,
  EXPIRY_HELP,
  EXPIRY_LABEL,
  STATUS_LABEL,
  TRIGGER_HELP,
  TRIGGER_LABEL,
  escapeHtml,
  formatMoney,
  formatPrice,
  orderHeadline,
  renderOrder,
  withBalance,
} from './format.ts';
import { MissingCredentialsError } from '../engine/session.ts';
import { createLogger } from '../logger.ts';
import type { AssetInfo } from '../pocket/protocol.ts';
import { formatDuration, formatTime, nowSeconds, parseDuration, timeframeLabel } from '../util/time.ts';
import { parseSsid, SsidParseError } from '../util/ssid.ts';
import type { AppConfig } from '../config.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { OrderRepository } from '../storage/orders.ts';
import type { EngineEvent, TradeEngine } from '../engine/engine.ts';
import type { AccountMode, ChartType, ExpiryMode, Order, TriggerMode } from '../types.ts';

const logger = createLogger('telegram');

export interface BotDeps {
  config: AppConfig;
  settings: SettingsStore;
  orders: OrderRepository;
  engine: TradeEngine;
}

const GUIDE = `
🤖 <b>ربات معاملات پاکت آپشن</b>

این ربات برای شما «سفارش شرطی» می‌سازد. شما می‌گویید روی کدام نماد، در چه قیمتی، در چه جهتی و با چه مبلغی؛ ربات قیمت لحظه‌ای همان نماد را زنده دنبال می‌کند و همان لحظه‌ای که قیمت به عدد شما رسید معامله را باز می‌کند، تا پایان مدت نگه می‌دارد و نتیجه (برد یا باخت و سود و زیان) را خبر می‌دهد.

<b>🚀 شروع در سه قدم</b>
۱) نشست حساب را ثبت کنید: /session
۲) /new را بزنید تا پنل ساخت سفارش باز شود.
۳) نماد و قیمت را بدهید و «✅ ثبت سفارش» را بزنید.

<b>⌨️ مهم‌ترین نکتهٔ پنل /new</b>
دکمه‌هایی که کنارشان ✍️ هست (نماد، قیمت، مبلغ، مدت، تعداد کندل، اعتبار) مقدارشان را <b>از شما می‌پرسند</b>: روی دکمه بزنید، ربات یک پیام می‌فرستد و کادر پاسخ باز می‌شود، بعد مقدار را تایپ کنید و بفرستید.
بقیهٔ دکمه‌ها (جهت، حساب، ورود، انقضا) با هر بار زدن بین حالت‌ها می‌چرخند و «چارت» و «تایم‌فریم» فهرست انتخاب باز می‌کنند.

<b>🧭 یک مثال کامل</b>
می‌خواهید اگر قیمت <code>EURUSD</code> به <code>1.08540</code> رسید، یک معاملهٔ فروش ۶۰ ثانیه‌ای با ۵ دلار روی حساب دمو باز شود و اگر تا نیم ساعت دیگر قیمت به آن نرسید سفارش خودبه‌خود لغو شود:
<code>/order EURUSD sell 1.08540 dur=60 amount=5 acc=demo valid=30m</code>
همین کار با پنل: /new ← نماد <code>EURUSD</code> ← قیمت <code>1.08540</code> ← جهت: فروش ← مدت: <code>1m</code> ← مبلغ: <code>5</code> ← اعتبار: <code>30m</code> ← ثبت.

<b>📚 راهنماهای بیشتر</b>
دکمه‌های پایین را بزنید.
`.trim();

const CHART_GUIDE = `
📈 <b>نوع چارت: کندلی، هایکن‌آشی یا خطی؟</b>

این گزینه تعیین می‌کند ربات کندل‌های نماد را چطور بسازد و به شما نشان دهد. قیمت ورود و خروج معامله همیشه قیمت واقعی بازار است و با این گزینه عوض نمی‌شود؛ چیزی که عوض می‌شود شکل کندل‌هاست.

<b>۱) کندلی (Candlestick) — پیش‌فرض</b>
${CHART_HELP.candle}
هر کندل دقیقاً چهار عدد واقعی همان بازه است: قیمت باز، بیشترین، کمترین و بستهٔ همان بازه.
مثال: در تایم‌فریم ۱ دقیقه، کندل ساعت ۱۰:۰۰ با اولین قیمت آن دقیقه باز می‌شود و با آخرین قیمت ثانیهٔ ۵۹ بسته می‌شود.
مناسب وقتی می‌خواهید دقیقاً همان چیزی را ببینید که در بازار افتاده است، مثلاً برای سفارش «به قیمت X رسید».

<b>۲) هایکن‌آشی (Heikin-Ashi)</b>
${CHART_HELP.heikin_ashi}
قیمت بستهٔ هر کندل، میانگین چهار قیمت همان بازه است و قیمت باز، میانگین باز و بستهٔ کندل قبلی. یعنی هر کندل کمی از کندل قبلی هم در خودش دارد.
نتیجه: زنجیرهٔ کندل‌های هم‌رنگ، روند را تمیزتر نشان می‌دهد و نویز کم می‌شود؛ در عوض عددهای روی کندل قیمت واقعی نیستند و تغییر جهت را با کمی تأخیر نشان می‌دهد.
مناسب وقتی دنبال جهت کلی روند هستید، نه عدد دقیق.

<b>۳) خطی (Line)</b>
${CHART_HELP.line}
مناسب یک نگاه سریع به مسیر قیمت.

<b>خلاصه</b>
عدد دقیق و تصمیم روی قیمت ← کندلی. دیدن روند بدون نویز ← هایکن‌آشی. نگاه ساده ← خطی.
در دستور تک‌خطی: <code>chart=candle</code> · <code>chart=ha</code> · <code>chart=line</code>
`.trim();

const TIME_GUIDE = `
⏱ <b>نوشتن زمان و مدت</b>

هرجا ربات از شما مدت می‌خواهد (مدت معامله، تایم‌فریم، اعتبار سفارش) می‌توانید آزادانه بنویسید.

${TIME_FORMAT_HINT}

<b>نمونه‌های درست</b>
<code>60</code> ← ۶۰ ثانیه (عدد تنها یعنی ثانیه)
<code>90s</code> · <code>90 sec</code> · <code>۹۰ ثانیه</code>
<code>1m</code> · <code>1M</code> · <code>1 min</code> · <code>2 minutes</code> · <code>۲ دقیقه</code>
<code>1h</code> · <code>2 hours</code> · <code>۲ ساعت</code>
<code>1h 30m</code> · <code>1H30M</code> · <code>۱ ساعت و ۳۰ دقیقه</code>
<code>3 days</code> · <code>۳ روز</code> · <code>1 هفته</code> · <code>1 ماه</code>

<b>جاهایی که این قالب کار می‌کند</b>
• پنل /new: دکمه‌های «مدت» و «اعتبار»
• دستور تک‌خطی: <code>dur=1m</code> · <code>tf=5m</code> · <code>valid=2h</code>
• تنظیمات: <code>/set dur 90s</code> · <code>/set tf 1m</code>

در «اعتبار سفارش»، عدد <code>0</code> یعنی سفارش هیچ‌وقت منقضی نشود.
`.trim();

const TRADE_GUIDE = `
🎯 <b>ورود، انقضا و اعتبار</b>

<b>نحوهٔ ورود</b> — یعنی بعد از رسیدن قیمت به هدف، معامله دقیقاً کِی باز شود.
• لحظه‌ای: ${TRIGGER_HELP.touch}
• کندل بعدی: ${TRIGGER_HELP.next_candle}
مثال: قیمت هدف <code>1.08540</code> در ثانیهٔ ۲۳ لمس می‌شود. با «لحظه‌ای» همان ثانیهٔ ۲۳ وارد می‌شوید؛ با «کندل بعدی» ربات صبر می‌کند و در ثانیهٔ صفرِ کندل بعد وارد می‌شود.

<b>نوع انقضا</b> — یعنی معامله کِی بسته شود.
• ثابت: ${EXPIRY_LABEL.fixed} — ${EXPIRY_HELP.fixed}
• شناور: ${EXPIRY_LABEL.floating} — ${EXPIRY_HELP.floating}
مثال: تایم‌فریم ۱ دقیقه، انقضای شناور، تعداد کندل ۱ ← اگر در ثانیهٔ ۲۳ وارد شوید، معامله ۳۷ ثانیهٔ بعد و در پایان همان دقیقه بسته می‌شود.

<b>اعتبار سفارش</b> — تا چه مدت منتظر رسیدن قیمت به هدف بمانیم. اگر تا آن زمان قیمت به هدف نرسد، سفارش منقضی می‌شود و هیچ معامله‌ای باز نمی‌شود. <code>0</code> یعنی بدون محدودیت.

<b>حساب</b> — دمو با پول مجازی، ریل با پول واقعی. حساب پیش‌فرض را با /mode عوض کنید.
`.trim();

const HELP = `
🤖 <b>ربات معاملات پاکت آپشن</b>

سفارش شرطی ثبت می‌کنید؛ ربات قیمت لحظه‌ای همان نماد را زنده نگه می‌دارد و به‌محض رسیدن قیمت، معامله را باز می‌کند و نتیجه را خبر می‌دهد.

<b>دستورها</b>
/new: ساخت سفارش با دکمه‌ها
/order: ساخت سریع سفارش در یک خط
/list: سفارش‌های فعال
/cancel &lt;کد&gt;: لغو سفارش
/history: آخرین سفارش‌ها
/stats: آمار امروز
/balance: موجودی حساب
/price &lt;نماد&gt;: قیمت لحظه‌ای
/symbols &lt;جست‌وجو&gt;: فهرست نمادهای کارگزار
/status: وضعیت اتصال‌ها
/mode demo|real: تغییر حساب پیش‌فرض
/settings: نمایش تنظیمات
/set &lt;کلید&gt; &lt;مقدار&gt;: تغییر تنظیمات
/session demo|real &lt;SSID&gt;: ثبت نشست پاکت آپشن
/id: نمایش شناسهٔ چت

<b>نمونهٔ دستور تک‌خطی</b>
<code>/order GBPAUD_otc buy 1.95320 tf=1m dur=60 amount=1 acc=demo</code>
<code>/order EURUSD sell 1.08540 tf=1m exp=float candles=1 entry=next</code>

<b>پارامترها</b>
<code>tf</code> تایم‌فریم چارت · <code>chart</code> نوع چارت (candle/ha/line)
<code>entry</code> نحوهٔ ورود: <code>touch</code> (همان لحظه) یا <code>next</code> (کندل بعدی)
<code>exp</code> نوع انقضا: <code>fixed</code> (زمان ثابت) یا <code>float</code> (تا پایان کندل)
<code>dur</code> مدت ثابت · <code>candles</code> تعداد کندل در حالت شناور
<code>amount</code> مبلغ · <code>acc</code> حساب · <code>valid</code> اعتبار سفارش

مقدارهای زمانی را آزادانه بنویسید: <code>dur=90</code> · <code>dur=1m</code> · <code>dur="۲ دقیقه"</code> · <code>valid=2h</code>
برای راهنمای کامل /start را بزنید.
`.trim();

const SESSION_HELP = `
🔑 <b>گرفتن SSID از پاکت آپشن</b>

۱) در مرورگر وارد حساب خود شوید و صفحهٔ معاملات همان حسابی را باز کنید که می‌خواهید ربات روی آن کار کند:
دمو: <code>https://p.finance/fa/cabinet/demo-quick-high-low/</code>
ریل: <code>https://p.finance/fa/cabinet/quick-high-low/</code>
۲) با F12 ابزار توسعه‌دهنده را باز کنید، به تب <b>Network</b> بروید، فیلتر <b>WS</b> را بزنید و صفحه را رفرش کنید.
۳) روی اتصالی کلیک کنید که آدرسش شبیه این است:
<code>demo-api-eu.po.market/socket.io/?EIO=4&amp;transport=websocket</code>
(برای حساب ریل: <code>api-eu.po.market</code>)
۴) به تب <b>Messages</b> بروید و در پیام‌های <b>ارسالی</b> دنبال فریمی بگردید که با <code>42["auth",</code> شروع می‌شود.
۵) کل همان فریم را کپی کنید و بفرستید:
<code>/session demo 42["auth",{…}]</code>

هر دو قالب پذیرفته می‌شود:
• <code>{"sessionToken":"…","uid":"…","lang":"fa","currentUrl":"cabinet/demo-quick-high-low","isChart":1}</code>
  (قالب فعلی p.finance، پاسخ موفق آن <code>42["auth/success"]</code> است)
• <code>{"session":"…","isDemo":1,"uid":…,"platform":1}</code>
  (قالب قدیمی‌تر، پاسخ موفق آن <code>successauth</code> است)

⏳ این توکن ماندگار نیست: با خروج از حساب یا با گذشت زمان باطل می‌شود. اگر باطل شود ربات تلاش مجدد را متوقف می‌کند، به شما خبر می‌دهد و سفارش‌هایتان دست‌نخورده می‌مانند تا SSID تازه بفرستید.
💡 توکن را از تبی بردارید که همان لحظه باز و لاگین است؛ توکنی که چند روز پیش کپی شده تقریباً همیشه باطل است.
`.trim();

const TOPICS: Record<string, string> = {
  chart: CHART_GUIDE,
  time: TIME_GUIDE,
  trade: TRADE_GUIDE,
  commands: HELP,
  session: SESSION_HELP,
};

function topicsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📈 کندلی یا هایکن‌آشی؟', 'h:chart')
    .row()
    .text('⏱ نوشتن زمان و مدت', 'h:time')
    .row()
    .text('🎯 ورود، انقضا و اعتبار', 'h:trade')
    .row()
    .text('🧭 فهرست دستورها', 'h:commands')
    .text('🔑 ثبت نشست', 'h:session');
}

function backKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('« بازگشت به راهنما', 'h:home');
}

export async function publishCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: 'new', description: 'ساخت سفارش جدید' },
      { command: 'order', description: 'ساخت سریع سفارش' },
      { command: 'list', description: 'سفارش‌های فعال' },
      { command: 'cancel', description: 'لغو سفارش' },
      { command: 'balance', description: 'موجودی حساب' },
      { command: 'price', description: 'قیمت لحظه‌ای نماد' },
      { command: 'symbols', description: 'فهرست و جست‌وجوی نمادها' },
      { command: 'status', description: 'وضعیت اتصال‌ها' },
      { command: 'history', description: 'آخرین سفارش‌ها' },
      { command: 'stats', description: 'آمار امروز' },
      { command: 'settings', description: 'تنظیمات' },
      { command: 'mode', description: 'حساب دمو یا ریل' },
      { command: 'help', description: 'راهنما' },
    ]);
  } catch (error) {
    logger.warn('could not publish command list', error);
  }
}

export function createBot(deps: BotDeps): Bot {
  const { config, settings, orders, engine } = deps;
  const bot = new Bot(config.telegram.token);

  const recipients = (): number[] => {
    const merged = new Set<number>([...config.telegram.adminIds, ...settings.get('owners')]);
    return [...merged];
  };

  const isAllowed = (chatId: number): boolean => {
    const allowed = recipients();
    return allowed.length === 0 || allowed.includes(chatId);
  };

  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    if (isAllowed(chatId)) {
      if (recipients().length === 0) {
        settings.addOwner(chatId);
        logger.warn(`chat ${chatId} claimed ownership of this bot`);
      }
      await next();
      return;
    }

    await ctx.reply(
      `⛔️ دسترسی ندارید.\nشناسهٔ چت شما: <code>${chatId}</code>\nبرای دسترسی، این شناسه را در <code>TELEGRAM_ADMIN_IDS</code> قرار دهید.`,
      { parse_mode: 'HTML' },
    );
  });

  const send = async (chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> => {
    try {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
    } catch (error) {
      logger.error(`failed to message chat ${chatId}`, error);
    }
  };

  const balanceSuffix = (mode: AccountMode): number | null =>
    settings.get('notifyBalance') ? engine.cachedBalance(mode) : null;

  const resolveMode = (raw: string | undefined): AccountMode =>
    (raw === undefined ? undefined : parseAccountMode(raw)) ?? settings.get('defaultAccountMode');
  const validate = (draft: {
    amount: number;
    expiryMode: ExpiryMode;
    durationSeconds: number;
    candleCount: number;
    timeframeSeconds: number;
  }): string | null => {
    const { limits } = config;
    if (draft.amount < limits.minAmount || draft.amount > limits.maxAmount) {
      return `مبلغ باید بین ${formatMoney(limits.minAmount)} و ${formatMoney(limits.maxAmount)} باشد.`;
    }
    const effective =
      draft.expiryMode === 'fixed' ? draft.durationSeconds : draft.timeframeSeconds * draft.candleCount;
    if (effective < limits.minDurationSeconds) {
      return `مدت معامله نباید کمتر از ${formatDuration(limits.minDurationSeconds)} باشد.`;
    }
    if (effective > limits.maxDurationSeconds) {
      return `مدت معامله نباید بیشتر از ${formatDuration(limits.maxDurationSeconds)} باشد.`;
    }
    return null;
  };

  const assetLine = (asset: AssetInfo): string =>
    `<code>${escapeHtml(asset.symbol)}</code> · ${asset.isOpen ? '🟢 باز' : '🔴 بسته'}` +
    (asset.payout === null ? '' : ` · پرداخت ${asset.payout}٪`) +
    (asset.name ? ` · ${escapeHtml(asset.name)}` : '');

  const verifySymbol = async (
    mode: AccountMode,
    raw: string,
  ): Promise<{ symbol: string; problem: string | null; note: string | null }> => {
    const check = await engine.checkSymbol(mode, raw);

    if (check.state === 'unknown') {
      const list = check.suggestions.map((asset) => `• ${assetLine(asset)}`).join('\n');
      return {
        symbol: check.input,
        problem:
          `نماد <code>${escapeHtml(check.input)}</code> در فهرست کارگزار نیست.` +
          (list
            ? `\n\nشاید یکی از این‌ها باشد:\n${list}`
            : '\nبا <code>/symbols &lt;بخشی از نام&gt;</code> جست‌وجو کنید.'),
        note: null,
      };
    }

    if (check.state === 'unverified') {
      return {
        symbol: check.symbol,
        problem: null,
        note: '⚠️ فهرست نمادها از کارگزار گرفته نشد، بدون بررسی ادامه می‌دهیم.',
      };
    }

    const notes: string[] = [];
    if (check.corrected) notes.push(`✅ نماد اصلاح شد به ${assetLine(check.asset)}`);
    if (!check.asset.isOpen) {
      notes.push('🔴 بازار این نماد الان بسته است؛ سفارش تا باز شدن بازار منتظر می‌ماند.');
      if (check.twin?.isOpen) notes.push(`نسخهٔ باز: ${assetLine(check.twin)}`);
    }
    return { symbol: check.symbol, problem: null, note: notes.length > 0 ? notes.join('\n') : null };
  };

  const submitOrder = async (
    ctx: Context,
    input: {
      symbol: string;
      direction: Order['direction'];
      triggerPrice: number;
      triggerMode: TriggerMode;
      timeframeSeconds: number;
      chartType: ChartType;
      expiryMode: ExpiryMode;
      durationSeconds: number;
      candleCount: number;
      amount: number;
      accountMode: AccountMode;
      validForSeconds: number | null;
    },
  ): Promise<void> => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const problem = validate(input);
    if (problem) {
      await ctx.reply(`⚠️ ${problem}`, { parse_mode: 'HTML' });
      return;
    }

    if (!engine.hasCredentials(input.accountMode)) {
      await ctx.reply(
        `⚠️ برای حساب ${ACCOUNT_LABEL[input.accountMode]} هنوز نشستی ثبت نشده است.\n` +
          `با دستور <code>/session ${input.accountMode} &lt;SSID&gt;</code> آن را ثبت کنید.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const notice = await ctx.reply('⏳ در حال بررسی نماد و ثبت سفارش…');

    const verdict = await verifySymbol(input.accountMode, input.symbol);
    if (verdict.problem !== null) {
      await ctx.api
        .editMessageText(chatId, notice.message_id, `⚠️ ${verdict.problem}`, { parse_mode: 'HTML' })
        .catch((error: unknown) => logger.debug('could not edit the notice message', error));
      return;
    }

    try {
      const order = await engine.createOrder({
        chatId,
        accountMode: input.accountMode,
        symbol: verdict.symbol,
        direction: input.direction,
        triggerPrice: input.triggerPrice,
        triggerMode: input.triggerMode,
        amount: input.amount,
        expiryMode: input.expiryMode,
        durationSeconds: input.durationSeconds,
        candleCount: input.candleCount,
        timeframeSeconds: input.timeframeSeconds,
        chartType: input.chartType,
        validUntil: input.validForSeconds === null ? null : nowSeconds() + input.validForSeconds,
      });

      const text = withBalance(
        `✅ <b>سفارش ثبت شد</b>\n\n${renderOrder(order, config.timezone)}\n\n` +
          (verdict.note === null ? '' : `${verdict.note}\n\n`) +
          `از این لحظه قیمت لحظه‌ای <b>${escapeHtml(order.symbol)}</b> زنده دنبال می‌شود.`,
        balanceSuffix(order.accountMode),
        settings.get('notifyBalance'),
      );
      await ctx.api
        .editMessageText(chatId, notice.message_id, text, {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().text('❌ لغو این سفارش', `c:${order.id}`),
        })
        .catch((error: unknown) => {
          logger.debug('could not edit the confirmation message, sending a new one', error);
          return send(chatId, text);
        });
    } catch (error) {
      const message =
        error instanceof MissingCredentialsError
          ? 'نشست پاکت آپشن برای این حساب ثبت نشده است.'
          : error instanceof Error
            ? error.message
            : String(error);
      logger.error('failed to create order', error);
      await ctx.api
        .editMessageText(chatId, notice.message_id, `⚠️ ثبت سفارش ناموفق بود: ${escapeHtml(message)}`, {
          parse_mode: 'HTML',
        })
        .catch((error: unknown) => logger.debug('could not edit the notice message', error));
    }
  };

  const wizard = new OrderWizard(
    settings,
    async (draft: OrderDraft, ctx: Context) => {
      if (draft.symbol === null || draft.triggerPrice === null) return;
      await submitOrder(ctx, {
        symbol: draft.symbol,
        direction: draft.direction,
        triggerPrice: draft.triggerPrice,
        triggerMode: draft.triggerMode,
        timeframeSeconds: draft.timeframeSeconds,
        chartType: draft.chartType,
        expiryMode: draft.expiryMode,
        durationSeconds: draft.durationSeconds,
        candleCount: draft.candleCount,
        amount: draft.amount,
        accountMode: draft.accountMode,
        validForSeconds: draft.validForSeconds,
      });
    },
    verifySymbol,
  );

  bot.on('message:text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) await wizard.abortPrompt(ctx);
    await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(GUIDE, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: topicsKeyboard(),
    });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: topicsKeyboard(),
    });
  });

  bot.command('id', async (ctx) => {
    await ctx.reply(`شناسهٔ این چت: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' });
  });

  bot.command('new', async (ctx) => {
    await wizard.open(ctx);
  });

  bot.command('order', async (ctx) => {
    const args = ctx.match.trim();
    if (args === '') {
      await wizard.open(ctx);
      return;
    }
    const parsed = parseOrderCommand(args, settings.all);
    if (!parsed.ok) {
      await ctx.reply(`⚠️ ${escapeHtml(parsed.error)}`, { parse_mode: 'HTML' });
      return;
    }
    await submitOrder(ctx, parsed.order);
  });

  bot.command('list', async (ctx) => {
    const active = orders.listActiveByChat(ctx.chat.id);
    if (active.length === 0) {
      await ctx.reply('سفارش فعالی ندارید. با /new یکی بسازید.');
      return;
    }
    for (const order of active) {
      const keyboard = new InlineKeyboard();
      if (order.status === 'pending' || order.status === 'armed') {
        keyboard.text('❌ لغو', `c:${order.id}`);
      }
      const session = engine.sessionManager.get(order.accountMode, order.symbol);
      const live = session?.price ?? null;
      const livePart = live === null ? '' : `\nقیمت لحظه‌ای: <code>${formatPrice(live)}</code>`;
      await ctx.reply(renderOrder(order, config.timezone) + livePart, {
        parse_mode: 'HTML',
        ...(keyboard.inline_keyboard.length > 0 ? { reply_markup: keyboard } : {}),
      });
    }
  });

  bot.command('cancel', async (ctx) => {
    const id = ctx.match.trim().replace(/^#/, '').toUpperCase();
    if (id === '') {
      await ctx.reply('کد سفارش را بدهید. مثال: <code>/cancel A7K2</code>', { parse_mode: 'HTML' });
      return;
    }
    const order = orders.get(id);
    if (!order || order.chatId !== ctx.chat.id) {
      await ctx.reply('سفارشی با این کد پیدا نشد.');
      return;
    }
    const result = engine.cancel(id);
    if (result.ok) {
      await ctx.reply(`⚪️ سفارش <b>#${escapeHtml(id)}</b> لغو شد.`, { parse_mode: 'HTML' });
    } else if (result.reason === 'already_open') {
      await ctx.reply('این معامله باز شده و در باینری آپشن امکان بستن زودهنگام وجود ندارد.');
    } else {
      await ctx.reply('این سفارش دیگر فعال نیست.');
    }
  });

  bot.command('history', async (ctx) => {
    const recent = orders.listRecentByChat(ctx.chat.id, 15);
    if (recent.length === 0) {
      await ctx.reply('هنوز سفارشی ثبت نشده است.');
      return;
    }
    const lines = recent.map((order) => {
      const profit = order.profit === null ? '' : ` · ${formatMoney(order.profit)}`;
      return `${orderHeadline(order)}\n   ${STATUS_LABEL[order.status]}${profit} · ${formatTime(order.createdAt, config.timezone)}`;
    });
    await ctx.reply(`🗂 <b>آخرین سفارش‌ها</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
  });

  bot.command('stats', async (ctx) => {
    const since = nowSeconds() - 24 * 3600;
    const summary = orders.summary(ctx.chat.id, since);
    const total = summary.won + summary.lost + summary.draw;
    const rate = total > 0 ? Math.round((summary.won / total) * 100) : 0;
    await ctx.reply(
      `📊 <b>آمار ۲۴ ساعت گذشته</b>\n\n` +
        `برد: <b>${summary.won}</b> · باخت: <b>${summary.lost}</b> · مساوی: <b>${summary.draw}</b>\n` +
        `نرخ برد: <b>${rate}%</b>\n` +
        `سود/زیان خالص: <b>${formatMoney(summary.profit)}</b>`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command('balance', async (ctx) => {
    const mode = resolveMode(ctx.match);
    if (!engine.hasCredentials(mode)) {
      await ctx.reply(`برای حساب ${ACCOUNT_LABEL[mode]} نشستی ثبت نشده است.`, { parse_mode: 'HTML' });
      return;
    }
    const notice = await ctx.reply('⏳ در حال خواندن موجودی…');
    try {
      const balance = await engine.balance(mode);
      await ctx.api.editMessageText(
        ctx.chat.id,
        notice.message_id,
        balance === null
          ? '⚠️ موجودی دریافت نشد. اتصال را با /status بررسی کنید.'
          : `💵 موجودی حساب ${ACCOUNT_LABEL[mode]}: <b>${formatMoney(balance)}</b>`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.api
        .editMessageText(ctx.chat.id, notice.message_id, `⚠️ ${escapeHtml(message)}`, { parse_mode: 'HTML' })
        .catch((error: unknown) => logger.debug('could not edit the notice message', error));
    }
  });

  bot.command('price', async (ctx) => {
    const [symbolRaw, modeRaw] = ctx.match.trim().split(/\s+/);
    if (!symbolRaw) {
      await ctx.reply('نماد را بدهید. مثال: <code>/price GBPAUD_otc</code>', { parse_mode: 'HTML' });
      return;
    }
    const mode = resolveMode(modeRaw);
    const notice = await ctx.reply(
      `⏳ در حال بررسی ${escapeHtml(normalizeSymbol(symbolRaw))}…`,
      { parse_mode: 'HTML' },
    );
    try {
      const verdict = await verifySymbol(mode, symbolRaw);
      if (verdict.problem !== null) {
        await ctx.api.editMessageText(ctx.chat.id, notice.message_id, `⚠️ ${verdict.problem}`, {
          parse_mode: 'HTML',
        });
        return;
      }
      const symbol = verdict.symbol;
      const price = await engine.price(mode, symbol);
      await ctx.api.editMessageText(
        ctx.chat.id,
        notice.message_id,
        price === null
          ? `⚠️ قیمتی برای <b>${escapeHtml(symbol)}</b> دریافت نشد. نماد یا باز بودن بازار را بررسی کنید.`
          : `💹 <b>${escapeHtml(symbol)}</b> (${ACCOUNT_LABEL[mode]}): <code>${formatPrice(price)}</code>`,
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.api
        .editMessageText(ctx.chat.id, notice.message_id, `⚠️ ${escapeHtml(message)}`, { parse_mode: 'HTML' })
        .catch((error: unknown) => logger.debug('could not edit the notice message', error));
    }
  });

  bot.command('symbols', async (ctx) => {
    const query = ctx.match.trim();
    const mode = settings.get('defaultAccountMode');
    const notice = await ctx.reply('⏳ در حال گرفتن فهرست نمادها…');
    try {
      const assets = await engine.assets(mode);
      if (assets.length === 0) {
        await ctx.api.editMessageText(ctx.chat.id, notice.message_id, '⚠️ کارگزار فهرست نمادها را نفرستاد.');
        return;
      }

      const needle = normalizeSymbol(query).replace(/_OTC$/i, '').replace(/^#/, '');
      const matched = (
        needle === ''
          ? assets.filter((asset) => asset.isOpen)
          : assets.filter(
              (asset) =>
                asset.symbol.toUpperCase().includes(needle) ||
                asset.name.toUpperCase().includes(query.toUpperCase()),
            )
      )
        .slice()
        .sort((a, b) => (a.isOpen === b.isOpen ? (b.payout ?? 0) - (a.payout ?? 0) : a.isOpen ? -1 : 1));

      const shown = matched.slice(0, 30);
      const header =
        needle === ''
          ? `نمادهای باز حساب ${ACCOUNT_LABEL[mode]} (${matched.length} مورد)`
          : `نتیجهٔ جست‌وجوی <code>${escapeHtml(query)}</code> (${matched.length} مورد)`;
      const body =
        shown.length === 0
          ? 'چیزی پیدا نشد.'
          : shown.map((asset) => `• ${assetLine(asset)}`).join('\n') +
            (matched.length > shown.length ? `\n\n… و ${matched.length - shown.length} مورد دیگر.` : '');

      await ctx.api.editMessageText(ctx.chat.id, notice.message_id, `📋 <b>${header}</b>\n\n${body}`, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.api
        .editMessageText(ctx.chat.id, notice.message_id, `⚠️ ${escapeHtml(message)}`, { parse_mode: 'HTML' })
        .catch((error: unknown) => logger.debug('could not edit the notice message', error));
    }
  });

  bot.command('status', async (ctx) => {
    const sessions = engine.sessionManager.list();
    const lines = sessions.map(({ key, session, holders }) => {
      const state = session.isReady ? '🟢 متصل' : '🔴 قطع';
      const price = session.price === null ? '-' : formatPrice(session.price);
      const endpoint = session.client.endpoint?.url ?? '-';
      return (
        `<b>${escapeHtml(key)}</b> · ${state}\n` +
        `   سرور: <code>${escapeHtml(endpoint)}</code>\n` +
        `   قیمت: <code>${price}</code> · سفارش‌های وابسته: ${holders}\n` +
        `   موجودی: ${formatMoney(session.balance)} · اختلاف ساعت سرور: ${session.client.timeOffset}s`
      );
    });

    const active = orders.listActiveByChat(ctx.chat.id).length;
    await ctx.reply(
      `📡 <b>وضعیت سرویس</b>\n\n` +
        `سفارش‌های فعال شما: <b>${active}</b>\n` +
        `حساب پیش‌فرض: ${ACCOUNT_LABEL[settings.get('defaultAccountMode')]}\n\n` +
        (lines.length > 0 ? lines.join('\n\n') : 'هیچ نشست زنده‌ای باز نیست.'),
      { parse_mode: 'HTML' },
    );
  });

  bot.command('mode', async (ctx) => {
    const raw = ctx.match.trim();
    if (raw === '') {
      await ctx.reply(
        `حساب پیش‌فرض فعلی: ${ACCOUNT_LABEL[settings.get('defaultAccountMode')]}\n` +
          'برای تغییر: <code>/mode demo</code> یا <code>/mode real</code>',
        { parse_mode: 'HTML' },
      );
      return;
    }
    const mode = parseAccountMode(raw);
    if (mode === undefined) {
      await ctx.reply('فقط <code>demo</code> یا <code>real</code>.', { parse_mode: 'HTML' });
      return;
    }
    settings.set('defaultAccountMode', mode);
    const warning = engine.hasCredentials(mode)
      ? ''
      : `\n\n⚠️ هنوز برای این حساب نشستی ثبت نشده: <code>/session ${mode} &lt;SSID&gt;</code>`;
    await ctx.reply(`حساب پیش‌فرض روی ${ACCOUNT_LABEL[mode]} تنظیم شد.${warning}`, { parse_mode: 'HTML' });
  });

  bot.command('settings', async (ctx) => {
    const s = settings.all;
    await ctx.reply(
      `⚙️ <b>تنظیمات پیش‌فرض</b>\n\n` +
        `<code>mode</code> حساب: ${ACCOUNT_LABEL[s.defaultAccountMode]}\n` +
        `<code>amount</code> مبلغ: ${formatMoney(s.defaultAmount)}\n` +
        `<code>tf</code> تایم‌فریم: ${timeframeLabel(s.defaultTimeframeSeconds)}\n` +
        `<code>dur</code> مدت ثابت: ${formatDuration(s.defaultDurationSeconds)}\n` +
        `<code>candles</code> تعداد کندل: ${s.defaultCandleCount}\n` +
        `<code>chart</code> نوع چارت: ${CHART_LABEL[s.defaultChartType]}\n` +
        `<code>entry</code> نحوهٔ ورود: ${TRIGGER_LABEL[s.defaultTriggerMode]}\n` +
        `<code>expiry</code> نوع انقضا: ${EXPIRY_LABEL[s.defaultExpiryMode]}\n` +
        `<code>balance</code> نمایش موجودی در اعلان‌ها: ${s.notifyBalance ? 'روشن' : 'خاموش'}\n\n` +
        `نشست دمو: ${s.ssid.demo || config.pocket.ssid.demo ? '✅ ثبت شده' : '❌ ثبت نشده'}\n` +
        `نشست ریل: ${s.ssid.real || config.pocket.ssid.real ? '✅ ثبت شده' : '❌ ثبت نشده'}\n\n` +
        `تغییر: <code>/set amount 5</code> · <code>/set tf 1m</code> · <code>/set balance off</code>`,
      { parse_mode: 'HTML' },
    );
  });

  bot.command('set', async (ctx) => {
    const [key, ...valueParts] = ctx.match.trim().split(/\s+/);
    const value = valueParts.join(' ').trim();
    if (!key || value === '') {
      await ctx.reply('ساختار: <code>/set &lt;کلید&gt; &lt;مقدار&gt;</code>؛ کلیدها را با /settings ببینید.', {
        parse_mode: 'HTML',
      });
      return;
    }

    const fail = async (message: string): Promise<void> => {
      await ctx.reply(`⚠️ ${message}`, { parse_mode: 'HTML' });
    };

    switch (key.toLowerCase()) {
      case 'mode':
      case 'account': {
        const mode = parseAccountMode(value);
        if (mode === undefined) return fail('فقط demo یا real.');
        settings.set('defaultAccountMode', mode);
        break;
      }
      case 'amount': {
        const amount = parseNumber(value);
        if (amount === null || amount <= 0) return fail('مبلغ نامعتبر.');
        settings.set('defaultAmount', amount);
        break;
      }
      case 'tf':
      case 'timeframe': {
        const seconds = parseDuration(value);
        if (seconds === null) return fail(`تایم‌فریم نامعتبر.\n\n${TIME_FORMAT_HINT}`);
        settings.set('defaultTimeframeSeconds', seconds);
        break;
      }
      case 'dur':
      case 'duration': {
        const seconds = parseDuration(value);
        if (seconds === null) return fail(`مدت نامعتبر.\n\n${TIME_FORMAT_HINT}`);
        settings.set('defaultDurationSeconds', seconds);
        break;
      }
      case 'candles': {
        const count = parseNumber(value);
        if (count === null || count < 1) return fail('تعداد کندل نامعتبر.');
        settings.set('defaultCandleCount', Math.round(count));
        break;
      }
      case 'chart': {
        const chart = parseChartType(value);
        if (chart === undefined) return fail('نوع چارت نامعتبر (candle / ha / line).');
        settings.set('defaultChartType', chart);
        break;
      }
      case 'entry': {
        const mode = parseTriggerMode(value);
        if (mode === undefined) return fail('نحوهٔ ورود نامعتبر (touch / next).');
        settings.set('defaultTriggerMode', mode);
        break;
      }
      case 'expiry': {
        const mode = parseExpiryMode(value);
        if (mode === undefined) return fail('نوع انقضا نامعتبر (fixed / float).');
        settings.set('defaultExpiryMode', mode);
        break;
      }
      case 'balance': {
        const on = ['on', 'true', '1', 'yes', 'روشن', 'بله'].includes(value.toLowerCase());
        const off = ['off', 'false', '0', 'no', 'خاموش', 'نه'].includes(value.toLowerCase());
        if (!on && !off) return fail('فقط on یا off.');
        settings.set('notifyBalance', on);
        break;
      }
      default:
        return fail(`کلید ناشناخته: ${escapeHtml(key)}`);
    }

    await ctx.reply('✅ ذخیره شد.');
  });

  bot.command('session', async (ctx) => {
    const raw = ctx.match.trim();
    const separator = raw.search(/\s/);
    const modeRaw = (separator < 0 ? raw : raw.slice(0, separator)).toLowerCase();
    const ssid = separator < 0 ? '' : raw.slice(separator + 1).trim();

    if ((modeRaw !== 'demo' && modeRaw !== 'real') || ssid === '') {
      await ctx.reply(SESSION_HELP, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      return;
    }
    await ctx.api
      .deleteMessage(ctx.chat.id, ctx.message!.message_id)
      .catch((error: unknown) => logger.warn('could not delete the message carrying the SSID', error));

    let uid: number;
    try {
      const payload = parseSsid(ssid, modeRaw, settings.get('uid')[modeRaw]);
      uid = payload.uid;
    } catch (error) {
      const message = error instanceof SsidParseError ? error.message : String(error);
      await ctx.reply(`⚠️ SSID خوانده نشد: ${escapeHtml(message)}\n\n${SESSION_HELP}`, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      return;
    }

    settings.setCredentials(modeRaw, ssid, uid);
    engine.reloadCredentials(modeRaw);

    const notice = await ctx.reply(
      `⏳ نشست حساب ${ACCOUNT_LABEL[modeRaw]} ذخیره شد (uid: <code>${uid}</code>). در حال تست اتصال…`,
      { parse_mode: 'HTML' },
    );

    const result = await engine.testCredentials(modeRaw);
    const text = result.ok
      ? `✅ اتصال به حساب ${ACCOUNT_LABEL[modeRaw]} برقرار شد.\n` +
        `موجودی: <b>${formatMoney(result.balance)}</b>\n` +
        'پیام حاوی SSID برای امنیت حذف شد.'
      : `❌ کارگزار این نشست را نپذیرفت.\n<code>${escapeHtml(result.error)}</code>\n\n${SESSION_HELP}`;

    await ctx.api
      .editMessageText(ctx.chat.id, notice.message_id, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      })
      .catch((error: unknown) => logger.debug('could not edit the notice message', error));
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('w:')) {
      await wizard.handleCallback(ctx);
      return;
    }

    if (data.startsWith('h:')) {
      const topic = data.slice(2);
      const text = topic === 'home' ? GUIDE : TOPICS[topic];
      if (text === undefined) {
        await ctx.answerCallbackQuery();
        return;
      }
      await ctx.answerCallbackQuery();
      await ctx
        .editMessageText(text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: topic === 'home' ? topicsKeyboard() : backKeyboard(),
        })
        .catch((error: unknown) => logger.debug('could not switch the guide page', error));
      return;
    }

    if (data.startsWith('c:')) {
      const id = data.slice(2);
      const order = orders.get(id);
      if (!order || order.chatId !== ctx.chat?.id) {
        await ctx.answerCallbackQuery({ text: 'سفارش پیدا نشد.' });
        return;
      }
      const result = engine.cancel(id);
      await ctx.answerCallbackQuery({
        text: result.ok
          ? 'سفارش لغو شد.'
          : result.reason === 'already_open'
            ? 'این معامله باز شده است.'
            : 'این سفارش دیگر فعال نیست.',
        show_alert: !result.ok,
      });
      // The button is dead once the order left the cancellable states, so take it away.
      if (result.ok || result.reason === 'not_active' || result.reason === 'not_found') {
        await ctx
          .editMessageReplyMarkup({ reply_markup: undefined })
          .catch((error: unknown) => logger.debug('could not clear the cancel button', error));
      }
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.on('message:text', async (ctx) => {
    if (await wizard.handleText(ctx)) return;
    if (ctx.message.text.startsWith('/')) return;
    await ctx.reply('برای ساخت سفارش /new را بزنید یا /help را ببینید.');
  });

  bot.catch((error) => {
    logger.error('unhandled bot error', error.error);
  });
  const sessionState = new Map<string, 'up' | 'down'>();

  const onEngineEvent = (event: EngineEvent): void => {
    if (event.type === 'session') {
      const key = `${event.mode}:${event.symbol ?? '*'}`;
      if (sessionState.get(key) === event.state) return;
      const first = !sessionState.has(key);
      sessionState.set(key, event.state);
      if (first && event.state === 'up') return;

      const text =
        event.state === 'up'
          ? `🟢 اتصال <b>${escapeHtml(key)}</b> دوباره برقرار شد.`
          : `🔴 اتصال <b>${escapeHtml(key)}</b> قطع شد. تلاش برای اتصال مجدد ادامه دارد.\n<code>${escapeHtml(event.detail ?? '')}</code>`;
      for (const chatId of recipients()) void send(chatId, text);
      return;
    }

    if (event.type === 'auth_failed') {
      const text =
        `🔑 <b>نشست ${ACCOUNT_LABEL[event.mode]} رد شد</b>\n\n` +
        `${escapeHtml(event.detail)}\n\n` +
        'سفارش‌های شما دست‌نخورده باقی مانده‌اند اما تا ثبت نشست تازه دنبال نمی‌شوند.\n' +
        `برای ثبت مجدد: <code>/session ${event.mode} &lt;SSID&gt;</code>؛ راهنمای برداشتن SSID را با /session ببینید.`;
      for (const chatId of recipients()) void send(chatId, text);
      return;
    }

    const order = event.order;
    const showBalance = settings.get('notifyBalance');
    const balance = balanceSuffix(order.accountMode);

    let text: string;
    switch (event.type) {
      case 'armed':
        text =
          `🎯 <b>قیمت به هدف رسید</b>\n\n${orderHeadline(order)}\n` +
          `قیمت برخورد: <code>${formatPrice(event.price)}</code>\n` +
          `ورود در ابتدای کندل بعدی، ساعت ${formatTime(event.entryAt, config.timezone)}.`;
        break;

      case 'triggered':
        text =
          `🎯 <b>قیمت به هدف رسید، در حال ورود</b>\n\n${orderHeadline(order)}\n` +
          `قیمت برخورد: <code>${formatPrice(event.price)}</code>\n` +
          `${DIRECTION_LABEL[order.direction]} · ${TRIGGER_LABEL[order.triggerMode]}`;
        break;

      case 'opened':
        text =
          `🔵 <b>معامله باز شد</b>\n\n${renderOrder(order, config.timezone, { compact: true })}\n` +
          `قیمت ورود: <code>${formatPrice(order.openPrice)}</code>` +
          (order.closesAt === null ? '' : `\nبسته می‌شود در: ${formatTime(order.closesAt, config.timezone)}`);
        break;

      case 'settled': {
        const icon = order.status === 'won' ? '✅' : order.status === 'lost' ? '🛑' : '🟰';
        const title = order.status === 'won' ? 'برد' : order.status === 'lost' ? 'باخت' : 'مساوی';
        text =
          `${icon} <b>${title}</b>\n\n${orderHeadline(order)}\n` +
          `قیمت ورود: <code>${formatPrice(order.openPrice)}</code> · قیمت خروج: <code>${formatPrice(order.closePrice)}</code>\n` +
          `سود/زیان: <b>${formatMoney(order.profit)}</b>`;
        break;
      }

      case 'failed':
        text = `⚠️ <b>سفارش ناموفق</b>\n\n${orderHeadline(order)}\n${escapeHtml(event.error)}`;
        break;

      case 'expired':
        text =
          `⌛️ <b>سفارش منقضی شد</b>\n\n${orderHeadline(order)}\n` +
          `قیمت تا پایان مهلت به <code>${formatPrice(order.triggerPrice)}</code> نرسید.`;
        break;

      case 'missed':
        text =
          `🚫 <b>فرصت از دست رفت، سفارش لغو شد</b>\n\n${orderHeadline(order)}\n` +
          `قیمت هنگام قطعی جریان قیمت از <code>${formatPrice(order.triggerPrice)}</code> عبور کرد.\n` +
          `قیمت فعلی: <code>${formatPrice(event.price)}</code>\n` +
          'برای ورود با قیمت تازه، سفارش جدید ثبت کنید.';
        break;

      case 'settlement_pending':
        text =
          `⏱ <b>نتیجهٔ معامله هنوز نرسیده</b>\n\n${orderHeadline(order)}\n` +
          'زمان انقضا گذشته اما کارگزار هنوز نتیجه را اعلام نکرده است. پیگیری ادامه دارد.';
        break;

      default:
        return;
    }

    void send(order.chatId, withBalance(text, balance, showBalance));
  };

  engine.onEvent(onEngineEvent);

  return bot;
}
