# قواعد التوثيق

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17

## مبادئ

- التوثيق جزء من Definition of Done، وليس مرحلة اختيارية بعد الكود.
- وثق السلوك الحقيقي، ولا تعرض roadmap كأنها endpoint أو setting منفذة.
- لا تكرر defaults في عدة ملفات بعد وجود source مولد؛ اربط بالمصدر الأساسي.
- الأمثلة لا تحتوي secrets أو PII أو أرقام عملاء أو QR أو payload طلب حقيقي.
- اذكر limitations والفشل والrollback، لا happy path فقط.

## اللغة والأسلوب

- مستندات المشروع الداخلية الجديدة: العربية الواضحة مع identifiers/error codes/paths بالإنجليزية.
- OpenAPI وfield names وerror codes بالإنجليزية لتثبيت عقود العملاء.
- يمكن إبقاء مستند قائم بلغته، لكن لا تخلط لغتين في الجملة دون حاجة تقنية.
- استخدم `MUST/يجب` فقط للقواعد الملزمة، ووضح الحالات المؤجلة.

## metadata للمستندات الجديدة

كل plan/runbook/ADR جديد يبدأ بـ:

```text
الحالة: Draft | Approved | Implemented | Superseded
آخر تحديث: YYYY-MM-DD
النطاق/الإصدار:
المرجع أو القرار المستبدَل إن وجد:
```

لا تغيّر حالة `Implemented` قبل وجود الكود والاختبارات.

## أماكن الملفات

| النوع | المكان |
| --- | --- |
| قواعد التطوير | `docs/development-rules/` |
| خطط Control Plane | `docs/control-plane-plan/` |
| خطة ميزة عامة | `docs/features/<feature>.md` عند إنشاء هذا المسار |
| ADR | `docs/architecture-decisions/NNNN-title.md` |
| OpenAPI | `docs/control-api/openapi.v1.yaml` |
| Configuration reference | `docs/control-api/configuration-reference.md` أو مولد منها |
| Runbooks | `docs/runbooks/<incident>.md` |
| Release notes/migration | `docs/releases/<version>.md` |

لا تضع planning documents أو patch scripts جديدة في جذر المشروع.

## متى يجب تحديث ماذا

| التغيير | التوثيق المطلوب |
| --- | --- |
| env/config/default | `.env.example` + configuration reference + fallback/migration note |
| API route/schema/status | OpenAPI + examples + auth/errors + compatibility note |
| DB schema | migration doc + backup/rollback + data impact |
| secret/auth | threat model + rotation/recovery runbook + redaction tests |
| startup/shutdown/port | operations guide + PM2/deployment note |
| behavior للمستخدم | README/feature guide + acceptance cases |
| قرار معماري طويل الأثر | ADR |
| feature flag | reference + default + enable/disable/rollback |

## خطة الميزة

استخدم [قالب خطة الميزة](templates/feature-plan-template.md). لا تعتبر الخطة جاهزة دون:

- current behavior ومصادر القيم.
- scope/out-of-scope.
- architecture/file ownership.
- API/data/security impact.
- inherited baseline/fallback.
- validation/apply semantics.
- failure modes.
- tests/rollout/rollback.
- docs deliverables.

## ADR

يلزم ADR عند:

- إضافة service/storage/queue/framework جديد.
- تغيير source of truth أو precedence.
- دمج/فصل API servers أو auth domains.
- اختيار encryption/secret backend.
- تغيير DB migration strategy.
- دعم multi-process أو remote control plane.
- كسر contract أو إزالة fallback.

ADR تسجل context/options/decision/consequences/migration/rollback. لا تعاد كتابة ADR القديمة بعد تغير القرار؛ أنشئ ADR جديدة تستبدلها.

## عقود API

- OpenAPI المنفذة هي source of truth للعملاء.
- كل endpoint: auth/scope، request/response، errors، idempotency، concurrency، redaction، example.
- generated examples تستخدم placeholder values.
- HTTP `202` لا يوصف كنجاح نهائي إذا كانت العملية pending.
- secret fields write-only، ولا schema توحي بوجود GET plaintext.

## مراجعة التوثيق

قبل التسليم:

- افحص كل الروابط المحلية.
- ابحث عن أسماء flags/routes قديمة.
- تأكد أن الأمثلة لا تكشف credential.
- طابق defaults مع الكود/Registry.
- طابق حالة المستند مع التنفيذ.
- اذكر بوضوح ما لم ينفذ أو لم يختبر.

