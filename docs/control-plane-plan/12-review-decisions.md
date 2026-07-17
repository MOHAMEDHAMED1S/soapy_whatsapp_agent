# قرارات ناتجة عن مراجعة الخطة

هذه الوثيقة تسجل كيف انعكس تقرير [Control-plane-review.md](Control-plane-review.md) على الخطة، حتى لا يعاد فتح النقاش من الصفر أثناء التنفيذ. التقرير رأي مراجعة وليس عقداً تنفيذياً؛ القرارات أدناه هي ما اعتمدته الخطة الحالية.

## اقتراحات اعتمدت

| الملاحظة | القرار المطبق |
| --- | --- |
| النطاق أكبر من حاجة أول إصدار | إنشاء `Control Plane Lite V1` بقائمة صغيرة، وتحويل بقية الميزات إلى roadmap |
| business settings أهم من technical settings | model/key/prompt/limits/catalog البسيط أولاً؛ WhatsApp/DB/ports/PM2/checkout لاحقاً |
| لا نحتاج hot reload لكل شيء | V1 dynamic فقط؛ reconnect/restart settings لا تقبلها API حالياً |
| secret encryption تحتاج threat model | environment provider دائم، encrypted SQLite opt-in، وتوثيق أنها لا تحمي من host compromise كامل |
| مراحل التنفيذ كثيرة إن اعتبرت release واحدة | تنظيمها في Release A للتوافق، Release B لـLite، وRelease C كmilestones مستقلة |
| time-to-market يحتاج workflow أبسط | PUT تنفذ validate-and-activate تلقائياً؛ drafts العامة والapprovals تؤجل |

## اقتراحات اعتمدت جزئياً

### تقليل الـrevisions

ألغينا إلزام المستخدم بدورة `draft -> validate -> activate` في التعديلات البسيطة، لكن لم نلغ تاريخ الخادم. كل PUT ناجحة تنشئ revision وaudit وparent link، والrollback ينشئ revision عكسية. هذا يحقق UX بسيطاً دون جعل dashboard المصدر الوحيد للتاريخ.

### تبسيط إدارة الأسرار

لا نفرض managed secret storage على كل deployment. إذا لم يوجد master key تظل `.env` هي المصدر وتعمل الإعدادات غير السرية، وتصبح secret write capability غير متاحة فقط. أبقينا التخزين المشفر opt-in لأن المطلوب الأصلي يسمح بتغيير API key من API، ولا يمكن قبول plaintext أو إعادته.

### تعدد العمليات

لم نبن synchronization مسبقاً لأن PM2 الحالي process واحدة. في المقابل لم نتجاهل الخطر: V1 تمنع managed resolution في deployment متعددة العمليات، ثم يضاف polling/coordination عند وجود حاجة فعلية.

## اقتراحات لم تعتمد

### جدول key/value بلا Registry

لم يعتمد. model/key/rate limits يمكن أن توقف production بقيمة خاطئة. نستخدم descriptors typed صغيرة لمفاتيح V1 فقط، بدلاً من registry ضخمة أو key/value غير موثقة.

### حفظ التاريخ في الـdashboard فقط

لم يعتمد. قد تتغير أو تتعطل لوحة التحكم، وقد يكتب أكثر من client على API. الـbackend هو authority ويجب أن يملك concurrency وaudit وrollback.

### استبدال الـatomic snapshot بقراءات مباشرة أو restart دائم

لم يعتمد. الـsnapshot تبنى عند startup/activation ولا تضيف lookup لكل رسالة. تبديل model/key/prompt لا يستحق إسقاط جلسة WhatsApp أو downtime، بينما technical settings المؤجلة ستستخدم restart/reconnect عندما تدخل نطاقها.

### دمج Control API داخل Status API

لم يعتمد في V1. الفصل يحافظ على no-op upgrade ويعزل authentication والفشل وQR/status. كلاهما يمكن أن يظل داخل نفس Node process وخلف reverse proxy واحدة، لذلك تكلفة الفصل محدودة ولا تتطلب microservice.

## النتيجة المعمارية

```text
Legacy mode (default)
  current config/factories كما هي

Control Plane Lite (opt-in, single process)
  inherited baseline من قيم المتجر الحالية تلقائياً
  typed V1 registry
  -> validate-and-activate PUT
  -> backend revision/audit
  -> immutable in-memory snapshot
  -> managed -> env -> current default fallback

Extended roadmap
  Store API / WhatsApp / checkout / privacy / multi-instance / approvals
  كل مجال لا يبدأ إلا بعد شروطه واختبار rollback مستقل
```

المعيار الحاكم هو: نبسط نطاق الإصدار الأول وتجربة إدارته، ولا نحذف الضمانات التي تمنع إعداداً خاطئاً أو فشل الطبقة الجديدة من التأثير في مستخدمي production الحاليين.

كما أن كلمة default في الـdashboard تعني القيمة الحالية الموروثة الخاصة بالمتجر، لا constant موحدة تُكتب فوق إعداداته. لا تنشأ managed value إلا عند تعديل صريح.
