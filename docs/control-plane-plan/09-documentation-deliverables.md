# مخرجات التوثيق المطلوبة أثناء التنفيذ

هذه الخطة لا تكفي وحدها بعد كتابة الكود. كل مرحلة تنفيذ يجب أن تحدث وثائق تشغيلية قابلة للاستخدام بواسطة backend وdashboard وعمليات النشر.

## 1. OpenAPI

ينشأ ملف versioned مثل:

```text
docs/control-api/openapi.v1.yaml
```

ويشمل:

- جميع المسارات وscopes.
- request/response schemas.
- error codes وHTTP statuses.
- pagination/idempotency/ETag headers.
- أمثلة لا تحتوي secrets أو PII.
- وصف configured/effective/source/applyMode.

يجب أن يمر الملف بـlint وcontract tests في CI.

OpenAPI V1 لا تعرض routes مؤجلة على أنها قابلة للاستخدام. يمكن ذكر roadmap في prose فقط؛ generated clients يجب أن ترى العقود المنفذة فعلاً.

## 2. Configuration reference

مرجع مولد من Registry يوضح لكل setting:

- key/type/default/env fallback.
- legacy sources وكيف تظهر القيمة كـinherited قبل أول managed revision.
- الحدود والوحدات.
- dynamic/reconnect/restart/bootstrap.
- dependencies.
- sensitivity والscope المطلوبة.
- introduced/deprecated version.

الـRegistry هو source of truth، ولا نكرر defaults يدوياً في ملفات قد تنحرف عن الكود.

## 3. دليل التشغيل

- bootstrap `.env` آمن.
- تشغيل Control API محلياً وخلف reverse proxy.
- health/readiness وماذا يعني degraded.
- backup/restore للجداول الجديدة.
- migration وdowngrade.
- PM2/Chromium/runtime prerequisites.

## 4. دليل الأسرار

- إنشاء master key وتخزينه.
- إضافة Gemini/Store API secret دون طباعتها.
- rotation والتحقق والتفعيل والrollback.
- ماذا يحدث عند فقد master key.
- emergency fallback إلى env.
- خطوات إلغاء secret مكشوفة.
- threat model صريح: encrypted SQLite تحمي DB/backups المسربة ولا تحمي من host compromise كامل.
- الفرق بين environment provider المتاح دائماً وmanaged provider الاختياري، ورسالة capability عند غياب master key.

## 5. Runbooks

ملف مستقل لكل حادث متوقع:

- managed AI key تفشل.
- model غير متاحة.
- Store API circuit مفتوحة.
- configuration DB/migration failure.
- Control API لا تبدأ.
- pending restart لا يصبح effective.
- revision سيئة وrollback.
- duplicate/unknown order reconciliation.

## 6. Dashboard integration guide

- authentication/scopes.
- validate-and-activate PUT في V1، وvalidate-only للpreview.
- revision history/rollback دون افتراض وجود draft workflow عامة.
- secret fields write-only.
- عرض source/fallback/degraded.
- عدم إرسال write تلقائية لقيمة inherited لمجرد فتح صفحة الإعدادات.
- ETag conflicts.
- async jobs وpolling/SSE إن أضيف.
- pending restart indicators.
- عدم افتراض أن HTTP 202 يعني أن operation مستقبلية أصبحت effective؛ writes الديناميكية V1 تعيد success فقط بعد activation.

## 7. Change management

- changelog لعقود API وRegistry.
- deprecation policy وإصدارين على الأقل قبل الحذف عند الإمكان.
- migration notes لكل revision schema.
- compatibility matrix بين dashboard وControl API.

## 8. أمثلة واختبارات قابلة للتشغيل

- مجموعة curl آمنة.
- environment example بلا قيم حقيقية.
- collection اختيارية لأداة API دون secrets محفوظة.
- smoke script read-only.
- سيناريو كامل validate-only -> PUT -> observe -> rollback باستخدام قيم وهمية.

## Definition of done للتوثيق

لا تعتبر الميزة مكتملة إذا:

- endpoint غير موجودة في OpenAPI.
- setting لا تظهر في configuration reference.
- fallback غير موثقة ومختبرة.
- operation خطرة بلا runbook rollback.
- dashboard لا تستطيع التمييز بين configured وeffective.
- مثال التوثيق يحتاج secret حقيقية أو قد ينشئ order/payment فعلياً.
- وثائق V1 تخلط routes المخطط لها لاحقاً مع routes المنفذة فعلاً.
