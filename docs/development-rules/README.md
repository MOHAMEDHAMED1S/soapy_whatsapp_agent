# قواعد تطوير المشروع

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17
**النطاق:** جميع التغييرات البرمجية والتوثيقية وقواعد البيانات والـAPIs

## الغرض

هذه الحزمة هي المرجع التشغيلي لطريقة تطوير `soapy_whatsapp_agent`. الهدف هو حماية installations الموجودة في production، ومنع التغييرات غير القابلة للرجوع، وإبقاء الكود والتوثيق متسقين أثناء بناء Control Plane وما بعدها.

ملف [AGENTS.md](../../AGENTS.md) هو نقطة الدخول الإلزامية لأي Agent. هذه الملفات تحتوي التفاصيل التي يجب الرجوع إليها حسب نوع المهمة.

## ترتيب القراءة

1. [حالة المشروع الحالية](00-project-state.md).
2. [طريقة التطوير وإدارة التغيير](01-development-workflow.md).
3. [حدود المعمارية والملفات](02-architecture-and-file-boundaries.md).
4. [جودة الكود والاختبارات](03-code-quality-and-testing.md).
5. [قواعد التوثيق](04-documentation-rules.md).
6. [الأمان وقاعدة البيانات والـAPIs](05-security-database-and-apis.md).
7. [قواعد تنفيذ Control Plane](06-control-plane-implementation-guardrails.md) لأي عمل متعلق بالإعدادات أو الـdashboard APIs.
8. [المراجعة والنشر وGit](07-release-review-and-git.md).

## القوالب الملزمة

- [قالب خطة تغيير](templates/change-plan-template.md) للتغييرات المتوسطة والعالية والحرجة.
- [قالب خطة ميزة](templates/feature-plan-template.md) لأي ميزة جديدة.
- [قالب ADR](templates/adr-template.md) للقرار المعماري أو الأمني طويل الأثر.
- [قائمة تحقق إصدار](templates/release-checklist.md) قبل canary أو production release.

## قوة القواعد

- `يجب/ممنوع` قاعدة ملزمة، ولا يجوز تجاوزها بصمت.
- `يفضل` توجيه يمكن مخالفته مع سبب موثق في خطة التغيير.
- أي استثناء لقاعدة ملزمة يحتاج موافقة صريحة من صاحب المشروع وADR يوضح السبب والمخاطر والرجوع، ما لم تكن تعليمات أعلى سلطة تفرض غير ذلك.
- إذا تعارض مستند تاريخي مع هذه القواعد أو الكود الحالي، لا يُختار تفسير عشوائي؛ يسجل التعارض ويُحسم قبل التنفيذ.

## مصادر الحقيقة

| المجال | المصدر الأساسي |
| --- | --- |
| طريقة عمل Agents | `AGENTS.md` وهذه الحزمة |
| السلوك الموجود الآن | الكود الحالي + characterization tests |
| نطاق Control Plane | `docs/control-plane-plan/11-control-plane-lite-v1.md` |
| أمان الترقية | `docs/control-plane-plan/10-production-upgrade-compatibility.md` |
| عقود API المنفذة | OpenAPI versioned عند إنشائها؛ وإلى ذلك الوقت الكود والتوثيق المتزامن |
| إعدادات Control Plane | Configuration Registry عند تنفيذها |
| قاعدة البيانات | migrations versioned، وليس وصف README وحده |
| القرارات المعمارية | ADRs المعتمدة |

تقارير التدقيق والمراجعة تسجل سياقاً مهماً لكنها ليست دليلاً تلقائياً أن الكود ما زال يطابقها. يجب التحقق من التنفيذ الحالي.

