# ميزة التشغيل والمراقبة والسجلات

## موضعها في الخطة

يأخذ V1 منها observability الضرورية للـControl Plane فقط: active revision، sources، degraded state، audit، وredaction. إدارة log/restart/status/PM2/ports/DB path وjobs كلها `بعد V1` أو bootstrap في `.env`.

## الوضع الحالي

يوجد Status API جديد للحالة وQR/SSE، logger بسيط، auto restart كل 30 دقيقة افتراضياً، وإعداد PM2. بعض القيم في env وبعضها مدمج. السجلات قد تحتوي PII ومعاملات tools.

## الهدف

- إدارة الإعدادات التشغيلية المناسبة عبر API.
- عرض configured/effective/pending/degraded بوضوح.
- إضافة metrics/audit/redaction دون كشف QR أو secrets أو PII.
- إبقاء Status API الحالية متوافقة.

## الإعدادات المدارة

القوائم التالية roadmap بعد V1 وليست writable في Control Plane Lite.

### Dynamic

- log level، مع redaction دائماً.
- auto-restart interval/disabled.
- drain timeout.
- status heartbeat وQR stale advisory.
- metrics sampling/retention.

### Restart/bootstrap

- status/control bind host/port.
- database path.
- process manager settings.

هذه تبدأ env-first في الإصدار الأول لأن API لا تستطيع التحكم في المنفذ المطلوب لتشغيلها قبل أن تبدأ.

## APIs

- effective operational status.
- audit events paginated.
- jobs status.
- restart/reconnect operations لاحقاً بصلاحيات وidempotency.
- config impact يظهر pending restart.

## fallback

- dynamic settings: managed -> env إن وجد -> constants الحالية.
- bind/auth bootstrap: env -> safe local defaults، ولا تعتمد على DB.
- فشل Control API server: WhatsApp يبقى شغال ويظهر component degraded في Status API إن أمكن.
- فشل Status API لا يوقف bot في policy مقترحة، إلا إذا deployment readiness تحتاج خلاف ذلك بقرار صريح.

## فصل الـAPIs

- `/health` liveness بسيطة.
- Status endpoints للمراقبة وQR.
- `/api/control/v1` للإدارة.
- tokens/scopes منفصلة.
- QR credential لا يظهر في Control API أو audit.

## Logging

إنشاء logger structured يدعم:

- request/correlation IDs.
- redaction paths للأسماء والهواتف والعناوين والemails وtokens وAPI keys وfunction args.
- Error serialization آمنة بدلاً من `{}`.
- sampling للأحداث المتكررة.
- عدم تخزين message bodies افتراضياً في production.

## Metrics المقترحة

- message received/success/failure/latency.
- queue depth/timeouts.
- provider failures/fallback source/circuit state.
- Store API latency/error class.
- order workflow states/reconciliation دون PII.
- catalog age/refresh.
- config activations/rollbacks/validation failures.
- active SSE/control clients ضمن حدود.

## restart operation

1. يتحقق من pending revision.
2. يمنع restart أخرى.
3. يوقف قبول عمليات side effect جديدة.
4. ينتظر drain.
5. يغلق WhatsApp/status/DB.
6. يطلب من process manager restart.
7. النسخة الجديدة تؤكد effective revision.
8. health failure يؤدي deployment rollback أو تعطيل revision.

## الاختبارات ومعايير القبول

- لا PII/secrets/QR في logs/audit/control responses.
- تغيير log level فوري ولا يعيد logger singleton بطريقة مكسورة.
- Control API down لا يوقف الرسائل.
- pending restart ظاهر بدقة.
- restart single-flight وdrain مجرب.
- Status API routes الحالية لا تنكسر.
