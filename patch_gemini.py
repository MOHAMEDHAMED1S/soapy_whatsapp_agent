import re
import sys

with open('src/services/GeminiService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Product catalog note
old1 = '''ملاحظة مهمة: هذه قائمة جزئية. إذا طلب العميل منتجاً غير موجود في القائمة أعلاه،
استخدم دالة "search_products" للبحث عن المنتج بدلاً من افتراض عدم توفره.
`;'''
new1 = '''ملاحظة مهمة: هذه قائمة جزئية. إذا طلب العميل منتجاً غير موجود في القائمة أعلاه،
استخدم دالة "search_products" للبحث عن المنتج.
⚠️ تحذير صارم جداً: لا تستخدم دالة البحث (search_products) أكثر من مرة أو مرتين كحد أقصى! إذا لم تجد المنتج، توقف فوراً عن البحث وأخبر العميل أن المنتج غير متوفر. ممنوع منعاً باتاً الدخول في دوامة بحث بكلمات مختلفة!
`;'''
content = content.replace(old1, new1)

# 2. System prompt limits
old2 = '''- الطلبات يتم إنشاؤها فقط من خلال دالة create_order - لا توجد طريقة أخرى
- إذا لم تستخدم دالة create_order، لا يمكنك إنشاء الطلب - أخبر العميل بذلك بوضوح

قائمة المنتجات المتاحة:'''
new2 = '''- الطلبات يتم إنشاؤها فقط من خلال دالة create_order - لا توجد طريقة أخرى
- إذا لم تستخدم دالة create_order، لا يمكنك إنشاء الطلب - أخبر العميل بذلك بوضوح

تحذير صارم لمنع التكرار اللانهائي (Infinite Loops):
- لا تقم بتنفيذ أكثر من 3 دوال متسلسلة لخدمة نفس الطلب للعميل.
- إذا كنت تبحث عن منتج باستخدام search_products ولم تجده، لا تبحث مرة أخرى بكلمات مختلفة أبداً! توقف وأخبر العميل.
- لا تقع في فخ تكرار استدعاء نفس الدالة مرات عديدة بشكل متتالي. إذا لم تنجح من المرة الأولى أو الثانية، توقف وتحدث مع العميل.

قائمة المنتجات المتاحة:'''
content = content.replace(old2, new2)

# 3. Function Returns (search_products, get_product_details, get_featured_products)
old_sp = '''if (result.products.length === 0) {
              return 'لم أجد منتجات تطابق البحث. يرجى المحاولة بكلمات أخرى.';
            }
            const formattedList = productService.formatProductList(result.products);
            // Note: Don't save to order_data here - only save when customer explicitly requests a product
            return formattedList;'''
new_sp = '''if (result.products.length === 0) {
              return 'لم أجد منتجات تطابق البحث. [أمر صريح للنظام: توقف تماماً عن البحث! لا تستخدم هذه الدالة مرة أخرى بكلمات مختلفة. قم بالرد على العميل مباشرة وأخبره بأن المنتج غير متوفر واطلب منه توضيح طلبه]';
            }
            const formattedList = productService.formatProductList(result.products);
            // Note: Don't save to order_data here - only save when customer explicitly requests a product
            return `تم العثور على المنتجات التالية:\n${formattedList}\n\n[أمر صريح للنظام: لقد حصلت على النتيجة بنجاح. توقف الآن عن استدعاء أي دوال أخرى! لا تقم بالبحث مرة أخرى. قم بالرد على العميل فوراً وأخبره بالنتيجة]`;'''
content = content.replace(old_sp, new_sp)

old_gpd = '''if (!product) {
              return 'لم أجد المنتج المطلوب.';
            }
            const formattedProduct = productService.formatProduct(product);
            // Note: Don't save to order_data here - only save when customer explicitly requests to add product
            return formattedProduct;'''
new_gpd = '''if (!product) {
              return 'لم أجد المنتج المطلوب. [أمر صريح للنظام: توقف ولا تستدعي دوال أخرى. أخبر العميل بذلك مباشرة]';
            }
            const formattedProduct = productService.formatProduct(product);
            // Note: Don't save to order_data here - only save when customer explicitly requests to add product
            return `تفاصيل المنتج:\n${formattedProduct}\n\n[أمر صريح للنظام: توقف الآن عن استدعاء أي دوال أخرى! قم بالرد على العميل مباشرة لعرض هذه التفاصيل]`;'''
content = content.replace(old_gpd, new_gpd)

old_gfp = '''if (products.length === 0) {
            return 'لا توجد منتجات مميزة حالياً.';
          }
          return productService.formatProductList(products);'''
new_gfp = '''if (products.length === 0) {
            return 'لا توجد منتجات مميزة حالياً. [أمر صريح للنظام: أخبر العميل بذلك مباشرة ولا تستدعي دوال أخرى]';
          }
          return `المنتجات المميزة:\n${productService.formatProductList(products)}\n\n[أمر صريح للنظام: توقف الآن عن استدعاء أي دوال إضافية! قم بالرد على العميل مباشرة لعرض هذه المنتجات المميزة]`;'''
content = content.replace(old_gfp, new_gfp)

# 4. Empty Text Fallback in generateResponseWithFunctions
old_fb1 = '''if (!textContent && allFunctionCalls.length === 0) {
        logger.warn('Gemini returned an empty response text with no function calls');
        return { text: 'عذراً، لم أتمكن من استيعاب طلبك. يرجى إعادة صياغته مرة أخرى.' };
      }

      // Check if response contains code blocks that look like function calls
      if (allFunctionCalls.length === 0) {
        if (textContent.includes('create_order') && textContent.includes('customer_name')) {
          logger.warn('Detected code output instead of function call. Response may need manual parsing.');
        }
      }'''
new_fb1 = '''// Check if response contains code blocks that look like function calls
      if (allFunctionCalls.length === 0) {
        if (textContent.includes('create_order') && textContent.includes('customer_name')) {
          logger.warn('Detected code output instead of function call. Response may need manual parsing.');
        }
      }

      // If textContent is empty, provide a meaningful fallback based on function calls
      if (!textContent) {
        if (allFunctionCalls.length > 0) {
          logger.warn(`Gemini returned empty text after ${allFunctionCalls.length} function calls`);
          const lastFunc = allFunctionCalls[allFunctionCalls.length - 1];
          if (lastFunc.name === 'search_products') {
            textContent = 'لقد بحثت عن طلبك ولكن يبدو أنني لم أتمكن من العثور على النتيجة الدقيقة. يرجى التأكد من اسم المنتج أو تزويدي بتفاصيل أكثر.';
          } else if (lastFunc.name === 'create_order') {
            textContent = 'تم استلام طلبك وجاري معالجته بنجاح.';
          } else if (lastFunc.name === 'initiate_payment') {
            textContent = 'تم تجهيز رابط الدفع لطلبك.';
          } else if (lastFunc.name === 'calculate_order_total') {
            textContent = 'تم حساب تكلفة الطلب. يرجى تأكيد الطلب للبدء في تجهيزه.';
          } else {
            textContent = 'لقد قمت بتنفيذ طلبك، ولكن لم أتمكن من صياغة رد مناسب. يرجى التحقق أو إعادة المحاولة.';
          }
        } else {
          logger.warn('Gemini returned an empty response text with no function calls');
          return { text: 'عذراً، لم أتمكن من استيعاب طلبك. يرجى إعادة صياغته مرة أخرى.' };
        }
      }'''
content = content.replace(old_fb1, new_fb1)

# 5. Graceful Loop Breaking in generateResponseWithFunctions
old_gl = '''const allExploratory = functionCalls.every((fc: any) => EXPLORATORY_FUNCTIONS.has(fc.name));
        if (allExploratory) {
          consecutiveExploratoryCount++;
          if (consecutiveExploratoryCount >= 3) {
            logger.warn(`Breaking exploratory loop after ${iteration + 1} iterations (all ${EXPLORATORY_FUNCTIONS.size} type calls)`);
            break;
          }
        } else {
          consecutiveExploratoryCount = 0;
        }

        logger.info(`Function calls detected (iteration ${iteration + 1}): ${functionCalls.length}`);
        allFunctionCalls.push(...functionCalls);

        // Execute function calls
        const functionResults = await Promise.all(
          functionCalls.map(async (fc: any) => {
            logger.info(`Executing function: ${fc.name}`, JSON.stringify(fc.args));
            const fnResult = await this.executeFunction(
              { name: fc.name, args: fc.args as Record<string, any> },
              customerPhone
            );
            return {
              functionResponse: {
                name: fc.name,
                response: fnResult,
              },
            };
          })
        );'''
new_gl = '''const allExploratory = functionCalls.every((fc: any) => EXPLORATORY_FUNCTIONS.has(fc.name));
        let interceptExploratory = false;
        if (allExploratory) {
          consecutiveExploratoryCount++;
          if (consecutiveExploratoryCount >= 3) {
            logger.warn(`Intercepting exploratory loop after ${iteration + 1} iterations`);
            interceptExploratory = true;
          }
        } else {
          consecutiveExploratoryCount = 0;
        }

        logger.info(`Function calls detected (iteration ${iteration + 1}): ${functionCalls.length}`);
        allFunctionCalls.push(...functionCalls);

        // Execute function calls
        const functionResults = await Promise.all(
          functionCalls.map(async (fc: any) => {
            if (interceptExploratory && EXPLORATORY_FUNCTIONS.has(fc.name)) {
               return {
                 functionResponse: {
                   name: fc.name,
                   response: '[أمر صريح للنظام: توقف فوراً عن البحث! لقد وصلت للحد الأقصى المسموح به لمحاولات البحث المتتالية. توقف عن استدعاء الدوال الآن وأرسل الرد للعميل بالاعتماد على ما وجدته حتى الآن أو أخبره بأنك لم تجد طلبه]',
                 }
               };
            }
            logger.info(`Executing function: ${fc.name}`, JSON.stringify(fc.args));
            const fnResult = await this.executeFunction(
              { name: fc.name, args: fc.args as Record<string, any> },
              customerPhone
            );
            return {
              functionResponse: {
                name: fc.name,
                response: fnResult,
              },
            };
          })
        );'''
content = content.replace(old_gl, new_gl)

with open('src/services/GeminiService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied to GeminiService.ts")
