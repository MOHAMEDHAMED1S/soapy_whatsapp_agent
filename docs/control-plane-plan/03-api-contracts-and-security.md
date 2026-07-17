# عقود APIs والأمان

## Base path والإصدار

كل الواجهات الجديدة تحت:

```text
/api/control/v1
```

Status API الحالي يظل متوافقاً. في الإصدار الأول يعمل Control API على server محلي مستقل حتى لا يؤدي فشله إلى تعطيل health/QR/status الحالية. يمكن للـreverse proxy تقديمهما تحت domain واحدة لاحقاً، مع بقاء middleware والصلاحيات منفصلة.

فصل السيرفر هنا قرار عزل، لا دعوة لبناء service أو deployment جديد: كلاهما داخل نفس Node process في البداية، لكن Control API لا تبدأ إلا بالـfeature flag ولها auth/router مستقلان.

## Bootstrap configuration

القيم التالية تبقى في `.env` لأنها مطلوبة قبل أن تصبح واجهة الإدارة متاحة:

```env
CONTROL_PLANE_ENABLED=false
CONTROL_PLANE_WRITES_ENABLED=false
CONTROL_PLANE_ACTIVATION_ENABLED=false
CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false
CONTROL_API_HOST=127.0.0.1
CONTROL_API_PORT=3003
CONTROL_API_TOKEN=
CONTROL_API_SCOPES=settings:read
CONTROL_SECRETS_MASTER_KEY=
```

- عند `CONTROL_PLANE_ENABLED=false` لا يبدأ السيرفر الجديد ويعمل المشروع legacy بالكامل.
- `CONTROL_PLANE_MANAGED_RESOLUTION_ENABLED=false` هو kill switch مستقل: حتى لو وجدت managed rows قديمة، لا يستهلكها runtime ويستخدم `.env` والقيم الحالية فقط.
- settings `PUT/DELETE/rollback` تتطلب أن يكون كل من `WRITES_ENABLED` و`ACTIVATION_ENABLED` مفعلاً؛ لا تنشئ V1 draft صامتة عند إغلاق activation.
- validate-only متاح مع الواجهة المقروءة، وsecret resource writes تتطلب `WRITES_ENABLED` وsecret-provider capability لكنها لا تفعل runtime وحدها.
- عند تفعيل السيرفر يصبح `CONTROL_API_TOKEN` مطلوباً حتى على localhost.
- إذا غاب `CONTROL_API_SCOPES` بعد تفعيل الواجهة تكون صلاحية bootstrap token قراءة فقط؛ الكتابة والتفعيل والأسرار والoperations تحتاج scopes صريحة.
- غياب `CONTROL_SECRETS_MASTER_KEY` يسمح بالقراءة وكتابة الإعدادات غير السرية؛ secret writes وmanaged-secret resolution تصبح unavailable وتعود الخدمات إلى env secrets.
- فشل bind على منفذ Control API يسجل component degraded ولا يوقف WhatsApp أو Status API.

## المصادقة في الإصدار الأول

- Bearer token مستقل باسم `CONTROL_API_TOKEN` كـbootstrap credential.
- scopes الخاصة به تأتي من `CONTROL_API_SCOPES` ولا تعاد أو تعدل من Control API في V1.
- bind الافتراضي `127.0.0.1:3003` عند استخدام السيرفر المستقل.
- رفض البدء على عنوان عام دون token صالح.
- مقارنة token بطريقة timing-safe.
- TLS يتم عند reverse proxy في النشر الأول، مع توثيق trusted proxy.
- لا يقبل token في query string.

لاحقاً يمكن إضافة OIDC/JWT للـdashboard دون تغيير عقود الموارد.

## الصلاحيات

Scopes مبدئية:

- `settings:read`
- `settings:write`
- `settings:activate`
- `secrets:write`
- `secrets:rotate`
- `operations:execute`
- `blocks:read`, `blocks:write`
- `admins:read`, `admins:write`
- `audit:read`

لا يوجد endpoint يعيد plaintext secret حتى مع أعلى صلاحية.

V1 يمكن أن يمنح bootstrap token مجموعة scopes ثابتة من `.env`. تخزين actors وإدارة grants وOIDC ليست ضمن V1؛ المهم ألا يتحول token الواحد ضمنياً إلى صلاحيات غير موثقة عندما تضاف لاحقاً.

## شكل الاستجابة

نجاح:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "apiVersion": "v1",
    "effectiveRevision": 42
  }
}
```

خطأ:

```json
{
  "success": false,
  "error": {
    "code": "SETTING_VALIDATION_FAILED",
    "message": "The proposed setting is invalid.",
    "fields": {
      "ai.temperature": ["Must be between 0 and 2"]
    }
  },
  "meta": { "requestId": "uuid" }
}
```

رسائل الخطأ لا تحتوي provider raw response إذا كان قد يتضمن credential أو PII.

## عرض قيم المتجر الحالية تلقائياً

`GET /settings/effective` وقراءات namespace لا تعتمد على وجود managed revision. عند أول تشغيل read-only تحل كل descriptor من legacy sources الحالية وتعيد:

- `effectiveValue` لغير الأسرار.
- `source`: `managed`, `env`, `legacy_db`, أو `built_in`.
- `inherited=true` عندما لا توجد managed override.
- `configuredValue=null` مع بقاء effective value موجودة إذا كانت موروثة.
- للأسرار: `configured/source/fingerprint` فقط، ولا plaintext.

لا توجد endpoint باسم initialize/seed مطلوبة كي تظهر القيم. أول settings PUT تقارن بالقيمة الفعالة الموروثة؛ إذا كانت مساوية لها يمكن أن تعيد no-op ولا تنشئ override بلا داعٍ.

## دورة تعديل V1 المبسطة

للتغيير الفردي:

1. `PUT /settings/{namespace}/{key}` مع `value`, `reason`, و`expectedRevision`.
2. الخادم ينفذ parsing وvalidation واختبار connectivity عند الحاجة.
3. عند النجاح يحفظ revision وaudit ويستبدل الـsnapshot atomically.
4. عند الفشل يعيد `422/503` ولا يغير active revision.

للمجموعة المترابطة:

1. `PUT /settings/{namespace}` مع `changes[]`, `reason`, و`expectedRevision`.
2. تتحقق المجموعة وتنشط في SQLite transaction واحدة.

`DELETE /settings/{namespace}/{key}` ينشئ revision تزيل override وتعيد fallback. لا يوجد تعديل مباشر بلا تاريخ.

إذا كانت هذه أول managed write للمفتاح، يسجل الـaudit أن `oldSource` كانت inherited ومصدرها دون نسخ secret. rollback لهذه الكتابة تزيل override وتعود إلى legacy resolver الحالية للمتجر.

## التاريخ والـrollback في V1

- `GET /revisions` و`GET /revisions/{id}` يعرضان metadata وdiff منقحاً.
- `POST /revisions/{id}/rollback` ينشئ revision عكسية بعد إعادة validation، ولا يعيد تفعيل row قديمة في مكانها.
- endpoint validate-only متاح للـpreview، لكنه ليس خطوة إلزامية قبل كل `PUT` لأن `PUT` يتحقق دائماً.

الـdraft/activate workflow العامة، batch بين namespaces، approvals، وrebase تؤجل للإعدادات عالية المخاطر بعد V1. إضافة هذه الدورة لاحقاً لا تغير حقيقة أن كل كتابة V1 مخزنة كrevision.

## التزامن

- Optimistic concurrency باستخدام `expectedRevision` أو `If-Match`.
- التعارض يعيد `409 CONFIGURATION_REVISION_CONFLICT`.
- لا يسمح بكتابة بنيت فوق base قديم؛ يعيد العميل القراءة ويحاول بطلب صريح جديد.

## Idempotency

كل عمليات POST/PUT ذات الأثر الجانبي تقبل `Idempotency-Key`، خاصة secret rotation، settings write، rollback، refresh، وblock/unblock. يخزن المفتاح ونتيجته لمدة محددة لمنع تكرار العملية من dashboard.

## Validation modes

- `local`: schema/range/dependencies فقط.
- `connectivity`: اتصال خارجي read-only.
- `full`: local + connectivity + runtime dry-run.

لا ينفذ validation عملية شراء أو دفع أو إرسال WhatsApp message حقيقية.

V1 يستخدم `local` لمعظم القيم و`connectivity` فقط للموديل/المفتاح. `full runtime dry-run` العام يؤجل؛ لا نبني framework لا يستخدمه النطاق الحالي.

## Rate limiting للواجهة

Control API له limiter منفصل عن العملاء:

- حد للقراءة.
- حد أقل للكتابة والتفعيل.
- حد شديد لعمليات الاتصال الخارجي وإعادة التشغيل.
- lockout تدريجي لمحاولات token الفاشلة دون حظر دائم غير قابل للاسترجاع.

## Audit

يسجل لكل request mutating:

- actor/scopes وrequest ID.
- resource/action.
- result وerror code.
- changed key names فقط.
- revision وسبب التغيير.
- IP بعد مراعاة trusted proxy.

يحظر تسجيل Authorization header، request secret fields، QR value، prompt يحتوي PII، أو raw provider errors غير المنقحة.

## CORS

- مغلق افتراضياً لغير نفس المصدر.
- قائمة origins محددة، لا `*` مع واجهة إدارة.
- methods وheaders أقل ما يلزم.
- dashboard authentication المستقبلية تستخدم سياسة CSRF مناسبة إذا انتقلنا إلى cookies.

## Health endpoints

- liveness عامة ومحلية بدون تفاصيل.
- readiness للـControl API لا تعني أن WhatsApp ready.
- `/effective-status` محمي ويعرض المصادر والحالة دون قيم حساسة.
- تعطل Control API لا يغير readiness الخاصة بالبوت؛ يعرض كمكون degraded فقط.
