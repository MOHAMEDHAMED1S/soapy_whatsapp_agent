# ميزة الـPrompts وسلوك المساعد

## موضعها في الخطة

نسخة محدودة منها هي أول pilot مفضل في `Control Plane Lite V1`: business prompt والهوية/النبرة/اللغة ورسائل بسيطة. workflow prompts أو admin prompt migration الكامل أو أي نص يغير authorization/order guardrails يؤجل أو يبقى code-owned.

## الوضع الحالي

System prompt ضخم مدمج داخل `GeminiService`، مع `admin_prompts` كنص واحد قابل للإضافة من WhatsApp. تعليمات المنتجات والأمان والطلب والتنسيق متداخلة، وبعض القواعد مكررة.

## الهدف

- إدارة المحتوى التجاري عبر API مع revisions تلقائية في الـbackend.
- إبقاء الـprompt الحالية fallback.
- فصل ما يجوز تعديله عما يجب أن يظل guardrail برمجياً.
- توفير preview وvalidation قبل التفعيل.

## التقسيم المقترح

1. `core_guardrails`: code-owned، versioned مع التطبيق، غير قابلة للاستبدال عبر API.
2. `business_policy`: الشحن، ساعات العمل، سياسات الاسترجاع، أسلوب التعامل.
3. `persona`: الاسم والنبرة واللغة.
4. `response_templates`: ترحيب، خطأ، unavailable، rate-limit.
5. `catalog_context`: مولد آلي من ProductService، وليس نصاً يكتبه admin.
6. `conversation/order_context`: مولد آلي من البيانات typed.

## ما يبقى guardrail

- authorization للأدوات الإدارية.
- confirmation وidempotency للطلب.
- منع ادعاء تنفيذ tool.
- عدم تنفيذ side effects بالتوازي.
- حدود حجم prompt والأدوات.
- redaction والسياسات الأمنية.

هذه القواعد تنفذ في code/tool policy حتى لو كان الـprompt التجاري مخالفاً.

## الإعدادات المدارة

### V1

- business prompt version.
- assistant display name/tone/language profile.
- optional welcome/help/error text.
- حدود طول business section ضمن سقف.
- template variables allow-list.

### لاحقاً

- formatting profiles مركبة لWhatsApp.
- migration كاملة للـadmin prompts والworkflow-specific prompts.

## APIs

- GET resources وhistory.
- PUT setting/namespace ينفذ validate-and-activate للتغييرات البسيطة.
- `POST /assistant/prompts/preview` يبني النسخة النهائية ببيانات وهمية منقحة.
- `POST /assistant/prompts/validate` يفحص الحجم والمتغيرات والعبارات التي تحاول تعطيل guardrails.

## fallback

```text
managed business prompt active وصالحة
-> admin prompt الحالية في SQLite إن وجدت
-> النص التجاري الحالي المدمج
```

core guardrails دائماً من الكود. فشل template rendering يسقط هذا الجزء فقط إلى fallback ولا يسقط الرسالة.

## التعديلات البرمجية

- استخراج `PromptComposer` من GeminiService.
- استخدام sections typed بدلاً من template عملاق.
- version hash يظهر في AI status/audit.
- تحديث `AdminPromptService` ليصبح legacy adapter ثم migration source، مع إبقاء WhatsApp admin functions مؤقتاً.
- عدم تضمين معلومات الطلب إلا من object validated.

## المخاطر

- prompt injection من admin content.
- تضخم context والتكلفة.
- تعارض business prompt مع catalog أو country policy.
- تغيير اللغة أو الرسائل في منتصف محادثة.

المعالجة: sanitization منطقي، size limits، preview، conversation pinning للrevision عند العمليات الحساسة، وguardrails خارج النص.

## الاختبارات ومعايير القبول

- fallback إلى admin prompt الحالية ثم hard-coded.
- business prompt لا تستطيع منح صلاحية admin أو تجاوز confirmation.
- preview لا يحتوي بيانات عملاء حقيقية.
- invalid variables ترفض قبل activation.
- prompt version ثابت داخل دورة order واحدة أو موثق إذا تغير.
- غياب managed prompt لا يغير الردود الحالية إلا الفروق المسموح بها.
