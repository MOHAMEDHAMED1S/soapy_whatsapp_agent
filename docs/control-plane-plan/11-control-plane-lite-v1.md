# نطاق Control Plane Lite للإصدار الأول

## القرار

الإصدار الأول ليس محاولة لتحويل كل ثابت في المشروع إلى setting. هدفه إثبات طبقة التحكم على مجموعة صغيرة عالية القيمة ومنخفضة المخاطر، مع الاحتفاظ بضمانات production: typed validation، تفعيل ذري، سجل backend، rollback، fallback، وlegacy bypass.

كل ما لا يرد صراحة في نطاق V1 أدناه يظل في `.env` أو الكود الحالي، وتظل وثيقته خطة مستقبلية لا التزاماً في الإصدار الأول.

## التهيئة التلقائية لكل متجر

لا يطلب V1 من أي متجر إعادة إدخال إعداداته الحالية. عند أول تشغيل يبني `Inherited Legacy Baseline` من نفس المصادر القديمة الخاصة بهذه installation ويعرضها في API:

- environment variables الموجودة حالياً.
- legacy DB values مثل business/admin prompt عندما تكون هي المصدر الحالي.
- built-in constants الحالية عند غياب الاثنين.

لا يحتاج ذلك seed request ولا managed rows. القيمة تصبح managed فقط عندما يرسل المشغل تعديلًا صريحاً. القيم غير المعدلة تظل inherited، وreset يعيدها إلى المصدر القديم الحالي. الأسرار تعرض metadata فقط وتظل في `.env` ما لم يختَر المشغل تخزين secret جديدة عبر provider مهيأ.

## ما يدخل V1

### AI والمفاتيح

- `ai.primary_model` و`ai.fallback_model`.
- `ai.api_key_ref` لمفتاح Gemini واحد مُدار، مع `GEMINI_API_KEY` كـfallback دائم.
- مجموعة صغيرة من generation settings بعد تثبيت حدودها: `temperature`, `top_p`, `top_k`, و`max_output_tokens`.
- `GET /ai/status` وvalidation محدود للموديل/المفتاح دون tools أو side effects.

لا يشمل V1 إضافة providers متعددة أو canary traffic أو circuit-breaker قابل للضبط من الـAPI. يظل Gemini هو provider الوحيد، وتظل سياسات fallback التشغيلية الحالية أو الآمنة في الكود.

### سلوك المساعد التجاري

- `assistant.business_prompt`.
- `assistant.display_name`, `assistant.tone`, و`assistant.language` عندما لا تغير guardrails.
- رسائل الترحيب والخطأ والمساعدة القابلة للتخصيص.
- preview وvalidation للحجم والمتغيرات المسموحة.

تبقى core guardrails، صلاحيات الأدوات، تأكيد الطلب، وcatalog/order context مولدة من الكود وغير قابلة للاستبدال.

### الحدود والحظر

- `rate_limit.max_per_minute`, `rate_limit.max_per_window`, و`rate_limit.window_minutes` بعد إصلاح واختبار منطق الـlimiter الحالي.
- قراءة قائمة الحظر وإضافة/إزالة الحظر عبر service authorization مركزي.
- حدود code-owned تمنع تعطيل الحماية أو حظر جميع العملاء بقيمة خاطئة.

لا تصبح queue/media/retry internals قابلة للإدارة في V1.

### كتالوج المنتجات: إعدادات بسيطة فقط

- `catalog.refresh_interval_ms`.
- `catalog.prompt_product_limit`.
- `catalog.display_limit`.
- `GET /catalog/status` و`POST /catalog/refresh` بعد إضافة single-flight ومنع نشر نتيجة فارغة/جزئية.

لا يشمل V1 تغيير Store API base URL أو pagination policy أو stale-cache policy من الـAPI.

## ما يؤجل بعد V1

- Store API connection profile وtimeouts/retries/auth.
- WhatsApp/Puppeteer/session paths/reconnect internals.
- database paths، ports، PM2، restart/reconnect coordinator، وruntime infrastructure settings.
- checkout، payment، countries، order retries، وسياسات الخصم.
- managed admins وOIDC.
- retention/cleanup/encryption profiles.
- provider-agnostic AI، advanced circuit breakers، background jobs العامة، وmulti-instance synchronization.

هذه المجالات تبقى موثقة لأنها roadmap، لكن لا تنفذ قبل استيفاء شروطها السابقة واعتماد business decisions الخاصة بها.

## دورة الكتابة المبسطة

لا يحتاج تعديل V1 العادي إلى أن يدير المستخدم draft يدوياً. الواجهة المختصرة:

```text
PUT setting/namespace
-> parse + typed validation
-> connectivity check عند الحاجة
-> SQLite transaction تحفظ revision وaudit
-> atomic snapshot swap
-> success أو رفض بلا تغيير runtime
```

يدعم الطلب `reason` و`expectedRevision`، وتعيد المعارضة `409`. كل كتابة ناجحة تنشئ revision في الـbackend، ولذلك يمكن عرض التاريخ والرجوع حتى إن لم تعرض الـdashboard مفهوم drafts.

تظل batch drafts والمراجعة المنفصلة وtwo-person approval امتداداً لاحقاً للإعدادات عالية المخاطر، وليست شرطاً لاستخدام V1.

## الحد الأدنى للتاريخ والـrollback

يجب أن يحتفظ الـbackend، وليس الـdashboard فقط، بـ:

- active revision ورقمها.
- parent revision.
- أسماء المفاتيح المتغيرة والقيم القديمة/الجديدة غير السرية.
- secret references وfingerprints فقط، دون plaintext.
- actor، reason، الوقت، ونتيجة validation/activation.
- عملية rollback تنشئ revision جديدة؛ لا تعيد كتابة التاريخ أو تحذفه.

## استراتيجية الأسرار

يقدم runtime واجهة `SecretProvider` بترتيب واضح:

1. `EnvironmentSecretProvider`: read-only ومتاح دائماً لـ`GEMINI_API_KEY`.
2. `EncryptedSqliteSecretProvider`: اختياري ولا يعمل إلا عند وجود `CONTROL_SECRETS_MASTER_KEY` صالح.
3. Secret manager خارجي: امتداد لاحق يستخدم الواجهة نفسها.

إذا لم يضبط المشغل master key:

- يستمر Gemini باستخدام `.env`.
- تعمل الإعدادات غير السرية.
- ترفض secret writes برسالة capability واضحة، ولا يحدث startup error.

يستخدم التخزين الاختياري primitives القياسية في Node (`AES-256-GCM`) مع versioned key ID وnonce عشوائي وauthentication tag. هذا يحمي نسخة DB أو backup المسربة، لكنه لا يدّعي الحماية من اختراق كامل للخادم الذي يملك master key. يجب توثيق backup وrotation وفقد المفتاح واختبارها قبل تفعيل secret writes.

## التطبيق أثناء التشغيل

- إعدادات V1 كلها `dynamic` ولا تحتاج restart.
- يبنى immutable candidate snapshot مرة واحدة عند startup أو activation، وليس عند كل رسالة.
- activation تستبدل reference واحدة بعد نجاح validation والحفظ.
- الطلب الجاري يكمل بالـsnapshot التي بدأ بها؛ الطلب التالي يرى الجديدة.
- فشل Control API بعد activation لا يؤثر في الـsnapshot الحالية.

إعدادات reconnect/restart لا تدخل V1، ولذلك لا نبني `RestartCoordinator` ضمن الإصدار الأول.

## حدود النشر

- V1 يدعم process واحدة فقط، وهو مطابق لإعداد PM2 الحالي.
- إذا كان deployment يشغل أكثر من process، يبقى `CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false` حتى إضافة revision synchronization مجربة.
- Control API يظل server محلياً مستقلاً ومغلقاً افتراضياً. يمكن تقديمه وStatus API خلف reverse proxy واحدة، لكن لا يشتركان في token أو middleware.

## معايير خروج V1

- no-op upgrade مثبت من قاعدة Production منسوخة، مع flags غائبة ومغلقة.
- read-only API تعرض القيم الحالية المختلفة لكل متجر تلقائياً مع source صحيح، دون managed seeding.
- لا migrations أو port أو imports ذات side effects في legacy mode.
- fallback لكل setting في V1 مختبر: managed ثم env حيث يوجد ثم default الحالي.
- تعديل model/key/prompt/limit ذري وقابل للrollback.
- فشل secret storage أو Control API يعيد الخدمة إلى `.env` دون crash.
- لا secret في responses أو logs أو audit أو crash output المسموح.
- لا زيادة ذات دلالة في message latency لأن runtime يقرأ snapshot داخل الذاكرة.
