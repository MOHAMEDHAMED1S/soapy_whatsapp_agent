# القرارات والقيود

## قرارات محسومة

1. `.env` لن يُلغى؛ سيبقى fallback وbootstrap.
2. Control API لا يدخل في hot path للرسائل.
3. الإعدادات versioned وtransactional، وليست جدول key/value بلا schema.
4. الأسرار write-only ومشفرة، ولا تعرضها GET.
5. لا تفعيل قبل validation.
6. dynamic/reconnect/restart ظاهر صراحة في العقد.
7. core guardrails لا تتحول إلى prompt حر قابل للاستبدال.
8. الطلب والدفع يحتاجان workflow deterministic قبل جعلهما شديدي الديناميكية.
9. env admins يعملون break-glass ولا يمكن حذفهم من API.
10. Control API وStatus API منفصلان منطقياً وتشغيلياً في الإصدار الأول؛ يمكن جمعهما خلف reverse proxy فقط.
11. فشل بدء Control API لا يمنع بدء WhatsApp، ويظهر كحالة degraded تشغيلية.
12. V1 يدير dynamic business settings محددة فقط؛ technical/runtime settings تبقى `.env`/code.
13. تعديل V1 العادي يستخدم validate-and-activate مباشرة، مع revision وaudit backend تلقائياً؛ draft workflow العامة مؤجلة.
14. V1 process واحدة. managed resolution ممنوعة في multi-process deployment حتى وجود synchronization مجربة.
15. كل متجر يرث قيمه الحالية تلقائياً كـLegacy Baseline؛ لا bulk seed ولا نسخ أسرار ولا managed override قبل طلب كتابة صريح.

## لماذا التخزين المحلي وليس remote config service الآن

المطلوب أن يستمر البوت إذا لم تعمل الميزة الجديدة. تخزين active config محلياً وإدارة الكتابة عبر API يحقق ذلك. الاعتماد على remote service للحصول على key/model عند كل تشغيل أو رسالة يخلق نقطة فشل جديدة. يمكن لاحقاً مزامنة remote control plane إلى local cache بنفس العقود.

## لماذا لا نسمح بتغيير كل شيء

بعض القيم ليست إعدادات تجارية بل invariants أمنية، مثل authorization، وجوب idempotency، ومنع side-effect tools من التنفيذ المتوازي. جعلها قابلة للتعطيل يعيد الثغرات عن طريق dashboard.

## حدود fallback

fallback لا يعني إخفاء المشكلة:

- المستخدم يستمر في الحصول على الخدمة.
- status يعرض أن managed source degraded وأن env مستخدم.
- audit يسجل الانتقال.
- alert يطلب معالجة السبب.

لا نكرر إلى الأبد بين managed وenv في كل request. health state داخلية تثبت fallback مؤقتاً حتى cooldown أو validation/activation جديد، دون جعل threshold إعداداً عامة في V1.

## القيم المركبة

لا نحدث key منفرداً إذا كان سيخلق تركيباً غير صالح. model/provider/key، payment strategy/default method، status host/token/CORS، وrate-limit windows أمثلة على مجموعات transaction واحدة.

## تعدد العمليات

PM2 حالياً يستخدم instance واحدة، وهذا هو deployment contract لـV1. إذا اكتشف preflight أكثر من process فلا يفعل managed resolution. عند الانتقال لعدة instances نضيف أبسط آلية مثبتة، غالباً polling خفيف لرقم active revision مع leader للعمليات ذات الأثر الجانبي، ثم نختبر convergence/failure؛ لا نبني event bus مقدماً ولا ندعي دعماً غير موجود.

## قرارات تنفيذية أولية

- Control API server: مستقل داخل نفس process وعلى منفذ مستقل، وفشله non-fatal للبوت.
- Schema: typed descriptors هي source of truth. يستخدم JSON Schema فقط إذا كان يولد منها آلياً ولا يخلق تعريفاً ثانياً أو dependency أكبر من نطاق V1.
- Secrets: `EnvironmentSecretProvider` إلزامي read-only، و`EncryptedSqliteSecretProvider` اختياري بـAES-256-GCM ومفتاح bootstrap. secret manager خارجي backend لاحقة.
- Revisions: PUT المباشرة تنشئ revision داخلية؛ لا تخزن dashboard التاريخ وحدها ولا تفرض draft يدوية.
- Jobs: لا framework عامة في V1. catalog refresh يبدأ single-flight داخل العملية؛ table-backed jobs تضاف عندما توجد عملية يجب أن تنجو من restart.
- API language: error codes والحقول التقنية بالإنجليزية، مع documentation عربية، حتى لا يرتبط dashboard بصياغة رسائل قابلة للتغيير.

## لماذا لا نستخدم key/value بسيطاً

عدد مفاتيح V1 صغير، لكن أثر model/key/limits مباشر على production. descriptor typed صغيرة مع bounds وsource/fallback تمنع كتابة قيم لا يفهمها runtime. التبسيط يأتي من تقليل عدد المفاتيح والـworkflows، لا من حذف schema والvalidation.

## لماذا نحتفظ بالـsnapshot

الـsnapshot تبنى عند startup/activation فقط، ثم يقرأ runtime object داخل الذاكرة. هذا أقل تكلفة وأكثر اتساقاً من DB/API lookup لكل رسالة، ويمنع خلط model من revision مع key من أخرى. لذلك ليست جزءاً مؤجلاً رغم تقليص V1.

## أسئلة business يجب حسمها قبل مراحلها

- هل payment strategy المطلوبة افتراضياً `ask_customer` أم الإبقاء على أول وسيلة متاحة؟
- مدد الاحتفاظ القانونية للمحادثات والطلبات والـaudit.
- هل تفعيل إعدادات checkout الحساسة يحتاج موافقة ثانية؟
- أي origins وهوية ستستخدمها لوحة التحكم عند بنائها؟

## شرط بدء التنفيذ

لا يبدأ الكود قبل اعتماد:

- namespaces والحدود الأولى.
- bootstrap secret strategy.
- API auth strategy.
- migration/rollback policy.
- أول مجموعة settings منخفضة المخاطر للـpilot.
- خطة معالجة المفتاح المكشوف والتبعيات الحالية.
- اعتماد قائمة V1 ومنع توسيعها دون milestone وشرط قبول جديد.
