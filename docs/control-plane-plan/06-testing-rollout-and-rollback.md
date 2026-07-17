# الاختبارات والنشر والـrollback

## مصفوفة fallback الإلزامية

لكل setting/provider نختبر:

| Managed | env | default | المتوقع |
| --- | --- | --- | --- |
| صالح | صالح/غائب | موجود | managed |
| غائب | صالح | موجود | env |
| غير صالح | صالح | موجود | env + health warning |
| غائب/غير صالح | غائب | موجود | default |
| غائب/غير صالح | غائب | غائب | unavailable typed error |
| صالح ثم provider يفشل | صالح | موجود | policy-specific runtime fallback |
| Control API متوقف | أي حالة | أي حالة | لا تأثير على snapshot الحالي |

## أنواع الاختبارات

### Unit

- parsing وvalidation لكل descriptor.
- resolution/source metadata.
- secret redaction والتشفير والفشل في فك التشفير.
- revision conflicts وvalidate-and-activate/rollback transitions.
- snapshot atomicity.
- AI client swap وعدم خلط model/key revisions.

### Integration

- SQLite migrations من قاعدة قديمة.
- validate-only/PUT/reset/rollback.
- auth/scopes/idempotency/audit.
- Gemini adapter باستخدام fake server، وليس الخدمة الحقيقية في CI.
- environment-only secrets وencrypted SQLite capability on/off.

### Contract

- OpenAPI response/request validation.
- Gemini model/key connectivity validation دون تنفيذ tools ذات أثر جانبي.
- Store API/checkout contract tests تؤجل لمرحلتها ولا تحجب V1.

### End-to-end

1. بدء نسخة بدون جداول managed والتأكد من legacy behavior.
2. إرسال PUT لقيمة صالحة وملاحظة revision الجديدة.
3. إرسال رسالة جديدة والتأكد من استخدام snapshot الجديدة.
4. إدخال setting غير صالحة والتأكد من رفض activation.
5. إيقاف Control API والتأكد من استمرار الرسائل.
6. تعطيل managed credential والتأكد من fallback إلى env.
7. rollback والتأكد من عودة القيمة السابقة.

### Failure injection

- DB busy/corrupt managed row.
- encryption key خاطئ.
- provider timeout/401/429/5xx.
- Control API port conflict.
- process dies أثناء activation.
- concurrent dashboard updates.
- duplicate idempotency keys.
- multi-process deployment يجب أن يمنع managed resolution في V1 بدلاً من ادعاء المزامنة.

اختبارات restart/jobs/checkout/Store API advanced تضاف في Release C فقط.

## عدم تسريب الأسرار

اختبارات آلية تفحص:

- responses.
- logs.
- audit rows.
- thrown errors.
- status snapshots.
- crash dumps المسموح جمعها.

تزرع secret وهمية مميزة ويجب ألا تظهر في أي output باستثناء ciphertext.

## Compatibility tests

نحفظ fixtures لسلوك الإعدادات الحالية، بما فيها:

- defaults الحالية للموديل والـtimeouts والحدود.
- env variable names.
- Status API routes الحالية.
- صيغة الردود الأساسية للمستخدم.
- fallback إلى cached catalog.
- متجر A بقيم env مخصصة ومتجر B يعتمد built-in defaults؛ كلٌ يرى قيمه الحالية لا قيماً موحدة.
- legacy business/admin prompt الموجودة في DB تظهر كمصدر `legacy_db` دون migration تلقائية.
- secret من env تظهر metadata فقط ولا توجد في جداول Control Plane أو audit.

## اختبارات baseline التلقائية

1. شغّل النسخة القديمة وسجل effective values لكل fixture.
2. حدّث النسخة مع Control Plane مغلقة وتأكد من التطابق وعدم وجود writes.
3. فعّل read-only API وتأكد أن القيم نفسها ظهرت مع `inherited=true` ومصدر صحيح.
4. اكتب override لمفتاح واحد وتأكد أن بقية المفاتيح ما زالت inherited ولم تنسخ إلى revision كقيم managed جديدة.
5. احذف override وتأكد من الرجوع إلى قيمة المتجر الحالية، لا default عامة.
6. غيّر `.env` لمفتاح بلا override ثم أعد التشغيل وتأكد أن inherited value الجديدة أصبحت effective.
7. كرر secret case وتأكد أن plaintext لم تُخزن أو تُعرض.

## rollout

1. نشر Compatibility Foundation على instance واحدة مع كل flags مغلقة.
2. مراقبة startup وlatency والmemory والتأكد من عدم وجود DB/port changes.
3. تشغيل migration وread-only API صراحة، مع managed resolution مغلقة.
4. تجربة validate-only، ثم تفعيل writes مع activation disabled والتأكد أن PUT ما زالت مرفوضة بينما يمكن تجهيز secret reference غير مستخدمة.
5. تفعيل activation ثم managed resolution لقيمة business prompt منخفضة المخاطر.
6. canary AI model، ثم managed key بعد نجاح secret rotation/fallback drill.
7. rate limits/catalog كلٌ بعد اجتياز شرطه السابق، namespace واحدة في كل مرة.
8. أي مجال من Release C له rollout منفصل ولا يُجمع تلقائياً مع V1.

## rollback levels

### Setting rollback

Revision عكسية إلى last-known-good، دون restart للقيم dynamic.

### Namespace kill switch

تعطيل managed resolution لـnamespace والعودة إلى env/default مع بقاء البيانات للتحقيق.

### Control-plane kill switch

`CONTROL_PLANE_ENABLED=false` يعيد legacy بالكامل عند restart.

### Deployment rollback

إصدار التطبيق السابق يجب أن يتجاهل الجداول الإضافية ولا يتضرر منها. migrations في المراحل الأولى additive فقط.

## معايير القبول العامة

- لا regressions في legacy tests.
- activation الذرية تحت concurrent load.
- API downtime لا يرفع message failure rate.
- fallback source ظاهر في status/audit.
- لا secrets في outputs.
- rollback مجرب وليس نظرياً.
- write endpoints ترفض أي setting خارج نطاق V1 على أنها planned/read-only، لا تخزنها بصمت.
- deployments متعددة العمليات لا تفعل managed resolution قبل إضافة synchronization مجربة.

## ميزانية الأداء لـV1

- لا DB أو HTTP read لكل رسالة؛ قراءة snapshot داخل الذاكرة فقط.
- قياس p50/p95 لمعالجة الرسائل قبل وبعد foundation على نفس fixture.
- لا timers عامة أو jobs framework غير مستخدمة.
- أي regression ملحوظة في startup أو memory أو latency تحتاج تفسيراً وقرار قبول قبل rollout.
