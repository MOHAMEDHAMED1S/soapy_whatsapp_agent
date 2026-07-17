# حالة المشروع الحالية

**الحالة:** مرجع وصفي؛ يجب التحقق منه عند بدء كل مهمة
**آخر تحديث:** 2026-07-17
**النسخة المعلنة:** `1.0.0`

## ماهية النظام

المشروع Agent لمتجر إلكتروني يعمل فوق WhatsApp، يستخدم Gemini للتفاعل وFunction Calling، ويتصل بـStore API للمنتجات والطلبات والدفع، ويحفظ المحادثات وبعض الحالة في SQLite. المشروع مستخدم في production لدى installations قد تختلف في `.env` والبيانات والجلسات والإصدارات المحلية.

## بنية التشغيل الحالية

- Node.js + TypeScript strict، وإخراج البناء في `dist/`.
- PM2 يشغل process واحدة في `fork` mode من `ecosystem.config.js`.
- WhatsApp عبر `whatsapp-web.js` وLocalAuth/Chromium.
- Gemini عبر `@google/generative-ai`.
- Store API عبر Axios.
- SQLite عبر `better-sqlite3` مع WAL وforeign keys.
- Status API داخل العملية على `127.0.0.1:3002` افتراضياً.
- نقطة التركيب والتشغيل الحالية `src/index.ts`.
- كثير من الخدمات الحالية exported singletons، وبعضها ينفذ تهيئة وقت import مثل config/database/service construction.

## خريطة الكود الحالية

| المسار | المسؤولية الحالية |
| --- | --- |
| `src/index.ts` | composition root، startup، shutdown، PM2 restart scheduling |
| `src/config/config.ts` | قراءة `.env` وlegacy defaults والتحقق من Gemini key |
| `src/bot/` | WhatsApp lifecycle، message handling، conversation orchestration |
| `src/services/GeminiService.ts` | Gemini، prompt، tools، catalog context، checkout logic؛ ملف legacy كبير وحساس |
| `src/services/ApiService.ts` | Store API reads/writes/retries |
| `src/services/ProductService.ts` | كتالوج المنتجات والكاش |
| `src/services/StatusApiService.ts` | health/readiness/QR/SSE/status |
| `src/services/RateLimiterService.ts` | rate tracking والحماية البديلة in-memory |
| `src/database/Database.ts` | فتح SQLite وإنشاء الجداول الحالية |
| `src/database/ConversationRepository.ts` | persistence للمحادثات والطلبات المحلية |
| `src/types/` | أنواع domain وStore API الحالية |
| `src/utils/` | logging وtimeout helpers |

## حالة Control Plane

- Control Plane مخططة فقط؛ لا يوجد implementation runtime معتمد لها بعد.
- النطاق التنفيذي الأول هو [Control Plane Lite V1](../control-plane-plan/11-control-plane-lite-v1.md).
- التحديث الافتراضي يجب أن يكون `no-op upgrade` كما في [عقد أمان الترقية](../control-plane-plan/10-production-upgrade-compatibility.md).
- كل installation ترث قيمها الحالية تلقائياً كـInherited Legacy Baseline؛ لا bulk seed ولا نسخ secrets.
- V1 process واحدة فقط، ولا يجوز ادعاء دعم multi-process managed resolution.

## قيود وأعمال تأسيسية معروفة

1. لا يوجد حالياً script باسم `test` أو test framework في `package.json`.
2. لا يوجد lockfile متعقب ضمن المشروع حالياً؛ build reproducibility غير مكتملة.
3. `GeminiService.ts` و`WhatsAppBot.ts` ملفات كبيرة؛ إضافة Control Plane داخلها مباشرة تزيد المخاطر.
4. توجد قراءات مباشرة لـ`process.env` خارج `config.ts`. يمنع إضافة قراءات جديدة؛ يتم نقلها تدريجياً عند لمس المجال.
5. `DatabaseManager` ينشئ الجداول الحالية في constructor وقت import. جداول Control Plane يجب ألا تتبع هذا النمط في Legacy mode.
6. Status API موجودة بالفعل وتحمل QR credential؛ يجب عدم كسر عقودها أو خلط auth الخاص بها مع Control API.
7. تقارير `docs/audit-report.md` و`docs/remediation-*` تاريخية. لا تُستخدم عبارة “تم الإصلاح” دون مقارنة الكود والاختبارات الحالية.
8. يحتوي `plan.md` على literal تشبه Gemini credential حقيقية. لا تستخدمها أو تنسخها أو تعرضها. إلغاء المفتاح وتنقيح الملف وتاريخ Git release blocker قبل أي implementation جديد يعتمد على Gemini/Control Plane secrets.

## بوابة ما قبل كود Control Plane

لا يدمج أي behavior change لـControl Plane قبل إنجاز ما يلي في تغيير تأسيسي مستقل:

- lockfile متعقب واستخدام `npm ci` في CI/deployment.
- test runner و`npm test` مع أول characterization tests.
- fixtures منقحة لسلوك legacy config وSQLite upgrade.
- مسار migrations versioned وopt-in مع backup/rollback test.
- إثبات أن flags الغائبة لا تحمل modules ذات side effects ولا تغير DB/ports/timers.
- إلغاء أي credential متعقبة وتنقيح repository/history دون إعادة نشر قيمتها.

## ثوابت production

- بيانات العملاء والجلسات وDB الحالية لا تمسها migration غير additive.
- `.env` الحالية لا تُلغى أو يُطلب إعادة إدخالها.
- LocalAuth path وStatus API routes وPM2 behavior لا تتغير في compatibility release.
- Store API وGemini الحقيقيتان وWhatsApp الحقيقي لا تستخدم لاختبارات CI.
- orders/payments لا تنفذ كاختبار validation أو smoke غير sandboxed.
