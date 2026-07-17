# ميزة المحادثات والخصوصية والاحتفاظ بالبيانات

## موضعها في الخطة

هذه الميزة `بعد V1` لأن مدد الحذف تحتاج قرارات قانونية وعمليات cleanup قابلة للاستئناف. V1 يطبق redaction minimum على logs/audit كguardrail فقط، ولا يغير بيانات المحادثات أو retention الحالية.

## الوضع الحالي

المحادثات والطلبات محفوظة كـJSON plaintext في SQLite، وتحتفظ المحادثة بآخر 30 رسالة. لا توجد retention jobs أو encryption-at-rest application layer أو redaction شاملة للسجلات.

## الهدف

- إدارة سياسات الاحتفاظ والـredaction عبر API ضمن حدود قانونية وأمنية.
- عدم إتاحة بيانات العملاء الخام من Control API العام.
- إبقاء السلوك الحالي fallback حتى تعتمد سياسة جديدة.
- فصل operational metadata عن محتوى الرسائل.

## الإعدادات المدارة

- max stored messages.
- conversation retention days.
- completed/pending order local retention وفق الحاجة القانونية.
- rate tracking/audit retention.
- log content/redaction policy، مع حد أدنى آمن لا يمكن تعطيله.
- media persistence policy؛ حالياً لا تحفظ media نفسها.
- optional encryption-at-rest profile مستقبلاً.

## APIs

- settings عبر revisions.
- privacy status يعرض policy وnext cleanup وcounts aggregates.
- cleanup dry-run/job محمي.
- لا نضيف browse conversation content إلى Control API في الإصدار الأول.
- عمليات حذف/تصدير فردية، إن أضيفت، تحتاج API منفصلة وصلاحيات قوية وتدقيقاً خاصاً.

## fallback

- max messages: managed -> 30 الحالي.
- retention غير محددة: legacy no-auto-delete مؤقتاً، مع warning واضح؛ لا نفترض حذف بيانات دون قرار business/legal.
- redaction: safe built-in minimum دائماً، ثم managed stricter policy. لا fallback يسمح بكشف secrets.
- Control API down لا يوقف cleanup scheduler أو يغير السياسة active.

## التعديلات البرمجية

1. typed columns أو normalized tables تدريجياً بدلاً من الاعتماد الكامل على JSON `any`.
2. migrations versioned.
3. cleanup jobs batch-based لا تقفل SQLite طويلاً.
4. logger redaction قبل serialization.
5. فصل phone display عن canonical identifier، وإخفاؤه في metrics.
6. audit لا يخزن message/order payload.

## الأمان والخصوصية

- secret values وQR لا تدخل قاعدة المحادثات.
- customer phone/email/address لا تظهر في status.
- backups تدخل ضمن threat model وسياسة التشفير.
- حذف conversation لا يحذف order مطلوب قانونياً دون policy واضحة.
- أي encryption key يبقى bootstrap/secret manager، وليس في نفس DB.

## حالات الفشل

- cleanup يفشل: يسجل job failure ويعيد المحاولة بحدود، ولا يحذف جزئياً دون checkpoints.
- retention setting غير صالحة: رفض activation.
- تقليل retention بشدة: preview count + optional approval قبل activation.
- schema قديمة: legacy repository يستمر حتى migration ناجحة.

## الاختبارات ومعايير القبول

- no PII في status/metrics/audit.
- cleanup boundaries/timezones صحيحة وبـbatch.
- managed invalid ترجع إلى legacy ولا تحذف بيانات.
- redaction لا يمكن تعطيلها بالكامل.
- migration من قاعدة حالية مع conversations/orders ناجحة وقابلة للrollback additive.
- backup/restore drill يحافظ على revisions والسياسة دون كشف keys.
