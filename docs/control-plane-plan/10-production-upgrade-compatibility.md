# عقد أمان الترقية لمستخدمي Production الحاليين

## الإجابة المختصرة

المعيار الإلزامي هو أن التحديث الأول يكون آمناً وشفافاً للمستخدم الحالي حتى قبل إعداد أي شيء. إذا لم يفعّل البائع Control Plane صراحة، يجب ألا يلاحظ أي تغيير في التشغيل أو قاعدة البيانات أو الإعدادات أو المنافذ أو سلوك العملاء.

هذا ليس ضماناً نظرياً بمجرد كتابة الكود؛ لا يسمح بإصدار النسخة إلا بعد اجتياز اختبارات التوافق والترقية والرجوع الموضحة هنا.

## عقد `no-op upgrade`

عند غياب متغيرات Control Plane الجديدة، أو عندما تكون `CONTROL_PLANE_ENABLED=false`:

1. تستخدم جميع الخدمات `.env` الحالية والقيم المدمجة الحالية بنفس precedence.
2. لا تصبح أي قيمة جديدة مطلوبة في `.env`.
3. لا يبدأ Control API ولا يحجز port جديداً.
4. لا تنفذ migrations أو writes تخص Control Plane.
5. لا تنشأ جداول أو ملفات أو timers أو network calls جديدة.
6. لا تنسخ API keys أو admin phones أو prompts تلقائياً إلى قاعدة البيانات.
7. لا تتغير قاعدة بيانات المحادثات والطلبات ولا يعاد serialization لمحتواها.
8. لا تتغير أسماء الجداول أو الأعمدة أو indexes الحالية.
9. لا يتغير ترتيب startup/shutdown أو WhatsApp session path أو PM2 behavior بسبب هذه الميزة.
10. لا تستخدم managed rows قديمة حتى لو وجدت، ما دام `CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false`.
11. يمر التشغيل من مسار Legacy مستقل عند composition root؛ لا يستبدل `config.ts` أو clients الحالية بـresolver جديد ثم يفترض أنه مكافئ.
12. لا تستورد وحدات Control Plane ذات top-level side effects في Legacy mode؛ التحميل lazy بعد فحص feature flag.

إذا لم يحقق الإصدار هذه النقاط فهو غير صالح للنشر العام.

### معنى “وضع القيم الافتراضية تلقائياً”

لا تعني النقطة 6 أن الـdashboard ستظهر فارغة. عند التحديث تكون قيم البداية المنطقية لكل متجر هي القيم التي يستخدمها فعلاً قبل التحديث، ويقرأها `legacyResolver` تلقائياً:

```text
store-specific .env
-> existing legacy DB value عند انطباقها
-> current built-in value
```

تظهر هذه القيم في read-only API كـ`effective + inherited` دون كتابة صفوف managed. هذا هو الاختيار الآمن لأن bulk seeding وقت تحديث الـbinary سيعدل DB وينسخ secrets وقد يجمّد قيمة `.env` بدلاً من استمرارها كمصدر حي.

عند أول تعديل صريح يخزن النظام المفتاح المتغير فقط. الأسرار الحالية لا تنسخ إطلاقاً؛ يبقى source=`env`. وبهذا يحصل المتجر على defaults الحالية تلقائياً مع الحفاظ على عقد `no-op upgrade`.

## Legacy bypass عند نقطة التشغيل

أكثر تطبيق أماناً ليس أن تمر الخدمات الحالية دائماً عبر طبقة جديدة، بل أن يوجد branch واضح عند تركيب التطبيق:

```text
CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false
    -> Current config + current service factories كما هي

CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=true
    -> Managed configuration adapters + fallback chain
```

بهذا يكون kill switch حقيقياً حتى لو كان هناك bug داخل Registry أو resolver. وحدات Control Plane لا تنشئ database singleton أو timers أو HTTP server عند import؛ كل initialization صريح وبعد feature flag. بعد نجاح shadow والتكافؤ يمكن تقليل الازدواج تدريجياً، لكن لا نحذف legacy bypass في أول الإصدارات.

## لا متغيرات مطلوبة جديدة

القيم الجديدة كلها optional والافتراضي الآمن لها disabled:

```env
CONTROL_PLANE_ENABLED=false
CONTROL_PLANE_WRITES_ENABLED=false
CONTROL_PLANE_ACTIVATION_ENABLED=false
CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false
```

`CONTROL_API_TOKEN`, `CONTROL_API_SCOPES`, و`CONTROL_SECRETS_MASTER_KEY` لا تصبح مطلوبة إلا عندما يطلب المشغل تفعيل الوظيفة التي تحتاجها. غيابها لا يسبب startup error في legacy mode، وغياب scopes عند تشغيل الواجهة يعطي read-only بدلاً من صلاحيات واسعة.

غياب `CONTROL_SECRETS_MASTER_KEY` بعد تفعيل الواجهة لا يسقط التطبيق أيضاً: يمنع managed secret writes/resolution فقط، ويستمر `GEMINI_API_KEY` من `.env`.

## مراحل آمنة للمستخدم الحالي

### الحالة A: تحديث فقط

كل flags غائبة أو false. النتيجة legacy كاملة بلا DB changes.

### الحالة B: تفعيل Read-only

يفعّل المشغل Control Plane وtoken فقط. تنشأ الجداول الإضافية بعد backup/migration صريحة، وتعرض API تلقائياً القيم الموروثة من `.env` وlegacy DB والconstants الحالية دون أن تغير runtime.

### الحالة C: التحقق وتجهيز secret بلا تفعيل

يمكن استخدام validate-only. وإذا فُتحت writes مع secret provider مهيأ يمكن تجهيز secret reference غير مستخدمة، لكن settings PUT/DELETE/rollback تظل مرفوضة ما دام activation مغلقاً. لا تخزن V1 draft إعدادات صامتة.

### الحالة D: Activation بلا Runtime Consumption

يمكن اختبار validate-and-activate وتخزين active revision، لكن `MANAGED_RESOLUTION` false؛ البوت يظل legacy. هذه مرحلة shadow للتحقق من أن effective candidate يطابق المتوقع.

### الحالة E: Managed Resolution لnamespace واحدة من V1

تفعّل namespace منخفضة المخاطر بعد canary. بقية المشروع تظل legacy.

بهذا لا توجد قفزة من النظام الحالي إلى التحكم الكامل. المفاتيح المصنفة `Later` لا تقبلها write API حتى لو كانت موثقة في roadmap.

## سياسة قاعدة البيانات

### قبل أول migration

- تشغيل `PRAGMA quick_check` أو فحص مناسب.
- إنشاء SQLite backup باستخدام آلية backup متوافقة مع WAL، وليس نسخ الملف الرئيسي وحده أثناء الكتابة.
- تسجيل schema version وحجم/وقت النسخة دون تسجيل بيانات العملاء.
- التأكد من مساحة التخزين.

### قواعد migrations

- migrations الخاصة بالطبقة الجديدة opt-in في أول إصدار.
- جداول جديدة بأسماء مميزة مثل `control_configuration_values`, `control_configuration_revisions`, `control_active_revision`, `control_managed_secrets`, `control_configuration_audit_log`, و`control_schema_migrations`.
- لا `DROP`, `RENAME`, أو تعديل destructive للجداول الحالية في مراحل التوافق.
- لا إضافة `NOT NULL` إلى جدول حالي دون default/backfill وخطة منفصلة.
- migration transaction واحدة بقدر ما تسمح SQLite.
- فشل migration ينفذ rollback، يعطل Control Plane، ويسمح للبوت بالاستمرار legacy.
- لا تحذف النسخة الاحتياطية تلقائياً قبل انتهاء فترة تحقق محددة.

### البيانات الحالية

- conversations/orders/blocks/rate tracking/admin prompts تظل في مكانها وبصيغتها الحالية.
- repositories القديمة تستمر كما هي في compatibility release.
- migration إلى نماذج typed أو جداول جديدة تكون لاحقة، منفصلة، قابلة للاستئناف، ومختبرة على snapshots مجهولة الهوية.

## الرجوع إلى النسخة القديمة

لضمان أن rollback حقيقي:

- التغييرات الأولى additive فقط؛ النسخة القديمة تتجاهل الجداول الجديدة.
- لا نحذف متغيرات `.env` القديمة بعد تفعيل managed settings.
- يمكن ضبط `CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false` والعودة فوراً إلى env عند restart.
- إذا رجع المشغل إلى binary قديمة، تستخدم `.env` الحالية ولا تحتاج فهم جداول Control Plane.
- أي schema version جديدة توثق الحد الأدنى للإصدار، لكن أول المراحل تظل backward-readable لأنها لا تمس الجداول القديمة.

## تثبيت التبعيات والبيئة

أمان الكود وحده لا يكفي إذا كان كل `npm install` يجلب شجرة مختلفة. قبل الإصدار:

- اعتماد lockfile متعقب واستخدام `npm ci`.
- تحديد Node versions المدعومة في `engines` وCI.
- تثبيت/توثيق Chromium/Puppeteer المتوافق.
- عدم دمج ترقية dependencies كبرى غير لازمة مع أول compatibility release.
- اختبار Linux environments المستخدمة لدى البائعين، وليس جهاز التطوير فقط.
- توثيق disk permissions لمسارات DB/logs/WhatsApp session.

أي تغيير Node/Puppeteer أو Store/Gemini SDK كبير يصدر في مرحلة منفصلة حتى نعرف سبب أي regression.

## Compatibility test matrix

يجب اختبار الترقية على:

- قاعدة جديدة فارغة.
- نسخة مجهولة الهوية من قاعدة Production صغيرة.
- قاعدة كبيرة مع WAL وعمليات حديثة.
- قاعدة فيها المحادثات والطلبات والحظر والـadmin prompt.
- `.env` بأقل القيم الحالية.
- `.env` بكل القيم الاختيارية الحالية.
- installations مختلفة تحمل قيماً مختلفة لنفس المفتاح، والتأكد أن كل واحدة ترث قيمها هي.
- Linux وNode versions المدعومة.
- WhatsApp session مسجلة وأخرى تحتاج QR.
- Store API متاحة وغير متاحة وقت startup.
- Gemini key صالحة وغير صالحة وفق السلوك الحالي المتوقع.
- PM2 single-process كما يدعم V1، واكتشاف deployment متعددة العمليات كحالة تمنع managed resolution.

## اختبارات الترقية الإلزامية

1. شغل الإصدار القديم وسجل status/behavior baseline.
2. أنشئ backup.
3. حدّث binary/dependencies بالطريقة الموثقة دون إضافة env جديدة.
4. تأكد أن DB hash المنطقي/schema والجداول الحالية لم تتغير في legacy mode.
5. تأكد أن port 3003 غير مفتوح.
6. اختبر استقبال وإرسال رسالة.
7. اختبر catalog search.
8. اختبر checkout والدفع في sandbox فقط.
9. أعد تشغيل العملية وتأكد أن session والمحادثات محفوظة.
10. ارجع إلى الإصدار القديم وتأكد أنه يعمل على نفس DB.

ثم تكرر الاختبارات لكل مرحلة تفعيل مستقلة.

## Shadow comparison

قبل استخدام managed value، يبني النظام candidate snapshot ويقارنه بالlegacy snapshot دون تطبيقه. يعرض الاختلافات في status/audit دون القيم الحساسة. لا يسمح بالتفعيل العام إذا ظهرت فروق غير مقصودة في مفاتيح لم يطلب المشغل تغييرها.

المقارنة تتم عند startup/activation، لا عند كل رسالة، ولا تضيف DB/API calls إلى hot path.

## Canary rollout

لا ينشر Managed Resolution لكل الشركات دفعة واحدة:

1. بيئة داخلية/test.
2. بائع تجريبي مع backup ونافذة مراقبة.
3. مجموعة صغيرة تمثل اختلافات قواعد البيانات والبيئات.
4. rollout تدريجي مع قدرة kill switch.
5. تعميم بعد استقرار error rate والlatency وعدم وجود data corruption أو duplicate orders.

## مؤشرات توقف النشر

يتوقف rollout فوراً إذا ظهر:

- اختلاف غير متوقع في effective legacy values.
- startup failure لم يكن موجوداً.
- migration غير قابلة للrollback.
- تغيير أو فقد بيانات حالية.
- فتح Control API دون تفعيل.
- تسريب secret/PII.
- زيادة message/order failures أو latency فوق الحدود المعتمدة.
- duplicate order/payment.
- فشل downgrade إلى النسخة السابقة.
- تشغيل managed resolution على أكثر من process دون synchronization معتمدة.

## Release gates

لا يعلن الإصدار آمناً إلا إذا:

- اجتاز `no-op upgrade` على كل fixtures.
- اجتاز upgrade ثم downgrade.
- لم يطلب أي env جديدة في legacy mode.
- لم ينفذ writes أو network listeners جديدة في legacy mode.
- migrations additive ومجربة مع backup/restore.
- dependency/runtime matrix خضراء.
- kill switches مجربة فعلياً.
- runbook الترقية والرجوع منشور.
- canary انتهت دون regressions ضمن فترة المراقبة المتفق عليها.
- write API لا تسمح إلا بقائمة V1 المعتمدة، وكلها dynamic ولا تحتاج restart.

## حدود الضمان

لا يمكن إعطاء ضمان مطلق لكل installation غير معروفة قبل رؤيتها؛ قد توجد forks محلية أو Node/Chromium قديمة أو صلاحيات ملفات غير قياسية. لذلك نحتاج preflight command read-only يجمع versions وschema/config presence دون أسرار، ويعطي compatible/warning/blocked قبل التحديث. لكن بالنسبة للنسخ المدعومة من المشروع، `no-op upgrade` والاختبارات السابقة شرط إصدار وليس خياراً.
