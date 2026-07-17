# قائمة تحقق إصدار

**الإصدار/commit:**
**التاريخ:**
**النطاق:**
**مستوى المخاطر:**
**الـflags الافتراضية:**

## الكود والتبعيات

- [ ] `npm ci` ناجح من lockfile المتعقب.
- [ ] `npm run build` ناجح.
- [ ] `npm test` ناجح.
- [ ] لا dependency/major upgrade غير مرتبطة.
- [ ] لا generated artifacts أو logs/DB/session files.

## التوافق

- [ ] upgrade من قاعدة فارغة.
- [ ] upgrade من قاعدة production مجهلة الهوية.
- [ ] downgrade إلى الإصدار السابق.
- [ ] `.env` الحالية تعمل دون متغيرات جديدة في Legacy mode.
- [ ] Status API/WhatsApp session/PM2 behavior لم تتغير دون قصد.

## قاعدة البيانات

- [ ] backup متوافق مع WAL.
- [ ] migration additive/transactional/opt-in حسب العقد.
- [ ] فشل migration يعيد rollback ويترك legacy شغالاً.
- [ ] restore drill ناجح.

## الأمان

- [ ] لا secrets/PII/QR في code/docs/logs/audit/responses/fixtures.
- [ ] auth/scopes/rate limits/CORS راجعت.
- [ ] secret rotation/fallback/recovery اختبرت عند انطباقها.
- [ ] validation لا تنفذ side effects.

## Control Plane عند انطباقها

- [ ] flags غائبة = لا port/DB/timers/import side effects.
- [ ] inherited baseline مطابقة لكل installation fixture.
- [ ] writes/activation/resolution gates مستقلة.
- [ ] atomic snapshot وrevision conflict وrollback اختبرت.
- [ ] Control API/provider/secret DB failure لا يوقف الرسائل.
- [ ] multi-process يمنع managed resolution.

## التوثيق والتشغيل

- [ ] OpenAPI/config reference/`.env.example` محدثة.
- [ ] migration/enablement/rollback runbooks منشورة.
- [ ] known limitations وstop conditions واضحة.
- [ ] dashboard لا يفترض أن configured = effective.

## rollout

- [ ] canary محدد وbackup جاهز.
- [ ] metrics ونافذة المراقبة محددة.
- [ ] kill switches مجربة.
- [ ] rollback owner/steps/verification واضحة.
- [ ] لا تفعيل managed values تلقائياً لكل العملاء.

## النتيجة

- [ ] Go
- [ ] No-Go

**الأدلة/الروابط:**

