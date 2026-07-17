# ميزة معالجة الرسائل والـRate Limits والحظر

## موضعها في الخطة

يدخل V1 منها نطاق صغير فقط: ثلاثة rate-limit settings بعد إصلاح limiter، وblock list CRUD بعد authorization/normalization. queue، concurrency، processing timeout، media، auto-block policy، وretention كلها `بعد V1`.

## الوضع الحالي

`MessageHandler` يملك Map للـPromises وليس queue حقيقية، وحدود الوسائط والمهلة والسعة مدمجة. `RateLimiterService` يمزج نافذة زمنية تقريبية مع SQLite، والحظر يُدار من خدمات ودوال Gemini مع فجوة authorization حالية.

## الهدف

- بناء queue صحيحة لكل conversation قبل جعل حدودها ديناميكية.
- إدارة سياسات الرسائل والوسائط والrate limits والحظر عبر API.
- إبقاء env/constants الحالية fallback.
- فرض authorization خارج Gemini.

## التعديلات البرمجية

1. `ConversationQueueManager` بصف مستقل لكل chat وحد global concurrency.
2. queue depth حقيقية وbackpressure policy.
3. cancellation/timeout token يمنع الرد المتأخر، وليس فقط تنظيف Map.
4. sliding-window/token-bucket limiter صحيح ومختبر.
5. `BlockingService` يطبع الأرقام canonical ويجعل كل عمليات الحظر audited.
6. Tool authorization middleware قبل `executeFunction`.

## الإعدادات المدارة

### Messaging

بعد V1 فقط:

- per-chat queue depth وglobal concurrency.
- processing timeout.
- overload behavior ورسالة آمنة.
- stored/AI history limits.
- media allowed types/max bytes/download timeout.

### Rate limits

- V1: max per minute/window وحجم النافذة.
- لاحقاً: burst allowance، suspicious/auto-block thresholds، auto-block duration/manual review، وcleanup/retention.

توجد code-owned minimum/maximum تمنع تعطيل الحماية أو ضبطها على قيم تحظر الجميع بالخطأ.

## APIs

- settings عبر validate-and-activate PUT مع revision داخلية.
- status aggregates دون أرقام عملاء افتراضياً.
- blocks list/create/delete مع scopes.
- reset limiter فردي audited.
- يمكن إضافة dry-run policy endpoint يحاكي timestamps وهمية.

## fallback

- rate config: managed -> RATE_LIMIT env -> defaults الحالية.
- messaging/media: managed -> constants الحالية.
- blocks نفسها بيانات تشغيل موجودة في DB وليست setting؛ تعطل Control API لا يلغي القائمة.
- فشل limiter DB يستخدم fallback in-memory محدود وآمن كما هو مقصود، مع metric واضح.

## activation

- policy object كاملة atomically، لا تحديث threshold منفرد يخلق تناقضاً.
- الرسائل الموجودة في الصف تكمل بسياسة snapshot التي دخلت بها أو سياسة موثقة؛ الجديدة تستخدم الجديدة.
- تقليل queue limit لا يحذف queued messages فجأة؛ يدخل drain mode.

## الحظر والصلاحيات

- `block_number`, `unblock_number`, `list_blocked_numbers` تتطلب permission برمجية.
- model لا يقرر هل المستخدم admin.
- normalize `+`, `00`, `@c.us`, `@lid` ضمن هوية مدروسة؛ LID يحتاج mapping موثوق ولا يساوى برقم الهاتف بلا دليل.
- env admins break-glass لا يعني أن كل أدواتهم بلا audit.

## حالات الفشل

- setting شديدة الانخفاض: ترفض validation أو تتطلب force scope وreason.
- DB unavailable: fallback limiter + no loss للحظر المعروف إذا cache متاح.
- timeout: abort downstream وإسقاط أي late send.
- queue full: رد واحد مضبوط/صامت حسب policy، دون إنشاء آلاف timers.

## الاختبارات ومعايير القبول

- ثلاث رسائل متزامنة لنفس الهاتف تنفذ بالترتيب دائماً.
- هواتف مختلفة تستفيد من concurrency المحددة.
- timeout لا يرسل رد متأخراً.
- sliding-window tests بساعة وهمية.
- غير-admin لا يستطيع block/unblock حتى مع prompt injection.
- managed invalid config تعود إلى env/default.
- تغيير policy تحت load لا يفقد رسائل.
