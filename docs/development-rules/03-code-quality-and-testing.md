# جودة الكود والاختبارات

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17

## TypeScript

- يحافظ المشروع على `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, و`noFallthroughCasesInSwitch`.
- ممنوع تعطيل compiler flags لتسهيل تغيير.
- ممنوع إضافة `any`, `@ts-ignore`, أو type assertion مزدوجة لتجاوز خطأ دون سبب موثق واختبار boundary.
- البيانات الخارجية تبدأ `unknown` وتتحقق قبل التحويل.
- استخدم discriminated unions للحالات وtyped error/result عندما يوضح العقد.
- لا non-null assertion على بيانات runtime إلا بعد guard واضح.
- القيم والوحدات تظهر في الأسماء (`timeoutMs`, `retentionDays`).

## الأخطاء والسجلات

- لا catch صامتة إلا في مسار shutdown أخير ومع تعليق يوضح السبب.
- صنف أخطاء provider إلى validation/auth/rate-limit/timeout/network/server/unknown عند الحاجة.
- الرسالة العامة لا تكشف raw response أو request payload.
- لا تسجل message bodies أو phone/email/address/order payload أو tokens أو QR أو secrets.
- كل fallback يجب أن ينتج health/metric/audit مناسباً دون طباعة القيمة الحساسة.
- لا تقل “نجحت العملية” قبل تحقق الأثر، خصوصاً order/payment/config activation.

## async والتزامن

- كل Promise إما `await` أو يعالج رفضها صراحة مع سبب fire-and-forget.
- كل network/browser/DB wait قابل للتعليق يحتاج timeout وسياسة إلغاء/late completion واضحة.
- `Promise.race` وحدها لا تلغي العملية الأصلية؛ side effects المتأخرة يجب منعها أو ربطها token/state.
- timers تحفظ handles وتوقف في shutdown؛ استخدم `unref()` للـtimers غير المانعة عندما يكون ذلك صحيحاً.
- لا retry لعملية كتابة إلا مع idempotency/reconciliation.
- لا تنفذ order/payment/admin side effects بالتوازي من model tool calls.
- التحديث المشترك atomically أو تحت lock/transaction مناسب، لا سلسلة assignments قابلة للرؤية جزئياً.

## قواعد الاختبارات

### بوابة تأسيسية

لا توجد منظومة tests حالياً. أول behavior implementation لـControl Plane يجب أن يضيف:

- test runner مدعوم لـTypeScript.
- script ثابت `npm test`.
- lockfile.
- temporary SQLite helpers.
- fake Gemini/Store API adapters.
- CI أو أمر موثق يشغل build + tests.

لا يسمح باستمرار تنفيذ Control Plane ثم تأجيل الاختبارات إلى النهاية.

المشروع يعتمد npm؛ `package-lock.json` يجب أن يكون متعقباً عند إنشائه. لا تخلط npm مع yarn/pnpm داخل release واحدة.

### ما يجب اختباره

- Unit: parsers، registry validators، fallback/source metadata، secret redaction، concurrency rules.
- Integration: SQLite migrations/repositories/transactions، activation/rollback، auth/idempotency.
- Contract: OpenAPI وStore API mappings باستخدام fake/sandbox.
- Compatibility: legacy `.env`/DB/defaults، no-op flags، upgrade/downgrade.
- Failure injection: DB busy، corrupt row، bad master key، port conflict، provider 401/429/timeout/5xx، process interruption.

### قواعد fixtures

- لا production dump خام.
- أي fixture مشتقة من production تُجهل الهوية وتراجع يدوياً ضد PII/secrets.
- secret canary وهمية تستخدم لاختبار عدم التسريب.
- الوقت والعشوائية وnetwork تكون قابلة للتحكم في unit tests.

### الاختبارات الخارجية

- CI لا تتصل بGemini أو WhatsApp أو Store API الحقيقي.
- connectivity tests الحقيقية manual/controlled ولا تنفذ tools أو orders/payments.
- QR/session files لا تدخل fixtures أو artifacts.

## أوامر التحقق

### حالياً

```bash
npm run build
```

لا يوجد `npm test` بعد؛ يجب ذكر ذلك صراحة، لا الادعاء أن tests مرت.

### بعد foundation

الحد الأدنى لكل code change:

```bash
npm ci
npm run build
npm test
```

التغيير docs-only يفحص الروابط والتنسيق ولا يحتاج build ما لم يلمس code/config/package.

## معايير خاصة بالتغييرات عالية الخطورة

- Config: كل صف في fallback matrix وحالات inherited/managed/reset.
- Secrets: responses/logs/audit/errors/crash-safe outputs لا تحتوي canary secret.
- DB: old DB -> migrate -> run -> rollback app version -> restore drill.
- APIs: auth، scopes، concurrency، idempotency، validation، redaction، status codes.
- WhatsApp: startup/reconnect/shutdown/session preservation/late sends.
- Orders/payments: duplicate prevention، unknown outcome، reconciliation، restart recovery.

## منع الاختبارات الشكلية

- لا test يكرر implementation دون اختبار outcome.
- لا snapshots ضخمة تخفي اختلافات مهمة.
- لا mocks لكل شيء بحيث لا يختبر wiring أو SQL.
- لا تخفض assertion أو تحذف test لإمرار build دون توثيق defect وقرار.
- flaky test defect يجب إصلاحه؛ لا يعاد تشغيل CI حتى ينجح عشوائياً كحل.
