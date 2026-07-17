# طريقة التطوير وإدارة التغيير

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17

## تصنيف المخاطر

| المستوى | أمثلة | المتطلبات |
| --- | --- | --- |
| منخفض | توثيق، typo، refactor بلا behavior | فحص النطاق والروابط/build عند مس الكود |
| متوسط | service logic داخلية، types، logging منقح | خطة مختصرة، tests، build، توثيق متزامن |
| عالٍ | API contract، config/fallback، auth، WhatsApp lifecycle، DB additive، provider client | ملف خطة تغيير، characterization tests، rollback، failure injection، مراجعة أمنية |
| حرج | secrets، migrations تمس بيانات قائمة، orders/payments، session path، multi-process، destructive cleanup | ADR وموافقة صريحة وbackup/restore وupgrade/downgrade وcanary منفصل |

إذا تردد المطور بين مستويين يختار الأعلى.

## دورة العمل الإلزامية

### 1. حماية حالة العمل

- شغّل `git status --short` قبل أي تعديل.
- اعتبر كل تغيير موجود ملكاً للمستخدم، ولا تحذفه أو تعيد تنسيقه أو تدمجه بلا سبب.
- لا تستخدم reset/checkout/clean destructive.
- سجل الملفات التي ستلمسها وحدود المهمة.

### 2. اكتشاف السلوك الحالي

- اقرأ `AGENTS.md` وهذه القواعد والوثيقة الخاصة بالميزة.
- اقرأ consumer الفعلي ومصدر config وpersistence وstartup/shutdown المتصلين به.
- ابحث عن callers وsingletons وtimers وside effects، ولا تعتمد على اسم الملف وحده.
- قارن المستندات بالكود؛ المستند التاريخي ليس بديلاً عن الفحص.

### 3. تثبيت baseline

- اكتب characterization test قبل refactor أو تغيير fallback.
- للتغييرات docs-only سجل أن runtime لم يتغير.
- للتغيير الذي لا يمكن اختباره آلياً، وثق السبب وخطوات تحقق قابلة للتكرار؛ هذا استثناء مؤقت وليس بديلاً دائماً للاختبارات.

### 4. خطة التغيير

التغيير المتوسط فأعلى يستخدم [قالب خطة التغيير](templates/change-plan-template.md). يجب أن يحدد:

- المشكلة والهدف وout-of-scope.
- السلوك الحالي والجديد.
- الملفات والمسؤوليات.
- التوافق وfallback.
- data/API/security impact.
- test matrix وrollout وrollback.

أي قرار يغير حدود المكونات أو persistence أو auth أو contract طويل الأجل يحتاج [ADR](templates/adr-template.md).

### 5. التنفيذ على slices صغيرة

- افصل abstraction عن activation قدر الإمكان.
- أضف المسار الجديد خلف flag مغلقة قبل تحويل runtime إليه.
- لا تجمع dependency upgrade أو formatting واسع مع behavior change.
- لا تصلح مشكلات مجاورة غير لازمة؛ سجلها كعمل منفصل.
- كل commit منطقي يجب أن يكون buildable ومراجعاً، إذا طلب المستخدم commits.

### 6. التحقق

- نفذ أقل test يثبت التغيير ثم suite الأوسع المناسبة.
- شغل `npm run build` لكل تعديل TypeScript.
- شغل `npm test` بعد إضافة test harness.
- استخدم fake providers وtemporary SQLite، وليس production services/data.
- للتغيير عالي/حرج اختبر الفشل والrollback لا happy path فقط.

### 7. تحديث التوثيق

- حدّث docs/API/config/runbook في نفس التغيير.
- لا تكتب endpoint أو setting كمُنفذة وهي roadmap فقط.
- اذكر ما تحقق فعلاً وما لم يختبر.

### 8. التسليم

يجب أن يوضح handoff:

- النتيجة وسلوك المستخدم.
- الملفات المهمة.
- الاختبارات والأوامر ونتائجها.
- migrations/flags/config الجديدة.
- المخاطر أو العمل المتبقي.
- طريقة rollback.

## قواعد التخطيط

- لا يبدأ implementation من وثيقة واسعة مباشرة؛ اختر milestone واحدة ومعايير خروجها.
- لا تتجاوز شرطاً مسبقاً مكتوباً في feature plan.
- أي توسع في V1 يحتاج تعديل نطاق موثق قبل الكود.
- لا تعتبر “الكود يبني” دليلاً على التوافق أو أمان production.

## حالات التوقف الإلزامي

يتوقف التنفيذ ويطلب قراراً عندما:

- يلزم destructive migration أو حذف بيانات.
- يتغير external API contract أو order/payment behavior دون sandbox/owner decision.
- تظهر قيمة سرية متعقبة أو مطبوعة؛ لا تعيد نشرها في الرد أو السجل.
- يتطلب الحل توسيع النطاق إلى مكون غير مصرح به.
- لا يمكن الحفاظ على legacy path أو rollback المتفق عليه.
- توجد تغييرات مستخدم متداخلة لا يمكن فصلها بأمان.

