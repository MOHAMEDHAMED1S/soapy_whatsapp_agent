# ميزة تشغيل WhatsApp والمتصفح

## موضعها في الخطة

هذه الميزة `بعد V1`. لا يدير Control Plane Lite مسارات Chromium/LocalAuth أو reconnect/health/typing internals، ولا يقدم reconnect/restart API. تبقى القيم الحالية و`.env` كما هي حتى بناء drain/reconnect coordinator واختباره دون خسارة الجلسة أو الرسائل.

## الوضع الحالي

قيم إعادة الاتصال وhealth check والtyping وPuppeteer args والـauth path مدمجة داخل `WhatsAppBot`. بعض التغييرات يمكن تطبيقها فوراً وبعضها يتطلب client جديداً أو restart.

## الهدف

- التحكم في سياسات التشغيل الآمنة.
- عدم إسقاط جلسة WhatsApp بسبب activation عادية.
- إظهار impact وpending restart بدقة.
- الحفاظ على القيم الحالية fallback.

## الإعدادات المدارة

### Dynamic

- reconnect max attempts/base delay/cap/jitter.
- health interval/failure threshold.
- typing refresh/max duration.
- disconnect debounce.
- send retry policy ضمن سقوف.

### Reconnect required

- Puppeteer timeout/headless/executable path وبعض args الآمنة.
- browser resource options.

### Restart required

- LocalAuth data path/session identity.
- خيارات تغير ملكية ملفات الجلسة.

لا يسمح API بإضافة Puppeteer flags عشوائية في الإصدار الأول؛ نستخدم allow-listed profile.

## APIs

- settings عبر revisions.
- `GET /whatsapp/config-impact` يعرض effective/pending/apply mode.
- `POST /whatsapp/validate-browser` يفحص الملف والصلاحيات والتوافق دون فتح جلسة ثانية.
- `POST /whatsapp/reconnect` عملية audited/idempotent مع drain.

## fallback

managed value -> env إذا أضيف المتغير -> constant الحالي. فشل Control API لا يؤثر على client الحالي. فشل إعادة بناء client بالقيم الجديدة يعيد profile السابقة ويحاول reconnect منضبطاً.

## Runtime appliers

- timers يعاد جدولتها atomically دون ترك intervals قديمة.
- reconnect settings تقرأ snapshot عند بداية دورة reconnect ولا تتغير وسطها.
- reconnect-required revision تظل pending حتى operation صريحة.
- restart coordinator ينتظر message queue ضمن timeout ثم يغلق browser/DB/status بشكل آمن.

## حماية session

- لا تعرض auth path contents أو QR في Control API/audit.
- validate path يمنع traversal والمسارات غير المصرح بها.
- لا يبدأ clientان على نفس LocalAuth path.
- lock واضح يمنع reconnect/restart متزامنين.

## حالات الفشل

- executable غير موجود: رفض activation أو إبقاء pending مع validation failed؛ استخدم legacy Puppeteer resolution.
- reconnect يفشل: rollback profile وإظهار degraded؛ لا تكرر بلا نهاية.
- restart يفشل: PM2 يعيد النسخة السابقة وفق deployment policy.
- update أثناء active typing sessions: timers الجديدة تطبق على sessions الجديدة، والقديمة تنظف بأمان.

## الاختبارات ومعايير القبول

- timer rescheduling بلا leaks.
- single-flight reconnect.
- validation لا يقتل browser الحالي.
- missing managed executable يعود إلى legacy.
- pending restart لا يظهر effective كذباً.
- session directory لا تمسح عند rollback.
- Status API تعكس state transitions بدقة.
