# الأمان وقاعدة البيانات والـAPIs

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17

## الأسرار والبيانات الحساسة

تُعامل العناصر التالية كcredentials أو بيانات حساسة:

- Gemini/Store API keys وbearer tokens وmaster keys.
- WhatsApp QR وLocalAuth/session files.
- phone numbers، emails، addresses، message bodies، order/payment payloads.
- raw provider errors إذا احتوت headers/request bodies.

### قواعد ملزمة

- ممنوع commit أو log أو audit أو response أو fixture أو screenshot لأي secret حقيقية.
- لا تقرأ secret لعرضها للمستخدم أو تعيد نشرها في تقرير Agent.
- إذا اكتشفت secret متعقبة: أوقف النطاق المتأثر، بلغ بوجود التسريب دون طباعة القيمة، واطلب/نفذ rotation حسب الصلاحية.
- `.env.example` placeholders فقط، ولا أرقام إدارية حقيقية.
- QR لا تدخل Control API أو audit أو persistent logs.
- secret GET يعيد metadata/fingerprint فقط.
- comparison للtokens timing-safe.
- encryption key لا تخزن في نفس DB المشفرة.

## المصادقة والصلاحيات

- authorization يطبق في service/application layer، لا يعتمد على prompt أو dashboard hiding.
- deny by default عند فشل identity/permission checks.
- scopes منفصلة للقراءة والكتابة والتفعيل والأسرار والعمليات والحظر والـaudit.
- bootstrap token لا يمر في query string.
- public bind يحتاج token قوي وTLS/reverse proxy موثق وCORS مقيد.
- Status API وControl API auth منفصلتان في V1.
- WhatsApp admin identity لا تمنح Control API scopes تلقائياً.

## HTTP API rules

- كل API جديدة versioned وتحت base path واضح.
- parse size limits وcontent type وmethod validation وrequest IDs.
- mutating operations تحتاج audit وreason حيث يلزم.
- concurrency عبر ETag/expected revision للتكوين.
- idempotency للـPOST/PUT ذات الأثر الجانبي.
- validation لا ينفذ order/payment/message أو أي side effect حقيقية.
- لا يعاد raw stack في production.
- rate limit للواجهة الإدارية منفصل عن rate limit العملاء.
- liveness لا تساوي readiness؛ ولا تجعل Control API failure readiness الخاصة بالبوت تفشل.

## Status API الحالية

- routes الحالية وQR/SSE عقد production؛ أي تغيير يحتاج compatibility tests.
- `/health` لا يحتوي تفاصيل حساسة.
- QR endpoints تعامل كcredential endpoints حتى لو كان token اختيارياً حالياً.
- ممنوع دمج Control API router/auth فيها في V1.
- لا توسع CORS إلى `*` مع credentials أو إدارة حساسة.

## قاعدة البيانات

### migrations

- migrations versioned وadditive في compatibility releases.
- ممنوع `DROP`, `RENAME`, destructive rewrite أو backfill واسع بلا خطة حرجة وموافقة وbackup/restore.
- جداول Control Plane تحمل prefix `control_`.
- migration الأولى opt-in ولا تعمل مع flags مغلقة.
- backup SQLite متوافق مع WAL قبل migration، لا نسخ الملف الرئيسي وحده أثناء الكتابة.
- فشل migration يعيد transaction ويعطل feature الجديدة فقط.
- binary القديمة يجب أن تتجاهل الجداول الجديدة وتعمل على DB نفسها.

### transactions والبيانات

- config revision values + active pointer + audit تكتب atomically.
- لا partial activation.
- parameterized statements فقط.
- repositories مسؤولة عن row mapping؛ لا `as any` لنقل rows إلى domain.
- cleanup/retention batch-based وقابل للاستئناف مع dry-run قبل حذف حقيقي.
- لا تخزن secret plaintext أو message/order payload في audit.

### النسخ والاختبارات

- tests تستخدم temporary DB منفصلة.
- production-derived fixtures مجهلة الهوية.
- upgrade/downgrade على قاعدة قديمة جزء من release gate.
- `PRAGMA quick_check` وفحص مساحة وschema version قبل migration الإنتاجية.

## الاتصالات الخارجية

- timeout لكل request.
- retries للقراءة/idempotent operations فقط.
- write timeout قد يعني outcome مجهولة؛ لا تعاود order/payment دون reconciliation.
- TLS verification لا يعطل.
- URL/host configuration تتحقق قبل تفعيلها، ولا تسمح schemes غير آمنة.
- errors تصنف وتنقح قبل log/API.

## التشفير

- primitives قياسية ومدققة فقط؛ لا خوارزمية مخصصة.
- encrypted SQLite provider يستخدم authenticated encryption وnonce عشوائي وversioned key ID.
- threat model يذكر صراحة أن host compromise الكامل يستطيع الوصول إلى master key وقت التشغيل.
- rotation وفقد المفتاح والbackup restore لها runbooks واختبارات قبل secret writes production.

## أشياء ممنوعة أمنياً

- `console.log` لconfig/headers/request/provider response كاملة.
- تخزين Authorization header أو QR أو plaintext secret في audit.
- `eval`, dynamic code execution، أو shell مبني من user/config input.
- wildcard admin/CORS/public bind كافتراضي.
- fail-open في authorization.
- validation endpoint تنفذ side effects.
- حذف آخر break-glass path دون خطة recovery.

