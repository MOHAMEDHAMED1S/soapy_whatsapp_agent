# مصفوفة تتبع القيم الحالية

## مفتاح النطاق

- `V1`: ضمن Control Plane Lite بعد شرطه السابق.
- `Later`: موثق للـroadmap ويظل `.env`/code في V1.
- `Guardrail`: لا يصبح setting حرة.

كل قيمة في هذه المصفوفة تبدأ تلقائياً من مصدرها الحالي في installation. عمود fallback ليس قيمة عامة تكتب فوق إعداد المتجر؛ هو legacy resolver التي تعرض وتستخدم `.env`/legacy DB/constant الحالية حتى ينشئ المشغل override صريحة.

## AI

| الحالي | المفتاح المقترح | النطاق | التطبيق | fallback |
| --- | --- | --- | --- | --- |
| `GEMINI_API_KEY` | `ai.api_key_ref` | V1 | Dynamic client rebuild | managed secret ثم env |
| `GEMINI_MODEL` / default | `ai.primary_model` | V1 | Dynamic | managed ثم env ثم default الحالي |
| `GEMINI_FALLBACK_MODEL` | `ai.fallback_model` | V1 | Dynamic | managed ثم env ثم default الحالي |
| temperature/topP/topK/tokens | `ai.generation.*` | V1 subset | Dynamic | managed ثم defaults الحالية |
| 60s request timeout | `ai.request_timeout_ms` | Later | Dynamic | env/constant الحالي |
| 5 function iterations | `ai.max_function_iterations` | Later/Guardrail | Dynamic بسقف ثابت | constant الحالي |
| 10 history messages | `ai.history_messages` | Later | Dynamic | constant الحالي |
| safety BLOCK_NONE | ليست business setting حرة | Guardrail | code-owned policy | لا override عام |

## Store API

كل الصفوف التالية `Later` وتظل كما هي في V1.

| الحالي | المفتاح | التطبيق | fallback |
| --- | --- | --- | --- |
| `API_BASE_URL` | `store_api.base_url` | Dynamic Axios client swap | managed ثم env ثم default |
| 30s timeout | `store_api.timeout_ms` | Dynamic | managed ثم default |
| retry count 2 | `store_api.network_retries` | Dynamic بسقوف | managed ثم default |
| delays 1s/2s | `store_api.retry_base_delay_ms` | Dynamic | managed ثم default |
| `CUSTOMER_IP` | `store_api.customer_ip` | Dynamic | managed ثم env ثم default |

## WhatsApp

كل الصفوف التالية `Later` وتظل كما هي في V1.

| الحالي | المفتاح | التطبيق |
| --- | --- | --- |
| 5 reconnect attempts | `whatsapp.reconnect.max_attempts` | Dynamic للدورة التالية |
| 5s exponential base | `whatsapp.reconnect.base_delay_ms` | Dynamic |
| 60s health check | `whatsapp.health.interval_ms` | Dynamic مع reschedule |
| 15s typing refresh | `whatsapp.typing.refresh_ms` | Dynamic |
| 60s max typing | `whatsapp.typing.max_duration_ms` | Dynamic |
| 10s disconnect debounce | `whatsapp.disconnect_debounce_ms` | Dynamic |
| Puppeteer 60s timeout | `whatsapp.browser.timeout_ms` | Reconnect required |
| `.wwebjs_auth` path | `whatsapp.auth.data_path` | Process restart required |
| executable path | `whatsapp.browser.executable_path` | Reconnect/restart required |

## Messaging and media

كل الصفوف التالية `Later` وتظل كما هي في V1.

| الحالي | المفتاح | التطبيق |
| --- | --- | --- |
| queue map limit 100 | `messaging.queue.max_messages` | بعد استبدال queue الحالية |
| 300s processing timeout | `messaging.processing_timeout_ms` | Dynamic |
| 30 stored messages | `messaging.conversation.max_stored_messages` | Dynamic |
| 10 AI history | `ai.history_messages` | Dynamic |
| 10MB media | `messaging.media.max_bytes` | Dynamic بسقف آمن |
| supported media set | `messaging.media.allowed_types` | Dynamic allow-list |

## Rate limiting

| الحالي | المفتاح | التطبيق |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE`/20 | `rate_limit.max_per_minute` | Dynamic |
| `RATE_LIMIT_PER_WINDOW`/100 | `rate_limit.max_per_window` | Dynamic |
| `RATE_LIMIT_WINDOW_MINUTES`/5 | `rate_limit.window_minutes` | Dynamic |
| rapid <2s auto-block | `rate_limit.auto_block.rapid_seconds` | Dynamic بسقوف |
| suspicious <5s | `rate_limit.suspicious_seconds` | Dynamic |
| cleanup 60s | `rate_limit.cleanup_interval_ms` | Dynamic |

فقط `max_per_minute`, `max_per_window`, و`window_minutes` تدخل V1، ويجب إصلاح منطق sliding window قبل تحويلها. بقية الصفوف `Later`.

## Catalog

| الحالي | المفتاح | التطبيق |
| --- | --- | --- |
| cache 30m | `catalog.cache_duration_ms` | Dynamic |
| auto refresh 30m | `catalog.refresh_interval_ms` | Dynamic مع reschedule |
| 50 products in prompt | `catalog.prompt_product_limit` | Dynamic |
| fetch per_page 1000 | `catalog.fetch_page_size` | Dynamic ضمن API limits |
| display 10 | `catalog.display_limit` | Dynamic |

V1 يضم `refresh_interval_ms`, `prompt_product_limit`, و`display_limit` بعد single-flight. بقية الصفوف `Later`.

## Checkout

كل الصفوف التالية `Later` ولا تتغير في V1.

| الحالي | المفتاح | التطبيق |
| --- | --- | --- |
| 6 country codes المتكررة | `checkout.supported_countries` | Dynamic بعد توحيد المصدر |
| `guest@soapy.com` | `checkout.guest_email` | Dynamic |
| أول payment method | `checkout.payment.selection_strategy` | Dynamic بعد workflow الجديد |
| confirmation في prompt فقط | `checkout.confirmation.required` | guardrail ثابت true أولاً |
| order retry 2 | `checkout.order.retry_policy` | لا يفعل قبل idempotency |

## Operations

كل الصفوف التالية `Later` أو bootstrap ولا تتغير في V1.

| الحالي | المفتاح | التطبيق |
| --- | --- | --- |
| `LOG_LEVEL` | `operations.log_level` | Dynamic إذا دعم logger ذلك |
| auto restart 30m | `operations.auto_restart_interval_minutes` | Dynamic/reschedule |
| drain 20s | `operations.restart_drain_timeout_ms` | Dynamic |
| status port/host | `operations.status_api.*` | Restart required ويفضل bootstrap أولاً |
| heartbeat 15s | `operations.status_api.heartbeat_ms` | Dynamic |
| QR stale 60s | `operations.status_api.qr_stale_seconds` | Dynamic |

## Access and data

managed admins والretention وDB path كلها `Later`. إصلاح authorization للحظر شرط أمني لـV1 لكنه ليس تحويل admins إلى managed settings.

| الحالي | المفتاح/المورد | التطبيق |
| --- | --- | --- |
| `ADMIN_PHONES` | managed admins + env break-glass | Dynamic |
| admin prompt table | versioned assistant prompt resource | Dynamic |
| plaintext logs | `privacy.log_redaction` | guardrail on دائماً |
| no retention | `privacy.*_retention_days` | scheduled jobs |
| DB path | bootstrap/restart setting | لا يدار في الإصدار الأول |
