# سجل الإعدادات وتصنيفها

## لماذا نحتاج Registry

لا نسمح بكتابة key/value عشوائية. كل إعداد يجب أن يكون مسجلاً مسبقاً مع type وvalidation وfallback وapply mode ودرجة الحساسية. هذا يجعل API ذاتية التوثيق ويمنع dashboard من إرسال قيم لا يفهمها runtime.

## الحقول المطلوبة لكل descriptor

- الاسم الكامل: `namespace.key`.
- النوع: string/number/boolean/enum/object/string-array.
- الوصف والوحدة.
- القيمة الحالية المدمجة ومصدر env إن وجد.
- الحدود والقيم المقبولة.
- الحساسية.
- apply mode.
- dependency keys.
- validation محلي وخارجي.
- fallback policy.
- legacy resolver ومصادر البداية الحالية (`env/legacy_db/built_in`).
- release (`v1/later`) وهل المفتاح writable في الإصدار الحالي.
- هل يدعم reset إلى legacy.
- هل يظهر في API العامة للإعدادات أم يحتاج secret permission.

## namespaces المقترحة

القائمة التالية هي catalog طويل المدى. لا يعني التسجيل التخطيطي أن المفتاح writable في V1. كل descriptor يحمل `release` و`writable`، وتعيد schema endpoint حالة `available`, `read_only_legacy`, أو `planned`.

### `ai`

V1: `primary_model`, `fallback_model`, `api_key_ref`, `temperature`, `top_p`, `top_k`, و`max_output_tokens`.

لاحقاً: `provider`, `request_timeout_ms`, `max_function_iterations`, `history_messages`, `catalog_prompt_limit`, وسياسات provider fallback.

### `assistant`

V1: `business_prompt`, `language`, `tone`, `display_name`, `welcome_message`, و`error_messages`. لا تشمل core security guardrails.

لاحقاً: formatting profiles المركبة وأي workflow content عالي التأثير.

### `store_api`

كلها لاحقة: `base_url`, `timeout_ms`, `network_retries`, `retry_base_delay_ms`, `auth_secret_ref`, `customer_ip`, وcircuit breaker settings. تظل القيم الحالية في `.env`/الكود في V1.

### `whatsapp`

كلها لاحقة: reconnect limits/delays، health check، typing، browser timeout، executable path، auth path، headless، disconnect debounce.

### `messaging`

كلها لاحقة: queue capacity، processing timeout، conversation history limits، media types/size/download timeout. رسائل الخطأ التجارية البسيطة تتبع `assistant` في V1.

### `rate_limit`

V1 بعد إصلاح limiter: per-minute/window limits وwindow duration.

لاحقاً: burst، rapid-message thresholds، auto-block policy، وcleanup/retention.

### `catalog`

V1 بعد single-flight: refresh interval، prompt product limit، وdisplay limit.

لاحقاً: cache duration، page size/max pages، filters، وstale-cache policy.

### `checkout`

كلها لاحقة: supported countries، guest email، confirmation policy، payment selection strategy، default payment method، discount validation، order retry/idempotency policies.

### `operations`

كلها لاحقة أو bootstrap: auto restart، drain timeout، log level، status heartbeat، QR stale threshold، retention settings. V1 يعرض health للطبقة فقط ولا يدير تشغيل العملية.

### `access`

V1 يستخدم bootstrap token/scopes للـControl API ويصلح authorization للحظر. managed admins وOIDC/token lifecycle لاحقة، وتظل env admins break-glass.

### `privacy`

كلها لاحقة، مع بقاء redaction minimum guardrail في الكود من البداية.

## حالات القيمة في GET

لكل مفتاح غير سري:

```json
{
  "key": "ai.primary_model",
  "effectiveValue": "gemini-2.5-flash",
  "source": "env",
  "inherited": true,
  "configuredValue": null,
  "applyMode": "dynamic",
  "state": "effective",
  "revision": null,
  "validation": { "status": "valid" },
  "fallbackAvailable": true
}
```

هذا الرد يظهر تلقائياً حتى قبل إنشاء أول managed revision. `configuredValue=null` لا تعني أن المتجر بلا إعداد؛ تعني أنه لم ينشئ override وأن القيمة الفعالة موروثة من نظامه الحالي.

للـsecret:

```json
{
  "key": "ai.api_key_ref",
  "effectiveValue": null,
  "secret": {
    "configured": true,
    "source": "env",
    "managedOverride": false,
    "fingerprint": "sha256:ab12…",
    "lastValidatedAt": "..."
  }
}
```

## التبعيات

يدعم Registry قواعد cross-field، مثلاً:

- `ai.primary_model` يجب أن يكون قابلاً للاستخدام مع provider والـkey المختارين.
- `rate_limit.max_per_window >= max_per_minute`.
- `messaging.processing_timeout_ms` أكبر من مجموع الحدود المتوقعة لدورات الأدوات، ضمن سقف آمن.
- `checkout.default_payment_method` مطلوب فقط إذا strategy=`fixed`.
- `STATUS_API_HOST=0.0.0.0` لا يقبل دون token قوي وCORS مقيد عند تحويله إلى restart setting مستقبلاً.

## Reset

`DELETE /settings/{namespace}/{key}` لا يحذف التاريخ؛ ينشئ revision مفعلة تلغي managed override بعد validation. بعدها يعود المفتاح تلقائياً إلى legacy resolver الخاصة بالمتجر: `.env` أو legacy DB resource أو built-in fallback. هذه هي الطريقة الرسمية للعودة إلى السلوك القديم.

## إعدادات لا يجب إدارتها في الإصدار الأول

- مفتاح تشفير managed secrets.
- أول credential يسمح بالدخول إلى Control API.
- مسار قاعدة البيانات قبل تشغيل migration layer.
- قيم تسمح بتعطيل authorization أو audit.
- أسماء endpoints الداخلية الدقيقة لإنشاء الطلب والدفع؛ تغييرها يحتاج versioned integration profile وليس string حرة.
- أي descriptor خارج القائمة الصريحة في [Control Plane Lite V1](11-control-plane-lite-v1.md)، حتى لو كان موثقاً في registry roadmap.
