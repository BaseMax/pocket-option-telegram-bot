/** The values the panel cannot toggle for the user: it has to ask, and the user has to type. */
export type PromptField = 'symbol' | 'price' | 'amount' | 'duration' | 'candles' | 'valid';

/** Everywhere the user may type a duration accepts the same spellings; this is the reminder we show. */
export const TIME_FORMAT_HINT =
  'واحد را هرطور راحتید بنویسید: <code>s</code>/<code>sec</code>/<code>second</code>/<code>ثانیه</code> · ' +
  '<code>m</code>/<code>min</code>/<code>minute</code>/<code>دقیقه</code> · <code>h</code>/<code>hour</code>/<code>ساعت</code> · ' +
  '<code>d</code>/<code>day</code>/<code>روز</code> · <code>w</code>/<code>week</code>/<code>هفته</code> · ' +
  '<code>mo</code>/<code>month</code>/<code>ماه</code>\n' +
  'حرف بزرگ و کوچک، فاصله بین عدد و واحد، و رقم فارسی هم اشکالی ندارد. عدد تنها یعنی ثانیه.';

export interface PromptCopy {
  /** The one-line reminder printed inside the order panel while we wait. */
  panel: string;
  /** The separate force-reply message that tells the user to type, with examples. */
  message: string;
  /** Telegram input-box placeholder, at most 64 characters. */
  placeholder: string;
  /** The toast shown on the button tap itself, at most 200 characters. */
  toast: string;
}

export const PROMPTS: Record<PromptField, PromptCopy> = {
  symbol: {
    panel: 'نماد را تایپ کنید و بفرستید.',
    message:
      '⌨️ <b>نماد را تایپ کنید</b>\n\n' +
      'نام نماد را بنویسید و بفرستید.\n' +
      'نمونه: <code>EURUSD</code> · <code>GBPAUD_otc</code> · <code>BTCUSD</code>\n\n' +
      'اگر نام دقیق را نمی‌دانید، با <code>/symbols eur</code> جست‌وجو کنید.',
    placeholder: 'مثلاً EURUSD یا GBPAUD_otc',
    toast: 'نماد را همین‌جا تایپ کنید و بفرستید. مثلاً EURUSD',
  },
  price: {
    panel: 'قیمت ورود هدف را تایپ کنید و بفرستید.',
    message:
      '⌨️ <b>قیمت ورود هدف را تایپ کنید</b>\n\n' +
      'عددی که اگر قیمت نماد به آن برسد، معامله باز شود.\n' +
      'نمونه: <code>1.95320</code> · <code>۱٫۰۸۵۴۰</code>\n\n' +
      'قیمت لحظه‌ای نماد را می‌توانید با <code>/price EURUSD</code> ببینید.',
    placeholder: 'مثلاً 1.95320',
    toast: 'قیمت هدف را همین‌جا تایپ کنید و بفرستید. مثلاً 1.95320',
  },
  amount: {
    panel: 'مبلغ معامله را به دلار تایپ کنید و بفرستید.',
    message:
      '⌨️ <b>مبلغ معامله را تایپ کنید</b>\n\n' +
      'مبلغ به دلار، فقط عدد.\n' +
      'نمونه: <code>1</code> · <code>5</code> · <code>12.5</code>',
    placeholder: 'مبلغ به دلار، مثلاً 5',
    toast: 'مبلغ را به دلار همین‌جا تایپ کنید و بفرستید. مثلاً 5',
  },
  duration: {
    panel: 'مدت ماندن در معامله را تایپ کنید و بفرستید.',
    message:
      '⌨️ <b>مدت معامله را تایپ کنید</b>\n\n' +
      'معامله چقدر باز بماند؟\n' +
      'نمونه: <code>60</code> · <code>1m</code> · <code>۹۰ ثانیه</code> · <code>2 دقیقه</code> · <code>1h 30m</code>\n\n' +
      TIME_FORMAT_HINT,
    placeholder: 'مثلاً 1m یا 90 یا 2 دقیقه',
    toast: 'مدت معامله را همین‌جا تایپ کنید و بفرستید. مثلاً 1m یا 90 یا 2 دقیقه',
  },
  candles: {
    panel: 'تعداد کندل را تایپ کنید و بفرستید.',
    message:
      '⌨️ <b>تعداد کندل را تایپ کنید</b>\n\n' +
      'معامله تا پایان چند کندل باز بماند؟ فقط عدد.\n' +
      'نمونه: <code>1</code> یعنی تا پایان همین کندل جاری · <code>3</code> یعنی تا پایان سومین کندل.',
    placeholder: 'مثلاً 1',
    toast: 'تعداد کندل را همین‌جا تایپ کنید و بفرستید. مثلاً 1',
  },
  valid: {
    panel: 'مدت اعتبار سفارش را تایپ کنید و بفرستید.',
    message:
      '⌨️ <b>مدت اعتبار سفارش را تایپ کنید</b>\n\n' +
      'تا چه مدت منتظر رسیدن قیمت به هدف بمانیم؟ بعد از آن، سفارش خودبه‌خود منقضی می‌شود.\n' +
      'نمونه: <code>30m</code> · <code>۳۰ دقیقه</code> · <code>2h</code> · <code>1 روز</code>\n' +
      'برای اینکه سفارش هیچ‌وقت منقضی نشود، بفرستید <code>0</code>.\n\n' +
      TIME_FORMAT_HINT,
    placeholder: 'مثلاً 30m یا 2 ساعت · 0 یعنی بی‌نهایت',
    toast: 'مدت اعتبار را همین‌جا تایپ کنید و بفرستید. مثلاً 30m یا ۳۰ دقیقه · 0 یعنی بی‌نهایت',
  },
};
