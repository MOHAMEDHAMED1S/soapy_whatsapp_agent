# قواعد تنفيذ Control Plane

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17
**مرجع النطاق:** [Control Plane Lite V1](../control-plane-plan/11-control-plane-lite-v1.md)

## العقد الأساسي

Control Plane طبقة اختيارية فوق النظام الحالي وليست بديلاً فورياً له. أي implementation تخالف واحداً من العقود التالية لا تدمج:

1. flags غائبة/false = legacy behavior كامل.
2. لا port أو migration أو tables أو timers أو network calls جديدة في Legacy mode.
3. لا import side effects لوحدات Control Plane قبل flags.
4. `.env` وlegacy DB values والconstants الحالية تبقى Inherited Legacy Baseline لكل متجر.
5. لا bulk seed ولا نسخ secrets أو prompts أو admins تلقائياً.
6. managed invalid/unavailable = inherited fallback موثقة، لا crash.
7. runtime لا يستدعي Control API أو DB لكل رسالة.
8. التفعيل ذري عبر immutable snapshot.
9. Control API down لا يوقف WhatsApp أو Status API.
10. rollback وkill switches مجربة.

## حدود V1

المسموح فقط:

- Gemini primary/fallback model وmanaged key اختياري.
- `temperature`, `top_p`, `top_k`, `max_output_tokens` ضمن bounds.
- business prompt وهوية/نبرة/لغة ورسائل بسيطة.
- ثلاثة rate-limit settings بعد إصلاح limiter واختباره.
- block CRUD بعد service authorization/normalization.
- catalog refresh interval/prompt/display limits وmanual refresh بعد single-flight.

الممنوع في V1:

- Store API connection/auth/retry profile.
- WhatsApp/Puppeteer/LocalAuth/reconnect settings.
- DB path، ports، PM2، restart jobs.
- checkout/payment/countries/discount/order retry.
- managed admins/OIDC.
- retention/cleanup/encryption profiles للبيانات.
- multi-provider framework، jobs framework، event bus، multi-process sync.
- draft/approval system عام دون feature تحتاجه.

توسيع القائمة يحتاج تعديل plan معتمد قبل الكود.

## ترتيب التنفيذ الإلزامي

### Gate 0: foundation

- lockfile + tests + fixtures.
- characterization للlegacy values.
- feature flags مغلقة.
- lazy composition branch.
- opt-in migration mechanism.

### Gate 1: read-only/shadow

- Registry V1 typed.
- LegacyBaselineSnapshot ومصدر كل قيمة.
- effective/schema/status APIs.
- لا write/activation/resolution.

### Gate 2: non-secret write

- validate-only.
- PUT validate-and-activate مع expected revision.
- backend history/audit/rollback.
- atomic snapshot.
- pilot prompt منخفض المخاطر.

### Gate 3: secret capability

- Environment provider دائماً.
- Encrypted provider opt-in فقط.
- secret redaction/leak tests.
- model/key connectivity بلا tools.
- env fallback drill.

### Gate 4: limits/blocks/catalog

كل مجال بعد شرطه واختباراته، ولا يجب جمعها في release واحدة.

لا يبدأ Gate تالٍ قبل قياس ومراجعة السابق على canary.

## flags

القيم الافتراضية دائماً false:

```text
CONTROL_PLANE_ENABLED
CONTROL_PLANE_WRITES_ENABLED
CONTROL_PLANE_ACTIVATION_ENABLED
CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED
CONTROL_PLANE_<NAMESPACE>_ENABLED
```

- `ENABLED=false` يتجاوز التخزين/API.
- settings PUT/DELETE/rollback تحتاج writes + activation.
- managed resolution مستقلة عن وجود rows.
- namespace flags تستخدم أثناء الترحيل.
- لا flag واحدة تفتح API والكتابة والتفعيل والاستهلاك معاً.

## Registry والbaseline

- لا key/value عشوائية.
- descriptor تحدد type/bounds/sensitivity/apply mode/release/legacy resolver/dependencies.
- V1 descriptors كلها dynamic.
- `effectiveValue` تظهر تلقائياً من legacy source قبل أول revision.
- فتح dashboard لا يرسل writes.
- PUT مساوية للقيمة inherited يمكن أن تكون no-op.
- reset يزيل override ويعود إلى resolver الحالية للمتجر.
- secret inherited تظهر metadata فقط.

## التخزين والـrevisions

- history في backend، لا dashboard فقط.
- successful PUT تنشئ immutable revision.
- rejected request audit فقط، لا revision قابلة للتفعيل.
- كل revision تخزن managed overrides كاملة، لا effective legacy values ولا plaintext secrets.
- active pointer + values + audit transaction واحدة.
- rollback تنشئ revision جديدة ولا تعيد كتابة التاريخ.

## runtime

- candidate snapshot تبنى وتتحقق قبل publish.
- pointer swap واحدة للطلبات الجديدة؛ الجارية تكمل بالقديمة.
- Gemini client يبنى من model/key pair من revision واحدة.
- timers التي يعاد جدولتها لا تتسرب وتتوقف في shutdown.
- V1 process واحدة. إذا اكتشف أكثر من process تبقى managed resolution مغلقة.
- لا تدّع automatic rollback؛ V1 تستخدم health/degraded + feature fallback + operator rollback.

## API والأسرار

- base path `/api/control/v1` وسيرفر محلي منفصل داخل نفس process.
- token/scopes bootstrap من env وread-only عند غياب scopes.
- secret write capability تعيد unavailable إذا لا master key؛ runtime يستخدم env.
- لا GET decrypt.
- API examples لا تحمل key حقيقية.
- OpenAPI تدرج routes المنفذة فقط، لا roadmap.

## Definition of Done لكل setting

- descriptor وlegacy resolver.
- characterization test للقيمة الحالية.
- managed/env/legacy DB/built-in/invalid/reset tests حسب المصادر.
- source metadata وredaction.
- activation atomicity وconcurrency test.
- fallback/kill switch test.
- docs/OpenAPI/config reference.
- canary/rollback steps.

