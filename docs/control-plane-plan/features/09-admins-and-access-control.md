# ميزة الإداريين والصلاحيات

## موضعها في الخطة

managed admins وإدارة scopes عبر dashboard هي `بعد V1`. يستخدم Control Plane Lite bootstrap token/scopes من `.env`. لكن إصلاح service-level authorization وphone normalization لعمليات الحظر شرط سابق قبل عرض block CRUD في V1.

## الوضع الحالي

الإداريون قائمة `ADMIN_PHONES`، والتحقق يتم داخل بعض دوال Gemini فقط وليس كلها. لا توجد scopes أو audit موحد، وهوية `@lid` قد لا تطابق رقم الهاتف المتوقع.

## الهدف

- إدارة admins وscopes عبر API.
- إبقاء `ADMIN_PHONES` كـbreak-glass fallback.
- فرض authorization في service layer خارج النموذج.
- فصل هوية Control API عن هوية WhatsApp admin مع إمكانية الربط لاحقاً.

## النموذج المقترح

### Control actors

Token/OIDC identity مع scopes لإدارة الـAPI.

### WhatsApp admins

هوية normalized ومعرّف مصدرها:

- `env_break_glass`.
- `managed`.
- optional mapping إلى WhatsApp LID بعد تحقق موثوق.

permissions مثل blocks، prompt business، status read، ولا تمنح secret management تلقائياً عبر WhatsApp.

## fallback

- env admins دائماً break-glass إذا كانت القائمة صالحة.
- managed admins تضاف إلى الصلاحيات، لكن لا تستطيع API حذف env admin؛ إزالته تتطلب تغيير env/redeploy.
- فشل managed table لا يلغي env admins.
- غياب env وmanaged admins يضع WhatsApp admin functions unavailable، ولا يجعل الجميع admin.

## APIs

- CRUD managed admins/scopes.
- `GET /access/me`.
- audit لكل grant/revoke.
- لا يعيد endpoint tokens.
- تغيير break-glass يظهر كـenvironment state فقط.

## التعديلات البرمجية

1. `AuthorizationService.authorize(actor, permission, resource)` مركزي.
2. tool executor يستقبل actor context موثوقاً، لا phone string فقط.
3. جميع admin tools تمر بنفس middleware.
4. canonical phone normalization مع tests دولية.
5. LID لا يحول إلى phone تلقائياً دون mapping مصدرها WhatsApp client/verification.

## حماية من lockout والتصعيد

- لا يسمح بحذف آخر managed admin إذا لا يوجد break-glass صالح، حسب policy.
- grants الحساسة تحتاج `access:write` وreason وربما approval لاحقاً.
- business prompt admin لا يصبح secret admin.
- WhatsApp message لا تمنح control-plane scopes.
- prompt injection لا يؤثر لأن authorization بعد tool selection وقبل execution.

## الاختبارات ومعايير القبول

- block/unblock مرفوضة لغير admin مهما قال model.
- env fallback يعمل عند تلف managed table.
- لا fail-open في authorization errors.
- normalization لا تساوي هويات مختلفة خطأ.
- managed admin changes audited وقابلة للrollback.
- env admin لا تحذف من API.
