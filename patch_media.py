import re
import sys

with open('src/services/GeminiService.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the media function calls block
# We know the old block starts right after `const response = result.response;`
# in `generateResponseWithMedia`.

# Let's find generateResponseWithMedia
start_idx = content.find('async generateResponseWithMedia')
if start_idx == -1:
    print("Could not find generateResponseWithMedia")
    sys.exit(1)

# Find the exact code to replace
old_code = '''      const response = result.response;

      // Check for function calls (same logic as generateResponseWithFunctions)
      let functionCalls: any[] = [];
      try {
        if (typeof response.functionCalls === 'function') {
          const calls = response.functionCalls();
          if (calls && calls.length > 0) {
            functionCalls = calls;
          }
        }
      } catch (e) {
        // Ignore
      }

      if (functionCalls.length === 0) {
        try {
          const responseParts = response.candidates?.[0]?.content?.parts || [];
          const functionCallParts = responseParts.filter((part: any) => part.functionCall);
          if (functionCallParts.length > 0) {
            functionCalls = functionCallParts.map((part: any) => part.functionCall);
          }
        } catch (e) {
          // Ignore
        }
      }

      // Execute function calls if any
      if (functionCalls && functionCalls.length > 0) {
        logger.info(`Function calls from media message: ${functionCalls.length}`);

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
        );

        try {
          const functionResponseParts = functionResults.map((fr: any) => {
            const fnResponse = fr.functionResponse.response;
            let responseObject: Record<string, any>;
            if (typeof fnResponse === 'string') {
              responseObject = { text: fnResponse };
            } else if (typeof fnResponse === 'object' && fnResponse !== null && !Array.isArray(fnResponse)) {
              responseObject = JSON.parse(JSON.stringify(fnResponse));
            } else {
              responseObject = { result: fnResponse };
            }
            return {
              functionResponse: {
                name: fr.functionResponse.name,
                response: responseObject,
              },
            };
          });

          const followUpResult = await withTimeout(
            chat.sendMessage(functionResponseParts),
            60000,
            'Gemini sendMessage followUp media'
          );
          const finalText = followUpResult.response.text();

          return {
            text: finalText,
            functionCall: {
              name: functionCalls[0].name,
              args: functionCalls[0].args as Record<string, any>,
            },
          };
        } catch (error: any) {
          logger.error('Error sending function response (media):', error);
          const functionResultText = functionResults
            .map((fr: any) => {
              const fnResponse = fr.functionResponse.response;
              return typeof fnResponse === 'string' ? fnResponse : JSON.stringify(fnResponse);
            })
            .join('\\n\\n');

          return {
            text: functionResultText,
            functionCall: {
              name: functionCalls[0].name,
              args: functionCalls[0].args as Record<string, any>,
            },
          };
        }
      }

      // No function calls - return text response
      const responseText = response.text();
      return { text: responseText };'''

new_code = '''      // Support up to 15 chained function calls
      let currentResponse = result.response;
      let allFunctionCalls: any[] = [];
      let textContent = '';

      const EXPLORATORY_FUNCTIONS = new Set([
        'search_products', 'get_product_details', 'get_featured_products', 'get_all_products',
      ]);
      let consecutiveExploratoryCount = 0;

      for (let iteration = 0; iteration < 15; iteration++) {
        let functionCalls: any[] = [];
        
        try {
          if (typeof currentResponse.functionCalls === 'function') {
            const calls = currentResponse.functionCalls();
            if (calls && calls.length > 0) {
              functionCalls = calls;
            }
          }
        } catch (e) {}

        if (functionCalls.length === 0) {
          try {
            const parts = currentResponse.candidates?.[0]?.content?.parts || [];
            const functionCallParts = parts.filter((part: any) => part.functionCall);
            if (functionCallParts.length > 0) {
              functionCalls = functionCallParts.map((part: any) => part.functionCall);
            }
          } catch (e) {}
        }

        if (functionCalls.length === 0) {
          break; // No more function calls, we are done
        }

        const allExploratory = functionCalls.every((fc: any) => EXPLORATORY_FUNCTIONS.has(fc.name));
        let interceptExploratory = false;
        if (allExploratory) {
          consecutiveExploratoryCount++;
          if (consecutiveExploratoryCount >= 3) {
            logger.warn(`Intercepting exploratory loop after ${iteration + 1} iterations in media mode`);
            interceptExploratory = true;
          }
        } else {
          consecutiveExploratoryCount = 0;
        }

        logger.info(`Function calls from media message (iteration ${iteration + 1}): ${functionCalls.length}`);
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
        );

        try {
          const functionResponseParts = functionResults.map((fr: any) => {
            const fnResponse = fr.functionResponse.response;
            let responseObject: Record<string, any>;
            if (typeof fnResponse === 'string') {
              responseObject = { text: fnResponse };
            } else if (typeof fnResponse === 'object' && fnResponse !== null && !Array.isArray(fnResponse)) {
              responseObject = JSON.parse(JSON.stringify(fnResponse));
            } else {
              responseObject = { result: fnResponse };
            }
            return {
              functionResponse: {
                name: fr.functionResponse.name,
                response: responseObject,
              },
            };
          });

          const followUpResult = await withTimeout(
            chat.sendMessage(functionResponseParts),
            60000,
            'Gemini sendMessage followUp media'
          );
          currentResponse = followUpResult.response;
        } catch (error: any) {
          logger.error('Error sending function response (media):', error);
          const functionResultText = functionResults
            .map((fr: any) => {
              const fnResponse = fr.functionResponse.response;
              return typeof fnResponse === 'string' ? fnResponse : JSON.stringify(fnResponse);
            })
            .join('\\n\\n');

          return {
            text: functionResultText,
            functionCall: {
              name: allFunctionCalls[0].name,
              args: allFunctionCalls[0].args as Record<string, any>,
            },
          };
        }
      }

      // After all function calls (or if none), get the final text response
      try {
        textContent = currentResponse.text() || '';
      } catch (e) {}

      // If textContent is empty, provide a meaningful fallback based on function calls
      if (!textContent) {
        if (allFunctionCalls.length > 0) {
          logger.warn(`Gemini returned empty text after ${allFunctionCalls.length} function calls in media mode`);
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
        }
      }

      if (allFunctionCalls.length > 0) {
        return {
          text: textContent,
          functionCall: {
            name: allFunctionCalls[0].name,
            args: allFunctionCalls[0].args as Record<string, any>,
          },
        };
      }

      return { text: textContent };'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open('src/services/GeminiService.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Media patch applied successfully.")
else:
    print("Could not find the target code to replace!")
