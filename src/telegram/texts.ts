import { InlineKeyboard } from 'grammy';
import { CHART_HELP, EXPIRY_HELP, EXPIRY_LABEL, TRIGGER_HELP } from './format.ts';
import { TIME_FORMAT_HINT } from './wizard/prompts.ts';

export const GUIDE = `
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

export const HELP = `
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

export const SESSION_HELP = `
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

/** The deep-dive pages reachable from the guide's buttons. */
export const TOPICS: Record<string, string> = {
  chart: CHART_GUIDE,
  time: TIME_GUIDE,
  trade: TRADE_GUIDE,
  commands: HELP,
  session: SESSION_HELP,
};

export function topicsKeyboard(): InlineKeyboard {
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

export function backKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('« بازگشت به راهنما', 'h:home');
}

/** The command list Telegram shows in the chat's menu. */
export const COMMAND_LIST: readonly { command: string; description: string }[] = [
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
  { command: 'session', description: 'ثبت نشست پاکت آپشن' },
  { command: 'mode', description: 'حساب دمو یا ریل' },
  { command: 'help', description: 'راهنما' },
];
