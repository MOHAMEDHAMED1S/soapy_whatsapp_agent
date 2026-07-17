# المعمارية وسلسلة fallback

## مكونات V1 فقط

```text
src/control-plane/
├── api/
│   ├── ControlApiServer.ts
│   ├── router.ts
│   ├── middleware/
│   └── controllers/
├── config/
│   ├── ConfigurationService.ts
│   ├── ConfigurationRegistry.ts
│   ├── ConfigurationResolver.ts
│   ├── ConfigurationValidator.ts
│   ├── ConfigurationSnapshot.ts
│   └── defaults.ts
├── secrets/
│   ├── SecretService.ts
│   ├── SecretProvider.ts
│   ├── EnvironmentSecretProvider.ts
│   ├── EncryptedSqliteSecretProvider.ts
│   └── SecretReference.ts
├── storage/
│   ├── SettingsRepository.ts
│   ├── SecretRepository.ts
│   ├── RevisionRepository.ts
│   └── AuditRepository.ts
├── auth/
│   ├── ControlAuthService.ts
│   └── permissions.ts
├── activation/
│   ├── ActivationService.ts
│   └── DynamicSnapshotApplier.ts
└── types/
```

لا يلزم اعتماد هذا الاسم حرفياً، لكن يجب الحفاظ على فصل API عن resolution وعن runtime consumers. لا ننشئ `RestartCoordinator` أو jobs framework أو multi-instance bus في V1 لأن الإعدادات المختارة كلها dynamic.

## نموذج البيانات

### `control_configuration_values`

- `namespace`, `key`
- `value_json`
- `schema_version`
- `revision_id`
- `created_at`

لأن عدد مفاتيح V1 صغير، كل revision نشطة تخزن snapshot كاملة من managed overrides غير السرية/secret references، لا plaintext secrets. ينسخ الخادم القيم غير المتغيرة من parent داخل transaction. هذا يجعل القراءة والrollback واضحين ولا يحتاج السيرفر إلى تتبع chain طويلة لبناء كل startup snapshot.

### `control_configuration_revisions`

يمثل transaction منطقية تشمل مجموعة قيم، مع `active/superseded` وreason وparent revision وactor وvalidation result. الطلب المرفوض يسجل audit event منقحاً ولا ينشئ configuration revision قابلة للتفعيل. تستخدم الواجهة المختصرة revision داخلية حتى دون draft يدوية، ويوجد active revision pointer واحد حتى يكون النشر والrollback ذريين.

### `control_active_revision`

صف singleton صغير يشير إلى revision الفعالة. تحديثه وقيم revision والـaudit يتم في SQLite transaction واحدة. لا يعد أي row مكتوباً effective ما لم يشر إليه هذا الصف وتنجح عملية نشر الـsnapshot.

### `control_managed_secrets`

- secret ID وpurpose
- ciphertext وencryption version
- fingerprint غير عكسي
- timestamps وحالة validation
- لا يُخزن plaintext ولا يظهر في API.

### `control_configuration_audit_log`

append-only لتغييرات الإعدادات وعمليات activation/rollback، دون محتوى secrets أو PII.

هذا هو الحد الأدنى لـV1، وليس نظام إدارة إعدادات عاماً. يمكن إضافة draft tables أو approval metadata لاحقاً دون تغيير عقود القيم الفعالة.

## بدء التشغيل

1. يقرأ BootstrapConfig القيم الضرورية من `.env` قبل تحميل وحدات Control Plane.
2. إذا كانت flags غائبة أو مغلقة، يبدأ مسار Legacy الحالي ولا تفتح repositories الجديدة ولا تنفذ migrations.
3. عند تفعيل Control Plane صراحة، تنفذ migration opt-in بعد backup وفحص DB.
4. يبني `LegacyBaselineSnapshot` من `.env` وlegacy DB resources والconstants الحالية الخاصة بهذه installation.
5. يحاول `ConfigurationService` قراءة آخر revision active فقط عندما يكون managed resolution مفعلاً.
6. يتحقق من schema والتشفير؛ المفاتيح الفاشلة تُسقط منفردة إلى inherited baseline ولا تُسقط الخدمة.
7. يبني Effective Snapshot موحداً مع `value`, `source`, `inheritedSource`, `revision`, و`health` لكل مفتاح.
8. تبدأ الخدمات المحولة باستخدام snapshot، وتظل الخدمات خارج V1 على factories/config الحالية.
9. يبدأ Control API بعد نجاح bootstrap، لكن فشله لا يوقف WhatsApp أو Status API.

## Resolution algorithm

لكل descriptor:

```typescript
interface SettingDescriptor<T> {
  key: string;
  namespace: string;
  applyMode: 'dynamic' | 'reconnect' | 'restart' | 'bootstrap';
  release: 'v1' | 'later';
  sensitivity: 'public' | 'internal' | 'secret';
  managed?: () => T | undefined;
  legacyResolver: () => LegacyResolution<T>;
  validate(value: unknown): ValidationResult<T>;
}
```

يسجل Registry أوصاف الإعدادات المستقبلية للتخطيط فقط إذا لم تُعرض كقابلة للكتابة. Runtime V1 لا يحل إلا descriptors ذات `release='v1'`.

الخوارزمية:

1. ابنِ inherited value من نفس precedence القديمة للمتجر: env ثم legacy DB resource عند انطباقها ثم built-in constant.
2. جرّب active managed override إن وجدت.
3. ارفض override إذا فشل parsing أو validation، وسجل health event دون طباعة القيمة.
4. استخدم inherited value تلقائياً.
5. أعد unavailable typed result إذا لم يوجد managed أو legacy source صالح.

لا نستخدم `||` للقيم الرقمية لأن الصفر قد يكون قيمة مقصودة. نستخدم parsing صريحاً وحدوداً واضحة.

`LegacyBaselineSnapshot` object داخل الذاكرة وليس import تلقائياً إلى managed tables. يعاد بناؤه عند startup، ولذلك تغيير `.env` يظل يعمل كما كان بعد restart لأي مفتاح لا يملك override. عند activation يعاد استخدام baseline الحالية لبناء candidate كاملة.

## Runtime snapshot

الـsnapshot immutable ويحمل رقم revision. عند activation:

1. يبنى snapshot مرشح بالكامل.
2. تشغل validators واختبارات الاتصال.
3. تستدعى dynamic appliers البسيطة في dry-run.
4. تحفظ revision وتفعل transactionally.
5. يستبدل pointer واحد للـsnapshot.
6. تنشر أحداث typed محدودة لإعادة بناء AI client أو إعادة جدولة catalog timer عند الحاجة.

الطلبات التي بدأت قبل الاستبدال تكمل بالـsnapshot القديم؛ الطلبات الجديدة ترى الجديد.

## fallback أثناء runtime

هناك فرق بين configuration failure وruntime failure:

- Configuration failure: managed value غير قابلة للقراءة؛ نستخدم env/default فوراً.
- Runtime failure في V1: القيمة صحيحة شكلياً لكن Gemini يفشل. نطبق retry محدوداً، ثم fallback model وenv key إن كان آمناً، ونعرض المصدر managed كـdegraded.
- Store API وWhatsApp runtime policies تدخل هنا فقط عند تنفيذ مراحلها اللاحقة.

لا ينبغي تغيير مصدر الإعداد عالمياً بسبب خطأ واحد عابر. يستخدم V1 threshold وcooldown ثابتين في الكود لمنع إعادة تجربة key فاشلة مع كل رسالة، ولا يعرضهما settings قابلة للتعديل.

## last-known-good

نحتفظ بآخر revision نجحت في:

- validation المحلي.
- connectivity validation عند الحاجة.
- activation.

في V1 لا يغير runtime active revision تلقائياً. إذا تجاوز managed AI key failure threshold يتجاوزها مؤقتاً إلى env key ويظهر health degraded؛ ينفذ المشغل rollback صريحة بعد التحقيق. التراجع التلقائي إلى revision سابقة يمكن إضافته لاحقاً إذا أثبتت المراقبة أنه أكثر أماناً من env fallback.

## إعدادات restart بعد V1

لا تقبل V1 كتابة إعدادات restart أو reconnect. تظل في `.env` والكود، ولذلك لا توجد حالة `pending_restart` ولا endpoint تعيد تشغيل العملية. عندما يدخل هذا النطاق في إصدار لاحق يجب أن يظهر الفرق بين configured وeffective وتضاف عملية drain/restart/verification منفصلة.

## الأسرار كمزود قابل للتبديل

الـresolver لا يعتمد مباشرة على جدول الأسرار. يطلب secret من واجهة `SecretProvider`:

```text
managed reference صالح وقابل للفك
-> GEMINI_API_KEY من EnvironmentSecretProvider
-> unavailable typed result
```

`EncryptedSqliteSecretProvider` قدرة opt-in؛ غياب master key يعطل الكتابة والقراءة منه فقط. التشفير يحمي DB/backup المسربة ولا يعد دفاعاً ضد اختراق كامل للخادم. لا ننفذ secret manager خارجياً في V1، لكن الواجهة تمنع ربط runtime بbackend واحدة.

## فشل قاعدة بيانات الإعدادات

بما أن الإعدادات ستستخدم نفس SQLite مبدئياً عند التفعيل الصريح:

- فشل فتح DB الحالية يعني أن المحادثات أيضاً غير متاحة؛ هذا failure قائم أصلاً ويعالج كـstartup failure.
- فشل جداول control-plane وحدها بسبب migration لا يجب أن يمنع استخدام الجداول الحالية؛ migrations تكون transactional ويحتفظ bootstrap بمسار legacy config.
- يمكن لاحقاً فصل control DB إذا ظهرت حاجة تشغيلية، لكن ليس في أول إصدار.
