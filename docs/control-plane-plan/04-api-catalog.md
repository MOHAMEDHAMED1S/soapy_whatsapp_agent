# كتالوج الـAPIs المقترح

هذا كتالوج أولي لعقود الموارد. الأقسام الموصوفة بأنها `V1` أو التي تسرد صراحة جزء V1 هي فقط ما يلتزم به Control Plane Lite؛ الأقسام الموسومة `بعد V1` roadmap ولا تظهر routes الخاصة بها قبل تنفيذ مرحلتها.

## Configuration discovery في V1

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/api/control/v1/settings/schema` | Registry كامل: الأنواع والحدود وapply modes دون أسرار |
| GET | `/api/control/v1/settings/effective` | قيم المتجر الحالية تلقائياً، سواء managed أو inherited، مع مصادرها وحالتها |
| GET | `/api/control/v1/settings/{namespace}` | إعدادات namespace واحد |
| GET | `/api/control/v1/settings/{namespace}/{key}` | تفاصيل مفتاح واحد وتاريخه |
| PUT | `/api/control/v1/settings/{namespace}` | validate-and-activate لمجموعة مترابطة داخل namespace |
| PUT | `/api/control/v1/settings/{namespace}/{key}` | validate-and-activate لإعداد V1 واحد |
| DELETE | `/api/control/v1/settings/{namespace}/{key}` | revision مفعلة تلغي managed override وتعيد legacy fallback |

لا تقبل write endpoints مفاتيح `planned` أو `read_only_legacy` حتى إن ظهرت في schema.

لا توجد seed endpoint؛ `effective` تعمل قبل أول revision وتحل القيم من legacy sources الحالية. dashboard لا ترسل PUT لمجرد حفظ قيمة inherited كما هي.

## Revisions في V1

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/revisions` | قائمة revisions مع filters |
| GET | `/revisions/{id}` | diff وvalidation وapply impact |
| POST | `/revisions/{id}/rollback` | إنشاء revision عكسية والتحقق منها وتفعيلها atomically |
| POST | `/settings/validate` | validate-only لمجموعة V1 دون حفظ أو تفعيل |

مثال تعديل ذري مباشر:

```json
{
  "reason": "Test a new Gemini model",
  "expectedRevision": 41,
  "changes": [
    { "key": "ai.primary_model", "value": "gemini-model-name" },
    { "key": "ai.temperature", "value": 0.5 }
  ]
}
```

إن أضيفت drafts العامة لاحقاً تستخدم `/revisions` بعقود مستقلة؛ ليست جزءاً من V1.

## Secrets في V1 عند توفر capability

| Method | Path | الغرض |
| --- | --- | --- |
| POST | `/secrets` | إنشاء secret write-only وإرجاع reference |
| PUT | `/secrets/{id}` | rotation إلى version جديدة |
| GET | `/secrets` | metadata/fingerprint فقط |
| GET | `/secrets/{id}` | metadata وحالة validation فقط |
| POST | `/secrets/{id}/validate` | اختبار محدود حسب purpose |
| DELETE | `/secrets/{id}` | تعطيل secret غير مستخدمة؛ لا يسمح بحذف reference active |

لا يوجد GET لقيمة secret ولا endpoint “decrypt”.

هذه endpoints متاحة فقط عندما يكون encrypted/external provider مهيأ. بدون ذلك تعيد الكتابة `503 SECRET_WRITE_CAPABILITY_UNAVAILABLE` بينما يظل `GEMINI_API_KEY` من البيئة فعالاً.

## AI operations في V1

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/ai/status` | model/key source/degraded/fallback state دون secret |
| POST | `/ai/validate` | اختبار model/key candidate دون حفظ أو تفعيل |

إدارة circuit breakers القابلة للضبط أو reset endpoint عامة تؤجل لما بعد V1.

## Prompts في V1

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/assistant/prompts` | business prompt الفعالة وإصداراتها |
| POST | `/assistant/prompts/preview` | تركيب prompt النهائي بعد إخفاء guardrails الحساسة عند الحاجة |
| POST | `/assistant/prompts/validate` | فحص الحجم والمتغيرات والتعليمات المحظورة |

التعديل الفعلي يمر عبر settings PUT التي تنشئ revision داخلية؛ prompt endpoints لا تملك مسار كتابة جانبياً.

## Store API

بعد V1:

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/store-api/status` | base URL masked، latency، circuit state، آخر نجاح |
| POST | `/store-api/validate` | health/read-only requests ضد draft config |
| POST | `/store-api/circuit-breaker/reset` | reset محمي |

## WhatsApp operations

بعد V1:

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/whatsapp/config-impact` | effective/pending restart settings |
| POST | `/whatsapp/reconnect` | reconnect idempotent مع drain policy |
| POST | `/whatsapp/validate-browser` | فحص executable/session permissions دون بدء instance موازية |

QR يظل ضمن Status API المحمية، ولا ينسخ إلى audit أو configuration API.

## Limits and blocks في V1

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/rate-limits/status` | effective policy وviolations aggregates |
| GET | `/blocks` | قائمة paginated ومقننة الصلاحيات |
| POST | `/blocks` | حظر رقم normalized مع reason |
| DELETE | `/blocks/{normalizedPhone}` | إلغاء الحظر |
| POST | `/rate-limits/{phone}/reset` | بعد V1: reset فردي audited |

`/messaging/status` وqueue/media controls تؤجل لما بعد V1.

## Catalog في V1 بنطاق محدود

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/catalog/status` | الحجم والعمر وآخر refresh ومصدر stale |
| POST | `/catalog/refresh` | refresh idempotent/single-flight؛ يعيد refresh ID وتظهر حالته في catalog status |
| POST | `/catalog/validate` | بعد V1: اختبار Store API mapping دون تبديل الكاش |

## Checkout and payments

بعد V1:

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/checkout/policy` | effective countries/confirmation/payment strategy |
| POST | `/checkout/policy/validate` | cross-field validation دون إنشاء طلب |
| GET | `/payments/methods/cache` | metadata فقط من آخر جلب ناجح |

لا نوفر endpoint إداري ينشئ طلب عميل كجزء من طبقة الإعدادات.

## Admins and access

بعد V1، باستثناء auth الثابتة للـControl API:

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/access/admins` | managed admins وbreak-glass indicators |
| POST | `/access/admins` | إضافة managed admin مع scopes |
| PATCH | `/access/admins/{id}` | تعديل scopes/state |
| DELETE | `/access/admins/{id}` | تعطيل managed admin؛ env break-glass لا يحذف من API |
| GET | `/access/me` | actor الحالي وscopes |

## Audit and operations

| Method | Path | الغرض |
| --- | --- | --- |
| GET | `/audit-events` | بحث paginated دون payloads حساسة |
| GET | `/operations/status` | V1: حالة Control Plane وactive revision والمكونات degraded |
| POST | `/operations/restart` | بعد V1: drain + restart عندما تجهز آلية موثوقة |
| GET | `/operations/jobs/{id}` | بعد V1: حالة عملية طويلة |

## HTTP semantics

- `200` قراءة أو عملية مكتملة.
- `201` resource أو secret reference جديد.
- `202` refresh أو operation لاحقة غير متزامنة.
- `204` عملية حذف override ناجحة بلا body.
- `400` request malformed.
- `401/403` authentication/authorization.
- `404` resource غير موجود.
- `409` revision conflict أو resource مستخدم.
- `422` schema أو business validation.
- `429` control rate limit.
- `503` component required للتحقق غير متاح، مع بقاء runtime القديم فعالاً.
