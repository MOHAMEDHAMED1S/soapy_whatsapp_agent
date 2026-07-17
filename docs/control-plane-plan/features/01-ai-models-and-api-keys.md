# ميزة AI: الموديلات ومفاتيح API

## موضعها في الخطة

هذه ميزة أساسية في `Control Plane Lite V1` لكن بنطاق محدود: Gemini فقط، primary/fallback model، managed key اختياري، وأربع generation settings. provider abstraction العامة، advanced fallback/circuit policies، timeouts/history/function-iteration controls تؤجل لما بعد V1.

## الوضع الحالي

`GeminiService` ينشئ `GoogleGenerativeAI` مرة واحدة باستخدام `GEMINI_API_KEY`، ويقرأ primary/fallback model من config ثابتة. generation parameters وtimeouts وعدد دورات الأدوات مدمجة في الكود.

## الهدف

- تغيير model/key والإعدادات المعتمدة عبر validate-and-activate مع revision backend.
- إبقاء `GEMINI_API_KEY`, `GEMINI_MODEL`, و`GEMINI_FALLBACK_MODEL` fallback كاملة.
- منع تفعيل model/key غير صالحة.
- عدم كشف المفتاح أو إعادة بنائه في logs/status.

## التعديلات البرمجية

### تغييرات V1

1. إنشاء `GeminiConfiguration` typed من الـsnapshot.
2. استبدال singleton client الثابت بـ`GeminiClientFactory` تبني client حسب model/key fingerprint، مع cache محدود.
3. إضافة connectivity validator بلا tools وhealth state بسيط.
4. فصل اختيار client/config عن prompt/tool orchestration حتى يمكن تبديله atomically.

### تحسينات مستقلة أو لاحقة

- provider adapters عامة وrunner موحد للنص/الوسائط/functions.
- circuit breaker متقدم وسياساته القابلة للضبط.
- منع side-effect tools المتوازية وtool authorization إصلاح أمني مطلوب للمشروع، لكنه لا يُحمّل على تنفيذ provider framework في V1.

## الإعدادات المدارة

### إعدادات V1

- primary/fallback model لـGemini.
- API secret reference واحد؛ `GEMINI_API_KEY` يظل fallback.
- temperature/topP/topK/maxOutputTokens ضمن سقوف code-owned.

### لاحقاً

- provider selection وfallback secret reference.
- request/follow-up timeout وhistory length.
- max function iterations وسياسات 401/429/timeout/5xx القابلة للضبط.

## APIs

- secret CRUD write-only تحت `/secrets` عندما يكون managed secret provider مهيأ.
- settings عبر PUT المباشرة التي تنشئ revisions داخلياً.
- `POST /ai/validate` يقبل candidate values/references ويجري طلباً قصيراً بلا tools.
- `GET /ai/status` يعرض model فعالاً، مصدر key، آخر نجاح، degraded/fallback state دون قيمة key.

## سلسلة fallback

### عند resolution

```text
managed active key ref صالح وقابل للفك
-> GEMINI_API_KEY
-> AI unavailable
```

model:

```text
managed primary -> GEMINI_MODEL -> default الحالي
managed fallback -> GEMINI_FALLBACK_MODEL -> default الحالي
```

### عند provider runtime failure

- 401/403 من managed key: لا retries كثيرة؛ علّم المصدر degraded وانتقل إلى env key إذا كانت مختلفة وصالحة.
- model not found/unsupported: جرب fallback model الموافق للـprovider.
- 429/5xx/timeout: retry محدود مع jitter ثم fallback model/key حسب policy.
- safety/content block ليس provider outage ولا يسبب تبديل key.

لا نكتب env key إلى قاعدة البيانات تلقائياً.

## Validation والتفعيل

- format/length لا يكفي؛ نحتاج connectivity call آمنة.
- يتحقق أن primary وfallback مختلفان عند الحاجة ومتوافقان مع provider.
- activation atomically للـprovider/model/key refs.
- الطلبات الجارية تكمل بالclient القديم؛ الجديدة تستخدم الجديد.
- يحتفظ factory بالclient القديم فترة قصيرة ثم يتخلص منه دون إلغاء الطلبات الجارية.

## الأمان

- لا يعاد المفتاح في GET.
- fingerprint HMAC/Hash قصير للمقارنة فقط.
- validation errors منقحة.
- scopes منفصلة `secrets:write` و`settings:activate` حتى لا يستطيع شخص واحد زرع key وتفعيلها دون السياسة المطلوبة مستقبلاً.
- core safety/tool authorization لا تكون إعدادات حرة.

## حالات الفشل

- فشل decrypt: env fallback + alert.
- Control API down: snapshot الحالي مستمر.
- key جديدة تفشل بعد activation: env fallback مع degraded status، ثم rollback صريحة للrevision بعد التحقق.
- كلا المفتاحين يفشلان: رسالة خدمة degraded الحالية، دون ادعاء تنفيذ tools.

## الاختبارات ومعايير القبول

- managed valid/invalid/missing/decrypt failure.
- env fallback فعلي.
- key لا تظهر في logs/responses/audit.
- تبديل model لا يقطع request جارياً.
- text/media يطبقان نفس fake-order/tool checks.
- fallback health لا يتبدل بسبب user-content error.
- غياب control tables يعطي السلوك الحالي.
