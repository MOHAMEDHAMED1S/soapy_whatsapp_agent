# حدود المعمارية والملفات

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17

## قاعدة الاتجاه

الـdomain/runtime consumers لا تعتمد على HTTP controllers أو SQLite rows مباشرة. الاتجاه المقصود:

```text
entrypoint/composition root
    -> application services
        -> domain policies/types
        -> ports/interfaces
            -> provider/database/http adapters
```

Control API تكتب configuration state، لكن `MessageHandler` و`GeminiService` لا تستدعيانها ولا تقرآن DB عند كل رسالة؛ تستهلكان snapshot typed داخل الذاكرة.

## مسؤوليات المسارات

### `src/index.ts`

- composition root فقط: إنشاء/ربط dependencies، ترتيب startup/shutdown، signal handlers.
- ممنوع إضافة business rules أو SQL أو parsing لإعدادات feature جديدة داخله.
- كل initialization جديد explicit وقابل للإيقاف، ولا يحدث لمجرد import.
- Legacy وControl Plane branches يجب أن يكونا واضحين عند التركيب حتى يكون kill switch حقيقياً.

### `src/config/`

- `config.ts` هو legacy bootstrap الحالي ويجب الحفاظ على exports/precedence في compatibility release.
- يمنع إضافة قراءة `process.env` جديدة خارج bootstrap/config adapters.
- parsing يتم مرة واحدة وبشكل typed؛ لا تستخدم `Number(x) || default` إذا كان `0` قيمة ممكنة.
- built-in defaults لا تكرر في dashboard docs بعد وجود Registry؛ Registry تصبح source of truth.

### `src/bot/`

- WhatsApp lifecycle والنقل داخل `WhatsAppBot`.
- message orchestration/queue داخل `MessageHandler` أو مكونات مستخرجة منه.
- لا يوضع prompt content أو Store API SQL/HTTP logic داخل bot classes.
- أي تغيير reconnect/session/typing يحتاج اختبارات lifecycle وdrain ولا يدخل Control Plane V1.

### `src/services/`

- كل service لها مسؤولية واضحة وdependencies معلنة.
- لا تضف ميزة جديدة كبيرة إلى `GeminiService.ts`؛ استخرج `PromptComposer`, `GeminiClientFactory`, validators أو workflows في ملفات مستقلة أولاً.
- لا تضف lifecycle جديداً إلى `WhatsAppBot.ts` إذا أمكن وضعه في coordinator مستقل.
- external clients لا تصبح mutable global objects؛ أنشئ immutable client/config pair ثم بدله atomically.

### `src/database/`

- فتح DB، migrations، repositories، transactions فقط.
- يمنع SQL raw داخل controllers أو Gemini tools أو bot handlers.
- schema changes عبر migrations versioned، لا `CREATE/ALTER` مبعثرة في service constructors.
- legacy table creation تبقى كما هي حتى migration foundation منفصلة؛ لا توسع هذا النمط لجداول Control Plane.

### `src/types/`

- domain/API types المشتركة، بلا runtime side effects.
- external response types لا تمر مباشرة كdomain models دون mapping/validation.
- لا تستخدم `any` لتجاوز schema drift؛ استخدم `unknown` + parser/guard.

### `src/control-plane/` عند إنشائه

```text
src/control-plane/
├── api/          # HTTP transport/controllers/middleware
├── auth/         # token/scopes policies
├── config/       # registry/resolver/snapshot/validation
├── activation/   # validate-and-activate + atomic publish
├── secrets/      # provider interfaces/backends/redaction
├── storage/      # repositories/migrations only
└── types/        # contracts with no side effects
```

- لا import من `api/` داخل config/runtime.
- storage يعيد domain records، لا يسرب `better-sqlite3` rows للخدمات.
- secrets لا تعتمد على controllers.
- `index.ts` يحمل المجلد lazy فقط بعد فحص bootstrap flags.

### `tests/` عند إنشائه

```text
tests/
├── unit/
├── integration/
├── contract/
├── compatibility/
└── fixtures/
```

يحاكي المسارات المنطقية لـ`src/`. fixtures بلا بيانات عملاء أو credentials حقيقية.

### `docs/`

- `development-rules/`: قواعد العملية والقوالب.
- `control-plane-plan/`: الخطة والنطاق والميزات وعقد الترقية.
- `architecture-decisions/`: ADRs الجديدة عند إنشائها.
- `control-api/`: OpenAPI وconfiguration reference وrunbooks عند التنفيذ.
- التقارير التاريخية تبقى مرجعاً ولا تعدل لتبدو وكأنها تنبأت بالتنفيذ الجديد.

## قواعد الملفات

- اسم class/type رئيسي: `PascalCase.ts`.
- helpers/modules بلا class: `camelCase.ts` أو اسم domain واضح ومتسق مع المنطقة.
- tests: `*.test.ts`، ولا توضع scripts تجريبية في جذر المشروع.
- migration: رقم متزايد + وصف ثابت، مثل `001_create_control_tables.sql/ts` وفق الأداة المعتمدة.
- ملف جديد يستهدف أقل من 400 سطر. أكثر من 600 سطر يحتاج سبباً موثقاً ومراجعة تقسيم.
- لا تضف feature جديدة مباشرة إلى ملف legacy أكبر من 800 سطر دون استخراج مكون ذي حدود واختبارات.
- function جديدة تستهدف مسؤولية واحدة؛ أكثر من 80 سطراً يحتاج تقسيم أو سبباً في review.
- لا ملفات patch مؤقتة أو diffs مولدة في الجذر. الأدوات المؤقتة تُحذف قبل التسليم أو توضع في `scripts/` مع توثيق واختبار إذا أصبحت دائمة.

## imports والـside effects

ممنوع في top-level import جديد:

- فتح DB أو تنفيذ migration.
- تشغيل HTTP server أو timer.
- network call.
- قراءة/كتابة files.
- إنشاء provider client يحتاج secret.
- process exit.

الواقع الحالي يحتوي singletons وside effects legacy؛ لا نوسعها. عند لمس مكون من أجل Control Plane نضيف factory/lifecycle واضحاً خلف composition root مع الحفاظ على legacy branch.

## dependency rules

- لا dependency جديدة قبل تبرير: الحاجة، البدائل، license، maintenance، security، bundle/runtime impact.
- لا major upgrade مع feature change.
- يجب تحديث lockfile مع أي dependency change.
- لا framework عام قبل use case فعلي؛ V1 لا تحتاج jobs framework أو event bus أو multi-provider abstraction عامة.

