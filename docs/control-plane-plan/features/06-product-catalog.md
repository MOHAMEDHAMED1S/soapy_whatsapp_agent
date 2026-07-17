# ميزة كتالوج المنتجات والكاش

## موضعها في الخطة

يدخل V1 منها `refresh_interval`, `prompt_product_limit`, `display_limit`, status، وmanual refresh فقط بعد single-flight وقواعد last-known-good. pagination profiles وfilters وstale-cache policy وتغيير الاتصال بالمتجر تؤجل.

## الوضع الحالي

`ProductService` يحتفظ بكتالوج in-memory لمدة 30 دقيقة، و`GeminiService` يحدث prompt كل 30 دقيقة ويضع أول 50 منتجاً. توجد حدود fetch/display مدمجة، وبدء التطبيق قد يطلق fetch متزامناً من مسارين.

## الهدف

- إدارة cache/refresh/prompt/display settings عبر API.
- توفير refresh يدوي وحالة واضحة.
- الاحتفاظ بالكتالوج القديم عند فشل مصدر جديد.
- عدم استبدال cache صالحة بنتيجة فارغة أو ناقصة بالخطأ.

## التعديلات البرمجية

1. `CatalogManager` يملك single-flight refresh.
2. snapshot للكتالوج مع version/source/fetchedAt/validatedAt.
3. فصل fetch عن validate عن publish.
4. pagination كاملة بدلاً من افتراض `per_page=1000`.
5. توحيد mapping والتحقق من IDs/prices/stock.
6. Prompt composer يستهلك catalog snapshot ولا ينسخ نصاً غير مضبوط.

## الإعدادات المدارة

### V1

- refresh interval.
- prompt product limit.
- WhatsApp display limit.

### لاحقاً

- cache duration وpage size/max pages.
- description length وinclude/exclude unavailable products.
- stale cache max age وسياسة العمل عند فشل API.
- sort/category filters.

## APIs

- settings عبر validate-and-activate PUT مع revision داخلية.
- `GET /catalog/status` دون إعادة الكتالوج الكامل افتراضياً.
- `POST /catalog/refresh` يرجع refresh ID وحالته وهو idempotent/single-flight؛ V1 يحتفظ بالحالة داخل العملية ويعرضها في `GET /catalog/status` ولا يبني jobs framework عامة.
- بعد V1: `POST /catalog/validate` يجلب عينة ولا ينشرها.
- يمكن لاحقاً GET preview paginated بصلاحية قراءة.

## fallback

```text
آخر catalog snapshot منشورة وصالحة
-> stale snapshot ضمن max age
-> legacy in-memory cache إن كانت مرحلة ترحيل
-> empty catalog مع تعطيل features المعتمدة وإبقاء المحادثة العامة
```

settings: managed -> constants الحالية.

فشل Control API لا يؤثر على timers أو cache الحالية.

## publish rules

- نتيجة صفر منتجات لا تستبدل كتالوجاً غير فارغ قبل التحقق من أن الصفر حقيقي.
- النتيجة الجزئية لا تنشر كـcomplete.
- products IDs مكررة أو أسعار غير صالحة ترفض أو تعزل حسب policy.
- publish pointer atomic، والطلبات الجارية تكمل بالversion التي بدأت بها.

## حالات الفشل

- Store API down: stale cache + status degraded.
- settings خاطئة تسبب حمل API: حدود code-owned للpage size/refresh minimum.
- refresh متزامن: refresh run واحدة والبقية تحصل على نفس ID.
- تغيير Store API profile: validate catalog جديد قبل استبدال القديم.

## الاختبارات ومعايير القبول

- pagination والمخزون والأسعار والخصومات.
- empty/partial/malformed responses لا تمس last-known-good.
- reschedule interval بلا timer leaks.
- refresh manual وauto لا يتداخلان.
- managed invalid تعود إلى defaults.
- Gemini search يبقى متاحاً لمنتج خارج prompt limit.
