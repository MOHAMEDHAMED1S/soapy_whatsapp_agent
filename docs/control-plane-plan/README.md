# خطة طبقة التحكم والإعدادات الديناميكية

## الهدف

تهدف هذه الحزمة إلى نقل الإعدادات القابلة للتغيير تدريجياً من القيم المدمجة في الكود وملف `.env` إلى طبقة تحكم محلية يمكن إدارتها عبر APIs وربطها بلوحة تحكم لاحقاً، مع الحفاظ الكامل على السلوك الحالي كمسار fallback دائم.

هذه مرحلة تخطيط فقط. لا تقترح الخطة استبدال النظام الحالي دفعة واحدة، ولا تجعل معالجة رسائل WhatsApp معتمدة على توفر Control API.

الإصدار الأول متعمد أن يكون صغيراً: AI model/key، المحتوى التجاري للـprompt، مجموعة محدودة من rate limits، وبعض إعدادات الكتالوج. بقية الملفات تمثل roadmap لاحقة ولا تعني أن جميع المجالات ستنفذ في الإصدار الأول. المرجع الملزم للنطاق هو [Control Plane Lite V1](11-control-plane-lite-v1.md).

قبل أي implementation يجب اتباع [AGENTS.md](../../AGENTS.md) و[قواعد التطوير](../development-rules/README.md)، وبالأخص بوابة الاختبارات والـlockfile وقواعد no-op upgrade.

## القرار المعماري الأساسي

Control API هو واجهة كتابة وقراءة للإعدادات، وليس dependency وقت تنفيذ الرسائل:

```text
Dashboard لاحقاً
      |
      v
Control API ---> تحقق + تخزين + Audit + Activation
                         |
                         v
                 Effective Config Snapshot
                         |
       +-----------------+-----------------+
       |                 |                 |
    WhatsApp          Gemini          Store API

Resolution fallback لكل قيمة:
Managed active valid value -> .env -> built-in default

Runtime continuity:
current in-memory snapshot + feature-specific last-known-good resource
ثم rollback صريحة إلى revision سابقة عند الحاجة
```

إذا توقفت واجهة التحكم، يستمر البوت باستخدام الـsnapshot الموجود. وإذا فشل إعداد أثناء validation لا يتم تفعيله. وإذا تعذر قراءة managed value عند startup يستخدم `.env` ثم default الحالي. أما الفشل الخارجي بعد التفعيل فيطبق fallback الخاصة بالميزة ويظهر degraded حتى rollback أو معالجة السبب.

## قيم البداية الخاصة بكل متجر

بعد التحديث لا تبدأ الـdashboard أو API بقيم عامة فارغة. يبني النظام تلقائياً `Inherited Legacy Baseline` لكل installation من القيم التي يعمل بها المتجر حالياً:

```text
قيمة .env الخاصة بالمتجر إن وجدت
-> قيمة legacy موجودة في قاعدة البيانات إن كانت الميزة تستخدمها
-> القيمة الحالية المدمجة في نسخة الكود
```

تظهر هذه القيم في `GET /settings/effective` مع مصدرها، وتستخدم فعلياً دون أن يضطر المتجر إلى حفظها مرة أخرى. لا تنسخ الأسرار إلى الجداول الجديدة؛ يظهر فقط أنها configured ومصدرها `env`. أول managed revision تخزن overrides التي غيّرها المشغل فقط، وبقية القيم تظل موروثة من إعدادات المتجر الحالية.

## محتويات الخطة

### الأساس المشترك

- [المبادئ والنطاق](00-principles-and-scope.md)
- [المعمارية وسلسلة fallback](01-architecture-and-fallback.md)
- [سجل الإعدادات وتصنيفها](02-configuration-registry.md)
- [عقود APIs والأمان](03-api-contracts-and-security.md)
- [كتالوج الـAPIs المقترح](04-api-catalog.md)
- [مراحل التنفيذ والترحيل](05-implementation-phases.md)
- [الاختبارات والنشر والـrollback](06-testing-rollout-and-rollback.md)
- [مصفوفة تتبع القيم الحالية](07-current-to-managed-mapping.md)
- [القرارات المفتوحة والقيود](08-decisions-and-boundaries.md)
- [مخرجات التوثيق المطلوبة أثناء التنفيذ](09-documentation-deliverables.md)
- [عقد أمان الترقية لمستخدمي Production الحاليين](10-production-upgrade-compatibility.md)
- [النطاق التنفيذي للإصدار الأول Control Plane Lite](11-control-plane-lite-v1.md)
- [القرارات الناتجة عن تقرير مراجعة الخطة](12-review-decisions.md)

### خطط الميزات

- [مزود الذكاء الاصطناعي والموديلات والمفاتيح](features/01-ai-models-and-api-keys.md)
- [الـprompts وسلوك المساعد](features/02-prompts-and-assistant-behavior.md)
- [تكامل Store API والمرونة](features/03-store-api-and-resilience.md)
- [تشغيل WhatsApp والمتصفح](features/04-whatsapp-runtime.md)
- [معالجة الرسائل والـrate limiting والحظر](features/05-message-processing-rate-limits-and-blocking.md)
- [كتالوج المنتجات والكاش](features/06-product-catalog.md)
- [الطلبات والدفع وقواعد العمل](features/07-orders-payments-and-business-rules.md)
- [التشغيل والمراقبة والسجلات](features/08-operations-observability.md)
- [الإداريون والصلاحيات](features/09-admins-and-access-control.md)
- [المحادثات والخصوصية والاحتفاظ بالبيانات](features/10-conversations-privacy-and-retention.md)

## قواعد ملزمة لكل ميزة

كل ملف ميزة يحدد:

1. الوضع الحالي ومكان القيم المدمجة.
2. الإعدادات التي ستصبح قابلة للإدارة.
3. APIs المقترحة.
4. ترتيب fallback الدقيق.
5. طريقة التحقق قبل التفعيل.
6. هل التطبيق فوري أم يحتاج restart.
7. حالات الفشل والـrollback.
8. الاختبارات المطلوبة ومعايير القبول.

كما يحدد هل الميزة داخل V1 أم roadmap، وما الشروط السابقة التي تمنع تقديمها مبكراً.

## تعريف النجاح

تعتبر طبقة التحكم ناجحة عندما:

- يعمل المشروع دون أي إعدادات مُدارة كما يعمل اليوم.
- حذف قاعدة بيانات الإعدادات أو تعطل Control API لا يمنع بدء البوت إذا كانت قيم `.env` الحالية صالحة.
- لا يصبح أي secret قابلاً للقراءة من API أو السجلات.
- لا يؤدي تحديث جزئي إلى snapshot نصف محدث.
- يمكن معرفة القيمة الفعالة ومصدرها دون كشف قيم حساسة.
- يمكن الرجوع إلى revision سابق بسرعة.
- تغطي الاختبارات مسارات managed و`.env` وdefault والفشل لكل ميزة.
- لا يدفع V1 تكلفة بنية restart/jobs/multi-instance التي لا يحتاجها نطاقه.

## الضمان المطلوب لأول تحديث

أول إصدار يحتوي طبقة التحكم يجب أن يكون `no-op upgrade` افتراضياً. إذا حدّث بائع المشروع ولم يضف أي إعداد جديد، يجب أن يعمل التطبيق بنفس `.env` ونفس قاعدة البيانات ونفس المنافذ والسلوك الحالي. لا تنشأ جداول Control Plane ولا يبدأ Control API ولا تستخدم managed values إلا بعد تفعيل صريح. التفاصيل والـrelease gates موجودة في [عقد أمان الترقية](10-production-upgrade-compatibility.md).

## ما لن نفعله في أول إصدار

- لن نجعل البوت يجلب الإعدادات عبر HTTP عند كل رسالة.
- لن نسمح بتعديل guardrails الأمنية الأساسية عبر prompt حر.
- لن ننقل bootstrap secrets اللازمة لفك تشفير بقية الأسرار إلى نفس قاعدة البيانات.
- لن نجمع Status API وControl API في الإصدار الأول. يعمل Control API كسيرفر محلي مستقل، ويمكن وضعهما خلف gateway واحدة لاحقاً دون دمج الصلاحيات أو العقود.
- لن نحذف دعم `.env` أو القيم الحالية قبل اجتياز اختبارات التكافؤ والـrollback.
- لن نجعل Store API أو WhatsApp/Puppeteer أو DB/ports/PM2 أو checkout/payment أو retention إعدادات مُدارة في V1.
- لن نفرض دورة draft يدوية للتعديل البسيط؛ endpoint المختصر ينفذ validate-and-activate مع revision وaudit داخل الـbackend.
