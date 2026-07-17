# المراجعة والنشر وGit

**الحالة:** ملزمة
**آخر تحديث:** 2026-07-17

## Git والعمل المشترك

- افحص worktree قبل وبعد المهمة.
- لا تعدل أو تحذف changes غير مرتبطة.
- لا تستخدم `git reset --hard`, `git clean -fd`, أو checkout لاستبدال ملفات المستخدم.
- لا stage/commit/push/tag/merge/release إلا إذا طلب المستخدم أو workflow المخول ذلك صراحة.
- عند إنشاء branch بواسطة Agent استخدم `codex/<short-description>` ما لم يطلب غير ذلك.
- لا force push إلى branch مشتركة أو `main`.
- لا تجمع generated artifacts أو logs أو DB/session files في commit.
- commit واحد لا يخلط docs cleanup وdependency upgrade وbehavior change غير مرتبط.

## مراجعة التغيير

المراجع يتحقق من:

- هل السلوك الحالي موثق ومختبر؟
- هل scope مطابق للخطة؟
- هل توجد side effects وقت import؟
- هل fallback وrollback حقيقيان؟
- هل هناك PII/secret/QR leakage؟
- هل DB/API contracts backward compatible؟
- هل retries/idempotency/timeouts صحيحة؟
- هل errors/failure states ظاهرة؟
- هل docs و`.env.example` وOpenAPI متزامنة؟
- هل الاختبارات تثبت failure paths؟

لا تعتمد عبارة “LGTM” دون الإشارة إلى الأدلة أو المخاطر في التغيير العالي/الحرج.

## Release gates العامة

- build ناجح على Node versions المدعومة.
- tests ناجحة وغير flaky.
- لا uncommitted/generated secret artifacts.
- config/env changes موثقة وoptional في compatibility release.
- migrations backup/restore/upgrade/downgrade مجربة.
- API contract diff مراجع.
- security/redaction checks ناجحة.
- runbook وrollback منشوران.
- observability تميز healthy/degraded/fallback.

## Release gates لـControl Plane

- flags الغائبة: لا DB/port/timer/module side effect.
- legacy effective values مطابقة لكل fixture.
- read-only تعرض inherited values الصحيحة لكل متجر.
- managed resolution مغلقة أول deploy.
- namespace واحدة في canary.
- Control API failure لا يرفع message failure rate.
- secret provider failure يرجع env دون تسريب.
- rollback وnamespace/global kill switches تم تنفيذها عملياً.
- multi-process preflight يمنع managed resolution.

## rollout

1. local/fake environment.
2. copied anonymized DB upgrade/downgrade.
3. internal test installation.
4. بائع canary واحد مع backup ونافذة مراقبة.
5. مجموعة صغيرة متنوعة.
6. rollout تدريجي بعد مراجعة metrics.

لا rollout شامل مباشرة، ولا تفعيل managed values تلقائياً بعد deploy.

## مؤشرات إيقاف النشر

- اختلاف legacy effective value غير مقصود.
- DB/schema/data change في Legacy mode.
- فتح port/API دون flag.
- startup/session/WhatsApp regression.
- secret/PII/QR leakage.
- latency/error/duplicate order increase.
- migration أو downgrade غير قابلين للرجوع.
- instances لا تتفق على revision.

عند ظهور مؤشر: أوقف التوسع، فعّل kill switch/rollback، احفظ أدلة منقحة، ثم حلل السبب. لا تستمر لأن جزءاً من العملاء فقط تأثر.

## تسليم الإصدار

استخدم [قائمة تحقق الإصدار](templates/release-checklist.md)، وسجل:

- version/commit/flags.
- schema migration version.
- environments المختبرة.
- exact commands/results.
- known limitations.
- enablement وrollback steps.
- owner/نافذة المراقبة وفق workflow الفريق.

