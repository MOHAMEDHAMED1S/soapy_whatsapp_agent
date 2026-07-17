# AGENTS.md — Soapy WhatsApp Agent

هذا الملف ينطبق على المشروع كله. أي `AGENTS.md` أعمق يمكنه إضافة قيود لمساره، ولا يجوز أن يخفف هذه القواعد دون موافقة صريحة من صاحب المشروع. اقرأه كاملاً قبل أي تحليل أو تعديل.

## 1. طبيعة المشروع ومستوى الحساسية

هذا WhatsApp commerce agent مستخدم في production لدى متاجر/installations قد تملك:

- `.env` مختلفة وإعدادات محلية.
- SQLite databases بها محادثات وطلبات وحظر وprompts.
- WhatsApp LocalAuth sessions وChromium environments مختلفة.
- Store API وعملاء حقيقيين وعمليات طلب ودفع.

أي تحديث يجب أن يحافظ على السلوك والبيانات الحالية افتراضياً. لا تفترض أن installation نظيفة أو موحدة أو أن إعادة الإعداد مقبولة.

## 2. القراءة الإلزامية قبل العمل

عند بداية كل مهمة:

1. شغّل `git status --short` واحفظ تغييرات المستخدم ولا تعدل غير المرتبط.
2. اقرأ [قواعد التطوير](docs/development-rules/README.md).
3. اقرأ [حالة المشروع](docs/development-rules/00-project-state.md).
4. اقرأ ملف القاعدة المرتبط بالمهمة:
   - workflow: [01-development-workflow.md](docs/development-rules/01-development-workflow.md)
   - files/architecture: [02-architecture-and-file-boundaries.md](docs/development-rules/02-architecture-and-file-boundaries.md)
   - tests/code: [03-code-quality-and-testing.md](docs/development-rules/03-code-quality-and-testing.md)
   - documentation: [04-documentation-rules.md](docs/development-rules/04-documentation-rules.md)
   - security/DB/API: [05-security-database-and-apis.md](docs/development-rules/05-security-database-and-apis.md)
   - Control Plane: [06-control-plane-implementation-guardrails.md](docs/development-rules/06-control-plane-implementation-guardrails.md)
   - release/Git: [07-release-review-and-git.md](docs/development-rules/07-release-review-and-git.md)
5. اقرأ الكود الفعلي والcallers والtests الموجودة؛ لا تعتمد على التقرير أو الخطة وحدهما.

لأي عمل Control Plane اقرأ أيضاً بالترتيب:

1. [فهرس الخطة](docs/control-plane-plan/README.md).
2. [Control Plane Lite V1](docs/control-plane-plan/11-control-plane-lite-v1.md).
3. [عقد أمان الترقية](docs/control-plane-plan/10-production-upgrade-compatibility.md).
4. [المراحل](docs/control-plane-plan/05-implementation-phases.md).
5. ملف الميزة المحدد داخل `docs/control-plane-plan/features/`.

`docs/audit-report.md`, `docs/remediation-*`, و`docs/control-plane-plan/Control-plane-review.md` مستندات تاريخية/مراجعات. استخدمها كسياق، ولا تعتبر claims فيها دليلاً أن الكود الحالي مطابق.

## 3. حالة المشروع التي يجب عدم افتراض عكسها دون تحقق

- Node.js + TypeScript strict، والبناء الحالي عبر `npm run build`.
- PM2 process واحدة (`instances: 1`, fork mode).
- SQLite WAL عبر `better-sqlite3`.
- WhatsApp عبر `whatsapp-web.js` وLocalAuth/Chromium.
- Gemini وStore API clients موجودة كخدمات legacy.
- Status API تعمل داخل العملية، default `127.0.0.1:3002`، وتشمل QR/SSE.
- كثير من الخدمات exported singletons وبعضها له import-time side effects.
- Control Plane مخططة ولم تُنفذ runtime بعد.
- لا يوجد test script/test framework أو lockfile متعقب وقت كتابة هذه القواعد؛ تحقق مجدداً ولا تدّع وجودهما.
- يوجد secret-like literal معروف في `plan.md`. لا تقرأها بغرض الاستخدام ولا تنسخها أو تعرضها؛ rotation والتنقيح release blocker قبل كود secrets/Control Plane.

## 4. الأولويات غير القابلة للتفاوض

1. سلامة بيانات وجلسات وعملاء production.
2. backward compatibility وrollback حقيقي.
3. عدم تسريب secrets/PII/QR.
4. correctness للorders/payments/authorization قبل سرعة التنفيذ.
5. اختبارات failure paths، لا happy path فقط.
6. توثيق متزامن ودقيق.
7. البساطة: لا framework أو abstraction بلا حاجة حالية.

إذا تعارض time-to-market مع واحدة من أول ثلاث نقاط، لا تخفض الأمان بصمت؛ قلص النطاق أو اطلب قراراً.

## 5. سير العمل الإلزامي

### قبل التعديل

- صنف التغيير: منخفض/متوسط/عالٍ/حرج حسب [workflow](docs/development-rules/01-development-workflow.md).
- medium+ يحتاج خطة؛ high/critical يستخدم [قالب خطة تغيير](docs/development-rules/templates/change-plan-template.md).
- قرار architecture/auth/storage/source-of-truth/multi-process يحتاج [ADR](docs/development-rules/templates/adr-template.md).
- ثبّت current behavior باختبار characterization قبل refactor/fallback change.
- حدد out-of-scope والملفات التي ستلمسها.

### أثناء التعديل

- نفذ slice صغيرة قابلة للاختبار والرجوع.
- افصل foundation عن activation وعن rollout.
- لا تجمع feature change مع dependency major upgrade أو formatting واسع.
- لا تصلح أشياء جانبية غير لازمة؛ سجلها منفصلة.
- حافظ على legacy branch حتى اجتياز compatibility gates.

### بعد التعديل

- شغل checks المناسبة وسجل النتائج الفعلية.
- حدّث docs/config/OpenAPI/migration/runbook في نفس التغيير.
- افحص `git status` وdiff للتأكد من عدم لمس user changes أو artifacts.
- handoff يذكر السلوك، الملفات، tests، flags/migrations، المخاطر، والrollback.

## 6. حدود الملفات والمعمارية

- `src/index.ts`: composition/startup/shutdown فقط؛ لا business logic أو SQL أو feature config parsing.
- `src/config/config.ts`: legacy bootstrap contract. لا تكسره في compatibility release.
- لا تضف قراءة `process.env` جديدة خارج bootstrap/config adapters.
- `src/bot/`: transport/lifecycle/message orchestration، لا Store SQL أو prompt business logic.
- `src/services/`: application/provider services بمسؤوليات واضحة وdependencies معلنة.
- `src/database/`: DB open/migrations/repositories/transactions؛ ممنوع SQL في controllers/tools/handlers.
- `src/types/`: types/parsers بلا side effects.
- `src/control-plane/`: يستخدم التقسيم المحدد في قواعد المعمارية عند إنشائه، ويحمل lazy بعد flags.
- `tests/`: unit/integration/contract/compatibility/fixtures، بلا production data.

قواعد الحجم:

- ملف جديد يستهدف أقل من 400 سطر؛ أكثر من 600 يحتاج سبباً ومراجعة تقسيم.
- ممنوع إضافة feature جديدة مباشرة إلى ملف legacy أكبر من 800 سطر دون استخراج مكون واختبارات.
- خصوصاً: لا توسع `GeminiService.ts` أو `WhatsAppBot.ts` بوظائف Control Plane مباشرة.
- لا scripts/patches/diffs مؤقتة جديدة في جذر المشروع.

ممنوع في top-level لوحدة جديدة: DB open/migration، server/timer، network/file write، provider client، أو `process.exit`. initialization explicit من composition root.

## 7. قواعد TypeScript والتنفيذ

- لا تخفف strict compiler options.
- لا `any`, `@ts-ignore`, double assertions، أو non-null assertions بلا boundary reason واختبار.
- external data = `unknown` ثم validation/mapping.
- لا catch صامتة ولا raw provider error في response/log.
- كل Promise awaited أو rejection handled عن قصد.
- كل wait خارجي له timeout؛ side effects المتأخرة بعد timeout تمنع/tokenized.
- timers لها handles وcleanup؛ استخدم `unref()` عندما يناسب.
- لا retry لكتابة دون idempotency/reconciliation.
- لا parallel side-effect tools للأوامر الإدارية أو orders/payments.
- shared configuration/state تنشر atomically.

## 8. الاختبارات والبوابات

### الحالة الحالية

التحقق الموجود الآن:

```bash
npm run build
```

لا تقل إن tests نجحت إذا لا يوجد `npm test`.

### بوابة Control Plane

قبل أول behavior implementation لـControl Plane يجب في تغيير foundation مستقل إضافة:

- lockfile متعقب و`npm ci`.
- test runner و`npm test`.
- temporary SQLite fixtures.
- fake Gemini/Store API adapters.
- legacy config/DB characterization tests.

بعدها minimum code checks:

```bash
npm ci
npm run build
npm test
```

- CI لا تتصل بWhatsApp/Gemini/Store API الحقيقي.
- لا raw production DB أو sessions أو QR في tests/artifacts.
- high-risk change تختبر timeout/DB/provider/auth/concurrency/rollback failures.
- docs-only: افحص الروابط والتنسيق واذكر أن runtime لم يتغير.

## 9. قواعد الأمان

- API keys/tokens/master keys/QR/session files كلها credentials.
- phone/email/address/message/order payloads PII.
- ممنوع commit/log/audit/response/fixture لقيمة حقيقية.
- إذا وجدت secret متعقبة لا تطبعها؛ أبلغ بالمكان/النوع وابدأ rotation workflow حسب الصلاحية.
- `.env.example` placeholders فقط.
- secret APIs write-only؛ GET metadata/fingerprint فقط.
- authorization في service layer وdeny-by-default، لا prompt/UI.
- validation endpoints لا تنشئ order/payment/message أو side effect.
- Status API وControl API لهما auth منفصل في V1.
- لا public bind/CORS wildcard للواجهة الإدارية كافتراضي.

## 10. قاعدة البيانات والـAPIs

- schema changes عبر migrations versioned، لا SQL جديد في constructors عشوائياً.
- compatibility migrations additive وopt-in، مع `control_` prefix.
- ممنوع DROP/RENAME/destructive backfill دون موافقة حرجة وbackup/restore/rollback.
- SQLite backup يجب أن يكون WAL-safe.
- migration failure يعطل feature الجديدة فقط ويترك Legacy mode.
- revision values + active pointer + audit transaction واحدة.
- APIs versioned، authenticated، validated، rate-limited، documented، وidempotent/concurrency-safe عند الأثر الجانبي.
- OpenAPI تعرض المنفذ فعلاً فقط.
- لا تكسر Status API routes/QR/SSE بلا compatibility plan.

## 11. عقد Control Plane الملزم

### no-op upgrade

عند flags غائبة/false:

- نفس legacy config/factories/precedence.
- لا Control API port.
- لا migrations/tables/writes/timers/network calls.
- لا import side effects من Control Plane.
- لا متغيرات env جديدة مطلوبة.

### قيم كل متجر الحالية

- القيم الابتدائية هي Inherited Legacy Baseline: `.env` ثم legacy DB source عند انطباقه ثم built-in الحالي.
- تظهر في read-only/effective API تلقائياً دون seed.
- لا bulk import ولا نسخ API keys/prompts/admins إلى managed tables.
- أول write تخزن override المتغير فقط.
- reset يزيل override ويرجع لمصدر المتجر الحالي.
- secret inherited تظهر configured/source/fingerprint فقط.

### runtime/fallback

- Control API ليست في message hot path.
- typed Registry فقط؛ لا key/value عشوائية.
- candidate validated ثم immutable snapshot pointer swap.
- managed invalid/unreadable يرجع للlegacy resolver.
- Control API down يبقي snapshot الحالية.
- backend history/audit/rollback إلزامية، لا dashboard-only history.
- V1 process واحدة؛ managed resolution ممنوعة إذا instances > 1.

### نطاق V1 فقط

مسموح: Gemini model/key + generation subset، business prompt، ثلاثة rate limits بعد الإصلاح، blocks بعد authorization، وثلاثة catalog settings بعد single-flight.

مؤجل وممنوع إدخاله خلسة: Store API profile، WhatsApp/Puppeteer/session/reconnect، DB/ports/PM2/restart jobs، checkout/payment، managed admins/OIDC، retention، multi-provider/jobs/event bus/multi-process sync، وdraft system عام.

## 12. التوثيق

- docs جزء من Definition of Done.
- العربية للمستندات الداخلية الجديدة مع identifiers/error codes بالإنجليزية؛ OpenAPI fields/errors بالإنجليزية.
- plan/runbook/ADR جديد يحمل status/date/scope.
- لا تضع `Implemented` قبل الكود والاختبارات.
- env/config change يحدث `.env.example` وconfiguration reference.
- API change يحدث OpenAPI/auth/errors/examples.
- DB change يحدث migration/backup/rollback docs.
- architecture decision يحدث ADR.
- استخدم القوالب داخل `docs/development-rules/templates/`.
- افحص الروابط، defaults، flags، routes، والأمثلة ضد source of truth.

## 13. Git والعمل المشترك

- تغييرات worktree الحالية للمستخدم؛ لا تمحها أو تعيدها.
- ممنوع `git reset --hard`, `git clean -fd`, destructive checkout، أو force push.
- لا stage/commit/push/tag/merge/release دون طلب/تفويض صريح.
- branch ينشئه Agent: `codex/<description>` ما لم يطلب غيره.
- لا commit لـ`dist/`, logs, DB, `.wwebjs_auth`, `.env`, secrets، أو artifacts مؤقتة.
- لا dependency change دون lockfile وتبرير أمني/تشغيلي.
- npm هو package manager المعتمد حالياً؛ لا تضف yarn/pnpm lockfile موازية دون ADR وموافقة.

## 14. أشياء ممنوعة صراحة

- استبدال `.env`/legacy behavior أو إزالة fallback في V1.
- auto-seeding للقيم الحالية أو secrets إلى Control Plane DB.
- DB/API lookup لكل رسالة للحصول على config.
- دمج Control API داخل Status API في V1.
- تفعيل managed values لكل المتاجر تلقائياً بعد deploy.
- ادعاء hot reload/restart/multi-process support غير منفذ ومختبر.
- تغيير order/payment/confirmation/retry عبر prompt أو setting قبل deterministic workflow/idempotency.
- تخزين plaintext secret أو QR أو PII في audit/log/status.
- اختبار live ينشئ طلباً/دفعة/رسالة حقيقية.
- destructive migration أو data cleanup بلا dry-run/backup/approval.
- suppressing test/compiler/security failure لإمرار التغيير.
- وصف roadmap كأنها functionality موجودة.

## 15. Definition of Done

المهمة لا تكتمل إلا عندما:

- scope ومعايير القبول تحققت بلا تغييرات جانبية.
- build/tests المناسبة مرت وذُكرت نتائجها بدقة.
- legacy/failure/fallback/rollback paths اختبرت بحسب الخطر.
- لا secrets/PII/QR أو artifacts.
- docs/OpenAPI/config/migration/runbook متزامنة.
- feature flags آمنة افتراضياً وkill switch مجربة عند انطباقها.
- worktree راجعت وتغييرات المستخدم حُفظت.
- handoff يوضح ما تغير وما لم يتغير وما بقي.

إذا تعذر شرط، لا تدّع الاكتمال: اذكر blocker والمخاطر والخطوة المطلوبة بوضوح.
