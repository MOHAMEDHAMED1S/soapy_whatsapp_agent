# ميزة الطلبات والدفع وقواعد العمل

## موضعها في الخطة

هذه الميزة `بعد V1` بالكامل. لا تصبح countries/payment/confirmation/retry settings قابلة للكتابة قبل بناء الـstate machine وidempotency وreconciliation الواردة هنا. يظل السلوك الحالي fallback ولا تغيّره طبقة التحكم الأولى.

## الوضع الحالي

تجميع الطلب والتأكيد يعتمدان بدرجة كبيرة على System Prompt. `create_order` يعيد حساب الإجمالي ثم ينشئ الطلب، يختار أول طريقة دفع تلقائياً، ويحاول حفظ النتيجة محلياً. countries وguest email وسياسات retry والرسائل مدمجة ومتكررة.

## الهدف

- تحويل checkout إلى workflow deterministic يمكن ضبط قواعده دون ترك الأمان للنموذج.
- إدارة الدول وسياسات الدفع والخصم عبر APIs.
- منع duplicate orders والدفع المتكرر.
- إبقاء القواعد الحالية fallback حيث تكون آمنة.

## شرط مسبق

لا نجعل order retry أو confirmation اختيارية قبل إضافة:

- `OrderIntent` محفوظة.
- state machine صريحة.
- server/client idempotency key.
- confirmation token مرتبط بملخص محدد.
- فصل read-only tools عن side-effect tools.

## OrderWorkflow المقترح

```text
collecting
-> pricing
-> awaiting_confirmation(summaryHash)
-> creating(idempotencyKey)
-> created
-> payment_pending
-> completed / failed / needs_reconciliation
```

Gemini يقترح extraction أو next action، لكن workflow يتحقق من الانتقال والحقول والصلاحيات.

## الإعدادات المدارة

- supported countries وأسماؤها/currency metadata من مصدر موحد.
- required/optional customer fields.
- guest email.
- confirmation wording/expiry، مع `required=true` guardrail أولاً.
- discount enabled/validation policy.
- payment selection: ask_customer/fixed/auto_if_single.
- fixed/default payment method إذا اختيرت strategy مناسبة.
- order/payment timeouts وreconciliation policy.
- retry فقط عندما idempotent.

## APIs

- settings عبر revisions.
- `GET /checkout/policy` يعرض effective policy دون بيانات عملاء.
- `POST /checkout/policy/validate` cross-field فقط.
- payment methods cache/status read-only.
- لا يستخدم Control API لإنشاء طلبات العملاء.

## fallback

- countries: managed validated list -> `SUPPORTED_COUNTRIES` الحالية.
- guest email: managed -> default الحالي.
- payment strategy: managed -> current “first method” مؤقتاً، ثم بعد الترحيل default أكثر أماناً `ask_customer` إذا اعتمد business ذلك.
- Store API unavailable: لا نحسب يدوياً ولا ننشئ طلباً؛ نحافظ على intent ونطلب المحاولة.
- Control API down: active policy snapshot مستمرة.

## تثبيت revision داخل workflow

عند بدء pricing نحفظ:

- checkout policy revision.
- Store API profile revision.
- catalog/pricing references اللازمة.
- summary hash.

تغيير dashboard لا يغير طلباً ينتظر تأكيداً بشكل صامت. إما يكمل بالpolicy القديمة خلال TTL أو يعاد تسعيره ويطلب تأكيداً جديداً.

## Idempotency والمصالحة

- key ثابتة لكل attempt منطقي، لا لكل HTTP retry.
- تخزن قبل network call.
- timeout يعطي state `unknown` لا `failed` مباشرة.
- reconciliation تستعلم عن الطلب قبل السماح بمحاولة جديدة.
- payment initiation لها key/state مستقلة.
- pending orders لا تعتمد على Map فقط؛ تخزن في DB.

## الأمان

- لا يمكن للprompt تعطيل التأكيد أو authorization.
- validation لا ينشئ order أو payment.
- لا تغير countries أو payment strategy دون reason/audit.
- settings الخطرة يمكن أن تتطلب two-person approval مستقبلاً؛ تصميم revisions يسمح بذلك.

## حالات الفشل

- policy managed غير صالحة: fallback إلى الحالية قبل بدء workflow.
- policy تتغير وسط الطلب: pin/require repricing.
- API timeout: reconciliation.
- DB save يفشل بعد remote success: durable outbox/pending record قبل call تقلل الفقد.
- payment methods فارغة: order يبقى created مع تعليمات واضحة، لا claim بإرسال رابط لاحق دون job.

## الاختبارات ومعايير القبول

- لا create دون confirmation matching summary hash.
- network retry لا ينشئ duplicate.
- تغيير price/country بعد confirmation يفرض تأكيداً جديداً.
- payment strategy transitions صحيحة.
- managed/env/default policy paths.
- restart أثناء `creating` تستعيد workflow وتعمل reconciliation.
- Gemini لا تستطيع تجاوز state machine.
