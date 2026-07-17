# مراحل التنفيذ والترحيل

## قاعدة عامة

الخطة تنفذ في ثلاثة releases عملية، لا عشر مراحل يفترض إنجازها معاً. كل release له قيمة مستقلة وقرار Go/No-Go. لا يبدأ release تالٍ لأن السابق انتهى زمنياً؛ يبدأ فقط بعد اجتياز معايير الخروج ومراقبته على canary.

المرجع الملزم لما يدخل الإصدار الأول هو [Control Plane Lite V1](11-control-plane-lite-v1.md). ملفات Store API وWhatsApp وcheckout وغيرها roadmap تفصيلية، وليست backlog إلزامية لـV1.

## أعمال مسبقة لا تخص Control Plane

هذه مخاطر موجودة في المشروع ويجب علاج ما يلامس نطاق V1 منها قبل تفعيل الكتابة:

1. إلغاء أي مفتاح مكشوف في ملفات المشروع وتنظيفه من التاريخ إن وجد.
2. تثبيت baseline Git وتشغيل build/smoke موثق.
3. إضافة test harness وfixtures لسلوك `.env` والdefaults الحالية.
4. إصلاح authorization لعمليات `block_number` و`unblock_number` قبل عرضها في API.
5. إصلاح واختبار منطق rate limiter قبل جعل حدوده ديناميكية.
6. إضافة single-flight وحماية last-known-good قبل إتاحة catalog refresh.

إصلاح queue/idempotency الشامل مهم للمشروع، لكنه لا يحجب model/key/prompt V1 ما دام لا نجعل queue أو checkout قابلة للإدارة.

## Release A: Compatibility Foundation

### النطاق

1. إضافة flags مع defaults مغلقة وlegacy branch عند composition root.
2. lazy-load لوحدات Control Plane لمنع أي side effects في Legacy mode.
3. typed Registry لمفاتيح V1 فقط؛ المفاتيح المستقبلية metadata غير writable أو لا تسجل في runtime بعد.
4. `legacyResolver` لكل مفتاح يعيد نفس قيمة installation الحالية من env/legacy DB/built-in، مع source metadata.
5. `LegacyBaselineSnapshot` تظهر قيم المتجر تلقائياً دون seed أو managed writes.
6. immutable snapshot لمستهلكي V1 في shadow mode فقط.
7. migrations opt-in وأسماء جداول مستقلة، مع backup وrollback.
8. اختبارات no-op upgrade من نسخة DB حالية.

### ما لا يوجد في هذا الإصدار

- لا Control API مفتوحة افتراضياً.
- لا writes أو secret storage.
- لا managed resolution في runtime.
- لا تغيير لمصانع Gemini/WhatsApp/Store API الحالية في legacy branch.

### معيار الخروج

- غياب flags ينتج نفس startup، ports، DB schema، timers، network calls، وeffective config الحالية.
- baseline المحسوبة لكل fixture تطابق القيم التي كان الإصدار القديم يستخدمها، بما فيها legacy DB prompt إن وجدت.
- `CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false` يتجاوز resolver/storage فعلياً.
- فشل migration التجريبية يعطل Control Plane فقط ويترك البوت legacy.
- قياس startup/latency/memory لا يظهر regression غير مفسر.

## Release B: Control Plane Lite

### B1: Read-only وshadow

1. Control API مستقلة على localhost مع bootstrap token وrequest IDs وredaction.
2. schema/effective/status endpoints لمفاتيح V1.
3. repositories للتاريخ والـaudit.
4. shadow candidate يقارن managed candidate بالlegacy دون أن يستهلكه runtime.
5. OpenAPI وأمثلة read-only.

عند هذه النقطة يجب أن تعرض API تلقائياً قيم كل متجر الحالية ومصادرها رغم عدم وجود أي managed revision.

يبدأ المشغل migrations والواجهة صراحة. تظل writes وactivation وmanaged resolution مغلقة. يمكن تجربة validate-only دون فتح write routes.

### B2: كتابة غير سرية مبسطة

1. `PUT /settings/{namespace}/{key}` و`PUT /settings/{namespace}`، ولا يعملا إلا عند فتح writes وactivation معاً.
2. validate-and-activate داخل transaction واحدة.
3. optimistic concurrency وidempotency.
4. history وrollback من الـbackend.
5. atomic snapshot swap.
6. pilot بالـbusiness prompt أو قيمة generation منخفضة المخاطر.

لا نبني draft UI عامة. كل `PUT` تنشئ revision داخلية، وvalidate-only متاح للpreview.

### B3: AI secret اختياري

1. `SecretProvider` interface وenvironment provider read-only.
2. encrypted SQLite provider opt-in باستخدام Node crypto ومفتاح bootstrap.
3. write-only secret API وfingerprint/rotation/history دون plaintext.
4. model/key connectivity validation بلا tools.
5. AI client swap ذري، مع fallback إلى `GEMINI_API_KEY` وmodels الحالية.
6. drill لفقد master key وفشل decrypt وrollback إلى env.

عدم وجود master key لا يمنع B1/B2 أو تشغيل Gemini من `.env`؛ يمنع secret writes فقط.

### B4: limits والحظر والكتالوج المحدود

لا تبدأ إلا بعد الشروط المسبقة الخاصة بكل مكون:

- rate limits الثلاثة بعد إصلاح sliding-window واختبارات الساعة الوهمية.
- block CRUD بعد service-level authorization وnormalization.
- catalog interval/limits وmanual refresh بعد single-flight وlast-known-good publish rules.

يمكن إصدار B4 بعد B2/B3 بفترة؛ ليس مطلوباً جمع كل V1 في deploy واحدة.

### معيار خروج Release B

- model/key/prompt/limit valid changes تظهر للطلبات الجديدة فقط وبلا mixed snapshot.
- invalid/connectivity-failed changes لا تمس active revision.
- rollback ينشئ revision جديدة ويعيد السلوك السابق.
- توقف API أو فشل secret DB لا يوقف الرسائل ويستخدم env/default.
- لا secrets في response/log/audit/error.
- canary production ينجح ثم توسع تدريجي، namespace واحدة في كل مرة.

## Release C: Extended Control Plane

هذا release مجموعة milestones مستقلة، وترتيبها يعتمد على business value:

1. Store API وcatalog advanced profile بعد client factory وcontract tests.
2. messaging/queue/media بعد queue manager/cancellation/backpressure.
3. WhatsApp runtime بعد reconnect/drain coordinator، مع بقاء paths/ports bootstrap أولاً.
4. checkout/payment بعد deterministic state machine وidempotency/reconciliation.
5. managed admins/OIDC بعد نموذج هوية وصلاحيات معتمد.
6. privacy/retention بعد قرارات قانونية وdry-run cleanup.
7. restart jobs وtechnical settings فقط عند وجود حاجة تشغيلية مثبتة.
8. multi-instance synchronization قبل السماح بالmanaged resolution على أكثر من process.
9. drafts/approval workflow للتغييرات التي تستفيد فعلاً من المراجعة المسبقة.

كل milestone لها feature flag واختبارات rollback مستقلة؛ لا يوجد موعد واحد يجمع Release C كلها.

## استراتيجية تحويل كل setting

لكل قيمة ضمن release معتمدة:

1. Characterization test للسلوك الحالي.
2. Descriptor typed يعيد legacy value.
3. تحويل consumer محدد إلى getter/snapshot خلف namespace flag.
4. اختبار legacy bypass، لا resolver fallback فقط.
5. إضافة managed source وهي غير مفعلة.
6. اختبار managed valid/invalid/missing.
7. shadow comparison ثم canary.
8. تفعيل managed resolution تدريجياً مع kill switch.
9. إبقاء env/default في resolver حتى بعد نجاح الترحيل.

لا تنشئ managed override لمجرد أن القيمة ظهرت في dashboard؛ الكتابة تحدث فقط بطلب صريح وقيمة مختلفة.

## Feature flags الضرورية

- `CONTROL_PLANE_ENABLED`: يشغل storage/API عند opt-in.
- `CONTROL_PLANE_WRITES_ENABLED`: يسمح بالكتابة غير السرية والسرية حسب capabilities.
- `CONTROL_PLANE_ACTIVATION_ENABLED`: يسمح بتغيير active revision.
- `CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED`: يسمح للخدمات باستهلاك managed values.
- flags مؤقتة لكل namespace أثناء الترحيل، مثل `CONTROL_PLANE_AI_ENABLED`.

إذا كانت flags غائبة يكون المسار legacy. لا تستخدم flag واحدة لتجاوز مراحل read-only/write/activation/runtime consumption كلها.

## قرار منع التوسع

أي setting جديدة لا تدخل V1 لمجرد أنها سهلة الإضافة إلى Registry. يلزم قبل إدخالها:

- use case من الـdashboard أو التشغيل.
- owner وحدود typed وfallback واضح.
- apply semantics واختبارات فشل.
- تقدير أثرها على production والـrollback.
- وضعها داخل milestone معتمدة بدلاً من توسيع V1 بصمت.
