# ميزة Store API والمرونة

## موضعها في الخطة

هذه الميزة `بعد V1`. يظل `API_BASE_URL` وtimeouts/retries وauth في `.env` والكود خلال Control Plane Lite. يبدأ تنفيذها فقط بعد client factory موحد، typed errors، contract tests، وidempotency للعمليات ذات الأثر الجانبي.

## الوضع الحالي

`ApiService` يملك Axios instance ثابتاً مبنياً من `API_BASE_URL`، timeout ثابت 30 ثانية، ومعالجة أخطاء غير موحدة. بعض العمليات تعيد error response وبعضها يرمي exception. retries موجودة لإنشاء الطلب والدفع دون idempotency مكتملة.

## الهدف

- إدارة الاتصال والسياسات غير الخطرة عبر API.
- إبقاء `API_BASE_URL` و`CUSTOMER_IP` والقيم الحالية fallback.
- توحيد الأخطاء والـtimeouts والـretries/circuit breaker.
- عدم السماح لإعداد خاطئ بتوجيه production traffic قبل validation.

## التعديلات البرمجية

1. `StoreApiClientFactory` يبني client immutable من snapshot.
2. `StoreApiError` typed: validation/auth/not-found/rate-limit/network/timeout/server.
3. عقود methods موحدة: إما Result typed أو exceptions typed، وليس مزيجاً.
4. فصل read clients عن write operations policies.
5. إضافة request ID وidempotency headers للعمليات الداعمة.
6. تنقيح logs وعدم تسجيل payloads الحساسة.

## الإعدادات المدارة

- base URL مع allow-list للبروتوكول/host policy.
- timeout وconnect timeout.
- retries للقراءات.
- retries للكتابة فقط إذا توفر idempotency.
- retry delay/jitter.
- optional auth secret ref/headers profile.
- circuit breaker thresholds/cooldown.
- customer IP policy.
- API version profile بدلاً من endpoints حرة.

## APIs

- settings عبر revisions.
- `POST /store-api/validate`: health endpoint أو GET منتجات محدود وحساب غير مؤثر.
- `GET /store-api/status`: URL منقح، آخر نجاح/فشل، latency، circuit، active revision.
- reset circuit محمي.

## fallback

```text
managed active connection profile
-> env API_BASE_URL/CUSTOMER_IP + built-in timeouts
-> built-in base URL الحالي عند غياب env
```

إذا managed URL تفشل runtime بعد threshold، ننتقل إلى last-known-good/env فقط عندما تكون policy تسمح ولا يسبب ذلك كتابة مكررة. لا نعيد `createOrder` على endpoint آخر تلقائياً بعد نتيجة مجهولة.

## Validation

- URL HTTPS في production، ولا credentials داخل URL.
- منع loopback/private targets عند عدم السماح الصريح لتقليل SSRF.
- health/read-only contract response shape.
- التأكد من API version والحقول الأساسية.
- auth test منقح.

## العمليات ذات الأثر الجانبي

- `createOrder` يحتاج idempotency key مشتقة من order intent ثابتة، محفوظة قبل الاتصال.
- timeout بعد إرسال request حالة `unknown`؛ نستعلم عن النتيجة أو نعيد بنفس idempotency key، لا ننشئ key جديدة.
- payment initiation بنفس المبدأ.
- تغيير base URL لا يطبق على workflow بدأ على revision قديمة؛ pin connection profile طوال العملية.

## حالات الفشل

- validation endpoint down: draft تظل غير مفعلة.
- active endpoint down: stale catalog للقراءة؛ checkout يتوقف بأمان إذا لا يمكن ضمان عدم التكرار.
- managed auth 401: env auth fallback فقط قبل side effect أو وفق idempotent retry.
- response schema drift: circuit/degraded، لا cast إلى `any` والمرور.

## الاختبارات ومعايير القبول

- fake server لكل error class.
- managed/env/default resolution.
- SSRF/URL validation.
- لا duplicate orders تحت timeout.
- لا أسرار أو بيانات طلب كاملة في logs.
- تغيير profile لا يقسم workflow واحدة بين endpoints.
- API down لا يمنع الردود غير المعتمدة على المتجر.
