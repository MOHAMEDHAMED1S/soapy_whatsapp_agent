# المبادئ والنطاق

## 1. التوافق الخلفي أولاً

أي إعداد مُدار جديد هو طبقة اختيارية. غياب الجداول الجديدة، عدم وجود قيمة مفعلة، فشل فك التشفير، أو توقف Control API لا يجب أن يمنع المسار الحالي من العمل.

الترتيب العام:

```text
قيمة managed مفعلة وصالحة
    ثم قيمة .env الحالية
    ثم built-in default الحالي
```

الاستثناء هو القيم المطلوبة التي لا يوجد لها default آمن، مثل Gemini API key. في هذه الحالة يكون الترتيب `managed secret -> GEMINI_API_KEY -> unavailable`، وتظهر حالة degraded واضحة بدلاً من crash غامض.

`last-known-good` ليست طبقة resolution غامضة تسبق `.env` لكل مفتاح. الـsnapshot الحالية تستمر إذا تعطلت Control API، والموارد التي لها state مثل catalog تحتفظ بآخر نسخة منشورة، بينما الرجوع إلى إعدادات سابقة يتم بrevision rollback واضحة. لكل ميزة runtime fallback موثقة منفصلة.

## 2. لا HTTP في hot path

لا يستدعي `MessageHandler` أو `GeminiService` Control API للحصول على إعداد. الواجهة تحدث مخزناً محلياً، و`ConfigurationService` ينشر snapshot immutable داخل العملية. بذلك:

- لا تتأثر الرسائل بتوقف لوحة التحكم.
- لا نضيف latency جديداً لكل رسالة.
- لا تحدث آلاف قراءات قاعدة البيانات لنفس القيمة.
- يمكن اختبار الإعدادات بعيداً عن WhatsApp.

## 2.1 القيم الحالية هي baseline تلقائية لكل متجر

لا نستخدم مجموعة defaults موحدة تتجاهل إعدادات installation. لكل descriptor داخل V1 يوجد `legacyResolver` يقرأ نفس المصدر الذي يستخدمه المشروع قبل Control Plane: `.env`، أو legacy DB resource عند وجودها، ثم constant الحالية.

- عند التحديث فقط يستمر المسار القديم نفسه بلا أي write.
- عند تشغيل read-only API تظهر القيم الحالية تلقائياً كـ`effective/inherited` حتى لو لم توجد managed rows.
- لا تصبح القيمة الموروثة managed لمجرد عرضها.
- أول تعديل يخزن override للمفتاح المتغير فقط؛ لا يعمل bulk import لبقية القيم.
- reset يحذف override ويعيد المفتاح إلى legacy resolver الخاصة بنفس المتجر.
- secret موروثة لا تنسخ أو تعرض؛ يعرض source/configured/fingerprint منقح فقط.

بهذا تعني كلمة “default” في تجربة المتجر “القيمة التي يعمل بها هذا المتجر الآن”، بينما `built-in default` هي آخر fallback فقط عند غياب إعداد المتجر.

## 3. التحقق قبل التفعيل

كل تعديل يحتاج validation قبل أن يغير runtime. في V1 تنفذ الواجهة المختصرة ذلك آلياً:

```text
request -> validating -> active revision
                    \-> rejected بلا تغيير
```

الـdrafts اليدوية تبقى امتداداً لاحقاً للـbatch والتغييرات الحساسة، ولا تكون عبئاً على تعديل model أو prompt بسيط. في الحالتين يحتفظ الـbackend بالrevision والـaudit والrollback.

القيم البسيطة تتحقق محلياً. القيم التي تمثل اتصالاً خارجياً، مثل Gemini key أو Store API URL، تمر باختبار اتصال محدود وآمن قبل activation. فشل الاختبار لا يغير الـsnapshot الحالي.

## 4. Atomic snapshots

التحديث الذي يشمل أكثر من قيمة، مثل `primaryModel + apiKeyRef + fallbackModel`، ينشر كوحدة واحدة بعد نجاح جميع عمليات التحقق. لا يرى أي request نصف الإعداد القديم ونصف الجديد.

## 5. لا تصبح الكتابة فعالة قبل validation

القيمة المكتوبة لا تصبح active ولا مرجع rollback إلا بعد نجاح activation. وإذا ظهرت مشكلة runtime متكررة بعد التفعيل يستخدم V1 health state ثابتة وفallback الميزة، مثل env key أو catalog منشورة، دون تغيير active revision تلقائياً. rollback الصريحة تبقى متاحة ومُدققة.

## 6. الأسرار write-only

- `POST/PUT` يقبل secret عبر TLS.
- `GET` لا يعيد secret أبداً، بل metadata مثل `configured`, `source`, `lastValidatedAt`, وmasked fingerprint.
- لا تدخل الأسرار في audit payload أو logs أو error messages.
- التخزين يكون مشفراً، ومفتاح التشفير bootstrap secret من البيئة أو secret manager خارجي مستقبلاً.

## 7. Guardrails غير قابلة للتعطيل بسهولة

نقسم الـprompt إلى:

- Core guardrails يملكها الكود: الصلاحيات، منع الطلب الوهمي، وجوب التأكيد، حدود الأدوات ذات الأثر الجانبي.
- Business prompt قابل للإدارة: النبرة، رسالة الترحيب، سياسات المتجر، والتعليمات التجارية.

Control API لا يسمح باستبدال core guardrails في الإصدار الأول.

## 8. أقل صلاحية

قراءة الحالة، تعديل الإعدادات، إدارة الأسرار، إدارة الحظر، وتنفيذ operations مثل refresh/restart لها scopes مستقلة. لا يكفي أن يكون المستخدم “admin” عاماً لكل شيء.

## 9. كل تغيير قابل للتدقيق والرجوع

نسجل: من غيّر، ما المفاتيح التي تغيرت، السبب، الوقت، نتيجة validation، revision السابق والجديد، ونتيجة activation. لا نسجل القيم السرية.

## 10. تصنيف الإعدادات حسب وقت التطبيق

### Dynamic

تطبق فوراً على الطلبات الجديدة، مثل model، generation parameters، limits، prompt التجاري، rate limits، وفترات الكاش.

### Reconnect required

تحتاج إعادة إنشاء WhatsApp client، مثل Puppeteer executable path أو auth data path. لا تطبق وسط معالجة الرسائل.

### Process restart required

تحتاج إعادة تشغيل آمنة للعملية، مثل database path أو bind host/port.

### Bootstrap-only

يجب أن تبقى خارج Control API لأنها مطلوبة قبل تشغيله، مثل مفتاح تشفير الأسرار ومعلومات أول اعتماد للواجهة.

V1 لا يدير إلا إعدادات `Dynamic`. التصنيفات الأخرى موثقة للـroadmap ولا تستلزم بناء reconnect/restart machinery الآن.

## 11. النطاق الوظيفي

يشمل V1 فقط AI model/key وبعض generation settings، business prompts، مجموعة محدودة من rate limits والحظر، وإعدادات كتالوج بسيطة. النطاق الدقيق في [Control Plane Lite V1](11-control-plane-lite-v1.md).

يشمل التخطيط طويل المدى: Store API، WhatsApp، الرسائل والوسائط، الطلبات، الدفع، admins، status/metrics، logging، والخصوصية. وجودها في الخطة لا يضعها ضمن أول milestone.

لا يشمل الآن بناء dashboard أو تغيير API المتجر الخارجي أو إعادة كتابة bot framework.

## 12. البساطة لا تلغي ضمانات الإنتاج

نقلل عدد الإعدادات والمكونات في V1، لكن لا نحذف typed validation أو atomic activation أو backend audit/rollback أو fallback. جدول key/value غير typed أو تاريخ محفوظ في dashboard فقط غير مقبول لتطبيقات production متعددة.
