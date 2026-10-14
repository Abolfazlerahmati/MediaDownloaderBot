/*
 * Panel translations (English -> Persian). Loaded before app.js as a classic script.
 *
 * The panel language is per admin account (en | fa). It is separate from the bot's language setting.
 * Keys are the exact English strings shown in the panel. Strings that are not in the dictionary stay in English,
 * so a missing entry is never blank. Numbers keep ASCII digits, as chosen for the panel.
 */
(function () {
  'use strict';

  var FA = {
    '"Only when addressed" answers when someone mentions the bot or replies to it. "Ignore groups" never answers in groups.':
      '«فقط وقتی خطاب شود» وقتی کسی ربات را نام ببرد یا به آن پاسخ دهد جواب می‌دهد. «نادیده گرفتن گروه‌ها» هرگز در گروه‌ها جواب نمی‌دهد.',
    '0 failed · No downloads yet': '0 ناموفق · هنوز دانلودی نیست',
    '1 means no retry. Only temporary source errors are retried, never blocked or missing media. Range: 1–3.':
      '1 یعنی بدون تلاش مجدد. فقط خطاهای موقت منبع دوباره امتحان می‌شوند، نه مسدودشده یا رسانه‌ی ناموجود. بازه: 1–3.',
    'Account': 'حساب کاربری',
    'Actions': 'اقدام‌ها',
    'All severities': 'همه‌ی سطوح',
    'Answering messages': 'در حال پاسخ به پیام‌ها',
    'App version': 'نسخه‌ی برنامه',
    'Appearance': 'ظاهر',
    'Apply': 'اعمال',
    'Are you sure?': 'مطمئن هستید؟',
    'At least 12 characters. Do not reuse the username.': 'حداقل 12 نویسه. از نام کاربری دوباره استفاده نکنید.',
    'Attempts for source-site errors': 'تعداد تلاش برای خطاهای سایت منبع',
    'BOT_TOKEN secret is set.': 'راز BOT_TOKEN تنظیم شده است.',
    'Bot': 'ربات',
    'Bot and health': 'ربات و سلامت',
    'Bot behaviour': 'رفتار ربات',
    'Bot enabled': 'ربات فعال',
    'Bot is on': 'ربات روشن است',
    'Bot status, the last 24 hours of downloads, and anything that needs attention.':
      'وضعیت ربات، دانلودهای 24 ساعت گذشته و هر موردی که نیاز به توجه دارد.',
    'Bot token': 'توکن ربات',
    'Bot username': 'نام کاربری ربات',
    'Cancel': 'انصراف',
    'Changes apply to the next message the bot receives. Nothing is saved until you press Save.':
      'تغییرات روی پیام بعدی که ربات دریافت می‌کند اعمال می‌شود. تا وقتی ذخیره را نزنید چیزی ذخیره نمی‌شود.',
    'Check the Telegram connection, register the webhook, and review the health checks.':
      'اتصال تلگرام را بررسی کنید، وب‌هوک را ثبت کنید و بررسی‌های سلامت را ببینید.',
    'Configuration': 'پیکربندی',
    'Confirm': 'تأیید',
    'Copy as JSON': 'کپی به صورت JSON',
    'Could not read webhook status.': 'وضعیت وب‌هوک خوانده نشد.',
    'Counted across all chats. When the limit is reached, new links get a busy reply. Range: 1–20.':
      'در همه‌ی گفتگوها شمرده می‌شود. وقتی به سقف برسد، لینک‌های جدید پاسخ «مشغول» می‌گیرند. بازه: 1–20.',
    'Covers the lookup, the download, and the upload. Longer jobs are stopped with a timeout message. Range: 10–300.':
      'جست‌وجو، دانلود و آپلود را شامل می‌شود. کارهای طولانی‌تر با پیام زمان‌تمام متوقف می‌شوند. بازه: 10–300.',
    'Current password': 'رمز عبور فعلی',
    'Current values as stored.': 'مقادیر فعلی، همان‌طور که ذخیره شده‌اند.',
    'Dark': 'تیره',
    'Dashboard': 'داشبورد',
    'Database schema': 'ساختار پایگاه داده',
    'Dedupe seconds': 'ثانیه‌ی جلوگیری از تکرار',
    'Default language': 'زبان پیش‌فرض',
    'Detail': 'جزئیات',
    'Diagnostics': 'عیب‌یابی',
    'Discard changes': 'لغو تغییرات',
    'Download timeout seconds': 'مهلت دانلود (ثانیه)',
    'Downloads at the same time': 'دانلودهای همزمان',
    'Downloads per user per minute': 'دانلود برای هر کاربر در دقیقه',
    'Downloads, last 24 hours': 'دانلودها، 24 ساعت گذشته',
    'Duplicate-link window (seconds)': 'بازه‌ی لینک تکراری (ثانیه)',
    'Enable platforms in the Platforms page.': 'پلتفرم‌ها را در صفحه‌ی پلتفرم‌ها فعال کنید.',
    'Enabled': 'فعال',
    'English': 'انگلیسی',
    'Error': 'خطا',
    'Errors and events from the bot and the panel. Logs never contain tokens, full links, or user identifiers. Retention is set in Settings.':
      'خطاها و رویدادهای ربات و پنل. گزارش‌ها هرگز توکن، لینک کامل یا شناسه‌ی کاربر ندارند. مدت نگهداری در تنظیمات تعیین می‌شود.',
    'Event': 'رویداد',
    'Event log': 'گزارش رویدادها',
    'Extra links in one message are skipped, with one notice. Range: 1–5.':
      'لینک‌های اضافی در یک پیام نادیده گرفته می‌شوند و یک اعلان نمایش داده می‌شود. بازه: 1–5.',
    'Extractor ready': 'استخراج‌کننده آماده است',
    'Group mode': 'حالت گروه',
    'Health checks': 'بررسی‌های سلامت',
    'How the bot answers in private chats and groups.': 'پاسخ ربات در گفتگوهای خصوصی و گروه‌ها.',
    'Ignore groups': 'نادیده گرفتن گروه‌ها',
    'Implemented': 'پیاده‌سازی شده',
    'Instagram': 'اینستاگرام',
    'Keep language choices for (days)': 'نگهداری انتخاب زبان (روز)',
    'Keep logs for (days)': 'نگهداری گزارش‌ها (روز)',
    'Key': 'کلید',
    'Language retention days': 'مدت نگهداری زبان کاربران (روز)',
    'Largest file to send (MB)': 'بزرگ‌ترین فایل برای ارسال (MB)',
    'Last Telegram error': 'آخرین خطای تلگرام',
    'Last test': 'آخرین آزمون',
    'Light': 'روشن',
    'Limits': 'محدودیت‌ها',
    'Limits protect the chat and the Worker from overload. They are checked on save.':
      'محدودیت‌ها از گفتگو و سرویس در برابر بار زیاد محافظت می‌کنند. هنگام ذخیره بررسی می‌شوند.',
    'Links beyond this limit get a rate-limit reply. Range: 1–60.': 'لینک‌های بیشتر از این حد پاسخ محدودیت نرخ می‌گیرند. بازه: 1–60.',
    'Links handled per message': 'تعداد لینک در هر پیام',
    'Load more': 'بارگذاری بیشتر',
    'Log retention days': 'مدت نگهداری گزارش‌ها (روز)',
    'Login max failures': 'حداکثر تلاش ناموفق ورود',
    'Login window minutes': 'بازه‌ی ورود (دقیقه)',
    'Logs': 'گزارش‌ها',
    'Logs, last 24 hours': 'گزارش‌ها، 24 ساعت گذشته',
    'Main navigation': 'منوی اصلی',
    'Maintenance message': 'پیام تعمیر و نگهداری',
    'Max concurrent jobs': 'حداکثر کارهای همزمان',
    'Max file mb': 'حداکثر حجم فایل (MB)',
    'Max links per message': 'حداکثر لینک در هر پیام',
    'Max upload bytes': 'حداکثر حجم آپلود (بایت)',
    'Menu': 'منو',
    'Mode': 'حالت',
    'New password': 'رمز عبور جدید',
    'No failed downloads': 'دانلود ناموفقی نیست',
    'No log entries': 'گزارشی نیست',
    'No unsaved changes': 'تغییر ذخیره‌نشده‌ای نیست',
    'Not registered': 'ثبت نشده',
    'Not tested': 'آزمایش نشده',
    'Nothing failed in the log retention window.': 'در بازه‌ی نگهداری گزارش‌ها موردی ناموفق نبوده است.',
    'Nothing matches these filters.': 'با این فیلترها موردی پیدا نشد.',
    'OK': 'سالم',
    'Off': 'خاموش',
    'Off means no language choice is saved. Everyone gets the default language, and existing choices are deleted.':
      'خاموش یعنی هیچ انتخاب زبانی ذخیره نمی‌شود. همه زبان پیش‌فرض را می‌گیرند و انتخاب‌های موجود حذف می‌شوند.',
    'On': 'روشن',
    'Older choices are deleted by the hourly cleanup. Range: 1–365.': 'انتخاب‌های قدیمی‌تر در پاکسازی ساعتی حذف می‌شوند. بازه: 1–365.',
    'Older log entries are deleted by the hourly cleanup. Range: 1–90.': 'گزارش‌های قدیمی‌تر در پاکسازی ساعتی حذف می‌شوند. بازه: 1–90.',
    'Error codes and the source status only. No links or user IDs.': 'فقط کد خطا و وضعیت سایت منبع نشان داده می‌شود. نه لینک، نه شناسه‌ی کاربر.',
    'Only when addressed': 'فقط وقتی خطاب شود',
    'Open Bot and health': 'باز کردن ربات و سلامت',
    'Operations': 'عملیات',
    'Overview': 'نمای کلی',
    'Password': 'رمز عبور',
    'Pbkdf2 iterations': 'تکرار PBKDF2',
    'Pending updates': 'به‌روزرسانی‌های در انتظار',
    'Persian (فارسی)': 'فارسی (فارسی)',
    'Pinterest': 'پینترست',
    'Pinterest: add a sample link and run a test.': 'پینترست: یک لینک نمونه اضافه و آزمایش را اجرا کنید.',
    'Platform': 'پلتفرم',
    'Platforms': 'پلتفرم‌ها',
    'Privacy and logs': 'حریم خصوصی و گزارش‌ها',
    'Public links only. Private, login-only, and story content is not supported.':
      'فقط لینک‌های عمومی. محتوای خصوصی، ویژه‌ی ورود و استوری پشتیبانی نمی‌شود.',
    'Rate limit per minute': 'محدودیت نرخ در دقیقه',
    'Recent failures': 'خطاهای اخیر',
    'Redacted. Secret values are never shown, only whether each one is set.':
      'مخفی‌شده. مقدار رازها هرگز نشان داده نمی‌شود، فقط مشخص می‌شود تنظیم شده‌اند یا نه.',
    'Refresh': 'به‌روزرسانی',
    'Register it in Bot and health': 'در ربات و سلامت ثبتش کنید',
    'Register points Telegram at this Worker. Telegram sends updates only after this.':
      'ثبت، تلگرام را به این سرویس وصل می‌کند. تلگرام فقط بعد از این به‌روزرسانی می‌فرستد.',
    'Register webhook': 'ثبت وب‌هوک',
    'Remember each user’s language': 'زبان هر کاربر را به یاد بسپار',
    'Remove webhook': 'حذف وب‌هوک',
    'Removing the webhook stops the bot from receiving messages.': 'حذف وب‌هوک باعث می‌شود ربات دیگر پیامی دریافت نکند.',
    'Repeat new password': 'تکرار رمز عبور جدید',
    'Replies in groups': 'پاسخ در گروه‌ها',
    'Reset': 'بازنشانی',
    'Retry attempts': 'تعداد تلاش مجدد',
    'Run again after you change a secret or a setting.': 'بعد از تغییر راز یا تنظیم، دوباره اجرا کنید.',
    'Run test': 'اجرای آزمایش',
    'Sample public link': 'لینک عمومی نمونه',
    'Save appearance': 'ذخیره‌ی ظاهر',
    'Save changes': 'ذخیره‌ی تغییرات',
    'Save link': 'ذخیره‌ی لینک',
    'Search detail': 'جست‌وجو در جزئیات',
    'Secrets': 'رازها',
    'Sections': 'بخش‌ها',
    'Session ttl hours': 'مدت نشست (ساعت)',
    'Set': 'تنظیم شده',
    'Set in Cloudflare Secrets': 'در Cloudflare Secrets تنظیم شده',
    'Set these in Cloudflare Secrets.': 'این‌ها را در Cloudflare Secrets تنظیم کنید.',
    'Settings': 'تنظیمات',
    'Severity': 'سطح',
    'Showing your saved choice.': 'انتخاب ذخیره‌شده‌ی شما نمایش داده می‌شود.',
    'Shown to private chats while the bot is off. Leave empty for the default text.':
      'هنگام خاموش بودن ربات به گفتگوهای خصوصی نشان داده می‌شود. برای متن پیش‌فرض خالی بگذارید.',
    'Sign out': 'خروج',
    'Signed in as admin': 'وارد شده به عنوان admin',
    'Signed in as admin.': 'وارد شده به عنوان admin.',
    'Skip to content': 'پرش به محتوا',
    'Status': 'وضعیت',
    'Store language': 'ذخیره‌ی زبان کاربران',
    'System': 'سیستم',
    'System follows the device setting. The preview applies at once; press Save to keep it.':
      'سیستم از تنظیم دستگاه پیروی می‌کند. پیش‌نمایش فوراً اعمال می‌شود؛ برای نگه داشتن آن ذخیره را بزنید.',
    'Telegram accepts at most 50 MB from a bot. Larger files get an error message instead. Range: 1–50.':
      'تلگرام حداکثر 50 MB از ربات می‌پذیرد. فایل‌های بزرگ‌تر پیام خطا می‌گیرند. بازه: 1–50.',
    'Telegram bot': 'ربات تلگرام',
    'Telegram did not answer.': 'تلگرام پاسخ نداد.',
    'Telegram said: network error': 'تلگرام گفت: خطای شبکه',
    'Telegram webhook': 'وب‌هوک تلگرام',
    'Test connection': 'آزمایش اتصال',
    'Test connection calls Telegram getMe with the saved token.': 'آزمایش اتصال، با توکن ذخیره‌شده getMe را به تلگرام می‌فرستد.',
    'Test first. Register the webhook once the test passes.': 'اول آزمایش کنید. بعد از موفقیت آزمایش، وب‌هوک را ثبت کنید.',
    'Text in the detail': 'متن در جزئیات',
    'The Telegram webhook is not registered.': 'وب‌هوک تلگرام ثبت نشده است.',
    'The same link in the same chat is ignored for this long. 0 turns the check off. Range: 0–600.':
      'همان لینک در همان گفتگو تا این مدت نادیده گرفته می‌شود. 0 یعنی بررسی خاموش. بازه: 0–600.',
    'The token is read-only here. To change it, edit BOT_TOKEN in Cloudflare Secrets, then run Test connection and Register webhook.':
      'توکن اینجا فقط‌خواندنی است. برای تغییر، BOT_TOKEN را در Cloudflare Secrets ویرایش کنید، سپس آزمایش اتصال و ثبت وب‌هوک را اجرا کنید.',
    'Theme': 'تم',
    'TikTok': 'تیک‌تاک',
    'TikTok: add a sample link and run a test.': 'تیک‌تاک: یک لینک نمونه اضافه و آزمایش را اجرا کنید.',
    'Time': 'زمان',
    'Time limit per link (seconds)': 'مهلت هر لینک (ثانیه)',
    'Turn off': 'خاموش کردن',
    'Turn on': 'روشن کردن',
    'Turn platforms on or off, save a sample link, and run an extraction test. A test only looks up the link. It never downloads or sends a file.':
      'پلتفرم‌ها را روشن یا خاموش کنید، لینک نمونه ذخیره کنید و آزمایش استخراج را اجرا کنید. آزمایش فقط لینک را بررسی می‌کند و هرگز فایلی دانلود یا ارسال نمی‌کند.',
    'Update password': 'به‌روزرسانی رمز عبور',
    'Updates Telegram has not delivered yet': 'به‌روزرسانی‌هایی که تلگرام هنوز تحویل نداده',
    'Used for people who have not picked a language with /language.': 'برای کسانی که با /language زبانی انتخاب نکرده‌اند استفاده می‌شود.',
    'Used only by the extraction test. Use a public https link from this platform.':
      'فقط در آزمایش استخراج استفاده می‌شود. یک لینک https عمومی از همین پلتفرم بگذارید.',
    'WEBHOOK_SECRET is set and well formed.': 'WEBHOOK_SECRET تنظیم و درست قالب‌بندی شده است.',
    'Warning': 'هشدار',
    'Webhook address': 'نشانی وب‌هوک',
    'Webhook status': 'وضعیت وب‌هوک',
    'What is kept, and for how long. See docs/privacy.md for the full list.':
      'چه داده‌هایی نگه داشته می‌شود و تا کی. فهرست کامل در docs/privacy.md است.',
    'When off, the bot does not answer. Private chats get the maintenance message below.':
      'وقتی خاموش باشد، ربات پاسخ نمی‌دهد. گفتگوهای خصوصی پیام تعمیر و نگهداری زیر را می‌گیرند.',
    'Yes': 'بله',
    'YouTube': 'یوتیوب',
    'addressed': 'فقط خطاب شده',
    'bot_token': 'توکن ربات',
    'database': 'پایگاه داده',
    'network error': 'خطای شبکه',
    'ok': 'موفق',
    'password_changed': 'رمز عبور تغییر کرد',
    'platform_pinterest': 'پلتفرم پینترست',
    'platform_tiktok': 'پلتفرم تیک‌تاک',
    'rate_limit_per_minute': 'محدودیت نرخ در دقیقه',
    'settings_changed': 'تنظیمات تغییر کرد',
    'telegram_api': 'API تلگرام',
    'tiktok': 'تیک‌تاک',
    'pinterest': 'پینترست',
    'youtube': 'یوتیوب',
    'instagram': 'اینستاگرام',
    'webhook': 'وب‌هوک',
    'webhook_secret': 'راز وب‌هوک',
    'Webhook registered.': 'وب‌هوک ثبت شد.',
    'Webhook removed.': 'وب‌هوک حذف شد.',
    'Password updated.': 'رمز عبور به‌روزرسانی شد.',
    'Settings saved.': 'تنظیمات ذخیره شد.',
    'Appearance saved.': 'ظاهر ذخیره شد.',
    'Fix the highlighted fields first.': 'ابتدا فیلدهای مشخص‌شده را اصلاح کنید.',
    'Preview on. Not saved yet.': 'پیش‌نمایش روشن است. هنوز ذخیره نشده.',
    'The request failed.': 'درخواست ناموفق بود.',
    'Something went wrong on this page.': 'در این صفحه مشکلی پیش آمد.',
    'Loading…': 'در حال بارگذاری…',
    'Sign in': 'ورود',
    'Username': 'نام کاربری',
    'Log in': 'ورود',
    'Language': 'زبان',
    'Panel language': 'زبان پنل',
    'Language of this panel. It does not change the bot.': 'زبان این پنل. زبان ربات را تغییر نمی‌دهد.',
    'Panel language is saved with your account. Press Save appearance to apply it.':
      'زبان پنل با حساب شما ذخیره می‌شود. برای اعمال آن، ظاهر را ذخیره کنید.',
    'The source site failed or changed': 'سایت منبع خطا داد یا تغییر کرد',
    'The post or video was not found': 'پست یا ویدیو پیدا نشد',
    'No downloadable video was found': 'ویدیوی قابل دانلودی پیدا نشد',
    'The file is larger than the limit': 'فایل از حد مجاز بزرگ‌تر است',
    'The time limit was reached': 'مهلت زمانی تمام شد',
    'Telegram rejected the upload': 'تلگرام آپلود را نپذیرفت',
    'Internal error': 'خطای داخلی',
    'Network error. Check your connection and try again.': 'خطای شبکه. اتصال خود را بررسی کنید و دوباره امتحان کنید.',
    'This page could not be loaded.': 'این صفحه بارگذاری نشد.',
    'Try again': 'تلاش دوباره',
    'Payments console: dark navigation, dense tables, blue accent.': 'کنسول پرداخت: منوی تیره، جدول‌های فشرده و تأکید آبی.',
    'Grouped surfaces, rounded corners, translucent bars, system blue.': 'سطوح گروه‌بندی‌شده، گوشه‌های گرد، نوارهای شیشه‌ای و آبی سیستمی.',
    'Admin panel': 'پنل مدیریت',
    'Register points Telegram at this Worker and sends the WEBHOOK_SECRET value with it. Press it once after you create or change WEBHOOK_SECRET. Telegram sends updates only after this.': 'ثبت وب‌هوک، نشانی این کارگر را به تلگرام می‌دهد و سکرت WEBHOOK_SECRET را همراه آن می‌فرستد. بعد از ساختن یا تغییر WEBHOOK_SECRET یک‌بار آن را بزنید. تلگرام فقط بعد از این به‌روزرسانی‌ها را می‌فرستد.',
    'The webhook was not registered with the current WEBHOOK_SECRET.': 'وب‌هوک با WEBHOOK_SECRET فعلی ثبت نشده است.',
    'Telegram may hold a missing or older secret, so updates are rejected with 403. Press Register webhook below once.': 'ممکن است تلگرام سکرت قدیمی یا خالی داشته باشد، پس به‌روزرسانی‌ها با خطای 403 رد می‌شوند. یک‌بار «ثبت وب‌هوک» را بزنید.',
    'Register again': 'ثبت دوباره لازم است',
    'Info': 'اطلاعات',
    'Runtime': 'زمان اجرا',
    'Merchant': 'مرچنت',
    'iOS': 'iOS',
  };

  // Dynamic messages: [pattern, replacement function]. Numbers stay ASCII.
  var PATTERNS = [
    [/^Enter a number from (\d+) to (\d+)\.$/, function (m) { return 'یک عدد از ' + m[1] + ' تا ' + m[2] + ' وارد کنید.'; }],
    [/^Enter a whole number\.?$/, function () { return 'یک عدد صحیح وارد کنید.'; }],
    [/^Signed in as (.+)$/, function (m) { return 'وارد شده به عنوان ' + m[1]; }],
    [/^Connected as @(.+)\.$/, function (m) { return 'متصل به @' + m[1] + '.'; }],
    [/^(\d+) minutes? ago$/, function (m) { return m[1] + ' دقیقه پیش'; }],
    [/^(\d+) hours? ago$/, function (m) { return m[1] + ' ساعت پیش'; }],
    [/^(\d+) days? ago$/, function (m) { return m[1] + ' روز پیش'; }],
    [/^(\d+) seconds? ago$/, function (m) { return m[1] + ' ثانیه پیش'; }],
    [/^just now$/, function () { return 'همین الان'; }],
    [/^D1 reachable, schema version (\d+)\.$/, function (m) { return 'پایگاه داده D1 در دسترس است؛ نسخه‌ی ساختار ' + m[1] + '.'; }],
    [/^(\d+)% success$/, function (m) { return m[1] + '٪ موفقیت'; }],
    [/^(\d+) shown$/, function (m) { return m[1] + ' مورد نمایش داده شد'; }],
    [/^(\d+) failed · (.+)$/, function (m) { return m[1] + ' ناموفق · ' + translate(m[2]); }],
  ];

  var lang = 'en';

  function translate(text) {
    if (lang !== 'fa') return text;
    var key = text.trim();
    if (!key) return text;
    if (Object.prototype.hasOwnProperty.call(FA, key)) return text.replace(key, FA[key]);
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i][0].exec(key);
      if (m) return text.replace(key, PATTERNS[i][1](m));
    }
    return text;
  }

  var TRANSLATED_ATTRS = ['placeholder', 'title', 'aria-label'];

  function translateTree(root) {
    if (lang !== 'fa' || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;
      var next = translate(node.textContent);
      if (next !== node.textContent) node.textContent = next;
    }
    var els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label]') : [];
    for (var i = 0; i < els.length; i++) {
      for (var a = 0; a < TRANSLATED_ATTRS.length; a++) {
        var attr = TRANSLATED_ATTRS[a];
        var v = els[i].getAttribute(attr);
        if (v) {
          var tv = translate(v);
          if (tv !== v) els[i].setAttribute(attr, tv);
        }
      }
    }
  }

  function setLang(next) {
    lang = next === 'fa' ? 'fa' : 'en';
    var root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return;
    root.lang = lang;
    root.dir = lang === 'fa' ? 'rtl' : 'ltr';
    root.dataset.lang = lang;
  }

  function getLang() {
    return lang;
  }

  window.MBI18N = {
    setLang: setLang,
    getLang: getLang,
    tr: translate,
    translateTree: translateTree,
    /** Used by tests and the coverage check. */
    dictionary: FA,
    patterns: PATTERNS,
  };
})();
