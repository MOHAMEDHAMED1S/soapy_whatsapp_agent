import re
import sys

with open('src/services/GeminiService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_code1 = '''        // Execute function calls
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
            const funcResult = await this.executeFunction(
              {
                name: fc.name,
                args: fc.args as Record<string, any>,
              },
              customerPhone
            );
            return {
              functionResponse: {
                name: fc.name,
                response: funcResult,
              },
            };
          })
        );'''

new_code1 = '''        // Execute function calls
        const functionResults = await Promise.all(
          functionCalls.map(async (fc: any) => {
            if (interceptExploratory && EXPLORATORY_FUNCTIONS.has(fc.name)) {
               const mockResponse = '[أمر صريح للنظام: توقف فوراً عن البحث! لقد وصلت للحد الأقصى المسموح به لمحاولات البحث المتتالية. توقف عن استدعاء الدوال الآن وأرسل الرد للعميل بالاعتماد على ما وجدته حتى الآن أو أخبره بأنك لم تجد طلبه]';
               fc.result = mockResponse;
               return {
                 functionResponse: {
                   name: fc.name,
                   response: mockResponse,
                 }
               };
            }
            logger.info(`Executing function: ${fc.name}`, JSON.stringify(fc.args));
            const funcResult = await this.executeFunction(
              {
                name: fc.name,
                args: fc.args as Record<string, any>,
              },
              customerPhone
            );
            fc.result = funcResult;
            return {
              functionResponse: {
                name: fc.name,
                response: funcResult,
              },
            };
          })
        );'''

content = content.replace(old_code1, new_code1)

old_code2 = '''          if (lastFunc.name === 'search_products' || lastFunc.name === 'get_product_details') {
            // Use the accumulated search results as the response instead of a generic message
            const results = lastFunctionResults.filter(r => !r.includes('[أمر صريح للنظام'));
            textContent = results.length > 0
              ? results.join('\\n\\n')
              : 'لقد بحثت عن طلبك ولكن يبدو أنني لم أتمكن من العثور على النتيجة الدقيقة. يرجى التأكد من اسم المنتج أو تزويدي بتفاصيل أكثر.';'''

new_code2 = '''          if (lastFunc.name === 'search_products' || lastFunc.name === 'get_product_details') {
            // Use the accumulated search results as the response instead of a generic message
            const resultText = lastFunc.result || '';
            const cleanResult = typeof resultText === 'string' ? resultText.split('[أمر صريح للنظام')[0].trim() : JSON.stringify(resultText);
            textContent = cleanResult || 'لقد بحثت عن طلبك ولكن يبدو أنني لم أتمكن من العثور على النتيجة الدقيقة. يرجى التأكد من اسم المنتج أو تزويدي بتفاصيل أكثر.';'''

content = content.replace(old_code2, new_code2)

with open('src/services/GeminiService.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch 2 applied successfully.")
