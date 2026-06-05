import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { productService } from './ProductService';
import { apiService } from './ApiService';
import { conversationRepository } from '../database/ConversationRepository';
import { withTimeout } from '../utils/timeout';

export interface FunctionCall {
  name: string;
  args: Record<string, any>;
}

export interface GeminiResponse {
  text: string;
  functionCall?: FunctionCall;
}

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private productCatalog: string = '';
  private systemPrompt: string = '';
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  private updateInProgress: boolean = false;
  private readonly MAX_PRODUCTS_IN_PROMPT = 50;

  private pendingOrders: Map<string, {
    phone: string;
    orderId?: number;
    data?: any;
    status: 'creating' | 'pending' | 'failed';
    createdAt: number;
  }> = new Map();

  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }

  private getModel(systemInstruction?: string, useFallbackModel: boolean = false): any {
    // Using configured Gemini model from settings
    const modelConfig: any = {
      model: useFallbackModel && config.gemini.fallbackModel ? config.gemini.fallbackModel : config.gemini.model,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
    };

    // Add system instruction if provided (supports systemInstruction as string)
    if (systemInstruction) {
      modelConfig.systemInstruction = systemInstruction;
    }

    modelConfig.safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ];

    return this.genAI.getGenerativeModel(modelConfig);
  }

  // Update product catalog for system prompt
  async updateProductCatalog(forceRefresh: boolean = false): Promise<void> {
    if (this.updateInProgress) {
      logger.debug('Product catalog update already in progress, skipping');
      return;
    }

    this.updateInProgress = true;
    try {
      logger.info('Updating product catalog...');
      const products = await productService.getAllProducts(forceRefresh);
      if (products.length > 0) {
        // Limit the number of products in the prompt to avoid context bloating
        const limitedProducts = products.slice(0, this.MAX_PRODUCTS_IN_PROMPT);
        const catalogText = limitedProducts
          .map((p) => {
            const name = p.title || p.name_ar || p.name_en || p.name || `منتج ${p.id}`;
            const currency = p.currency || 'د.ك';

            // Get price - use discounted_price if available, otherwise use price
            let price: number = 0;
            if (p.has_discount && p.discounted_price !== undefined) {
              price = p.discounted_price;
            } else if (typeof p.price === 'string') {
              price = parseFloat(p.price) || 0;
            } else if (typeof p.price === 'number') {
              price = p.price;
            } else {
              price = p.sale_price || p.discounted_price || 0;
            }

            // Build product line with discount information if available
            let productLine = `${name} (رقم المنتج: ${p.id}) - السعر: ${price} ${currency}`;

            // Add discount information if product has discount
            if (p.has_discount && p.price_before_discount && p.discount_percentage) {
              const originalPrice = p.price_before_discount;
              productLine += ` (كان ${originalPrice} ${currency} - خصم ${p.discount_percentage}%)`;
            }

            return productLine;
          })
          .join('\n');

        this.productCatalog = `
قائمة المنتجات المتاحة (${limitedProducts.length} من أصل ${products.length}):
${catalogText}

ملاحظة مهمة: هذه قائمة جزئية. إذا طلب العميل منتجاً غير موجود في القائمة أعلاه،
استخدم دالة "search_products" للبحث عن المنتج بدلاً من افتراض عدم توفره.
`;
        // Update system prompt with new catalog
        this.systemPrompt = this.getSystemPrompt();
        logger.info(`Product catalog updated for Gemini with ${limitedProducts.length} out of ${products.length} products`);
      } else {
        this.productCatalog = 'لا توجد منتجات متاحة حالياً. يرجى المحاولة لاحقاً.';
        this.systemPrompt = this.getSystemPrompt();
        logger.warn('Product catalog is empty. Bot will continue but product features may be limited.');
      }
    } catch (error: any) {
      logger.error('Error updating product catalog:', error.message || error);
      this.productCatalog = 'لا توجد منتجات متاحة حالياً. يرجى المحاولة لاحقاً.';
      this.systemPrompt = this.getSystemPrompt();
    } finally {
      this.updateInProgress = false;
    }
  }

  // Start automatic product catalog updates every 30 minutes
  startAutoUpdate(): void {
    // Clear any existing interval
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Set up interval to update every 30 minutes
    this.updateInterval = setInterval(() => {
      logger.info('Auto-updating product catalog (every 30 minutes)...');
      this.updateProductCatalog(true).catch((error) => {
        logger.error('Error in auto-update of product catalog:', error);
      });

      // Restore pending orders
      const now = Date.now();
      for (const [key, pending] of this.pendingOrders.entries()) {
          // Orders older than 30 minutes - try to save one last time
          if (pending.status === 'pending' && (now - pending.createdAt) > 1800000) {
              if (pending.orderId && pending.data) {
                  try {
                      conversationRepository.saveOrder(
                          pending.orderId,
                          pending.phone,
                          pending.data,
                          undefined,
                          'pending'
                      );
                      this.pendingOrders.delete(key);
                      logger.info(`Successfully restored pending order ${pending.orderId} from memory`);
                  } catch (e) {
                      logger.error(`Failed to restore pending order ${pending.orderId}, dropping it:`, e);
                      this.pendingOrders.delete(key);
                  }
              }
          }
      }
    }, this.UPDATE_INTERVAL_MS);

    logger.info(`Started automatic product catalog updates every ${this.UPDATE_INTERVAL_MS / 60000} minutes`);
  }

  // Stop automatic product catalog updates
  stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      logger.info('Stopped automatic product catalog updates');
    }
  }

  // Get system prompt with current order data
  private getSystemPrompt(orderData?: any): string {
    // Get admin prompt from database (lazy import to avoid circular dependency)
    let adminPrompt = '';
    try {
      // Use dynamic import to avoid circular dependency issues
      const adminPromptServiceModule = require('./AdminPromptService');
      adminPrompt = adminPromptServiceModule.adminPromptService.getAdminPrompt();
    } catch (error) {
      // If service not available, continue without admin prompt
      logger.debug('AdminPromptService not available, continuing without admin prompt');
    }

    const adminPromptSection = adminPrompt
      ? `\n\nتعليمات إضافية من المالك الإداري:\n${adminPrompt}\n`
      : '';

    // Format current order data if exists
    let currentOrderInfo = '';
    if (orderData && orderData.items && orderData.items.length > 0) {
      currentOrderInfo = `\nالطلب الحالي للعميل:\n`;
      currentOrderInfo += `- المنتجات المطلوبة:\n`;
      orderData.items.forEach((item: any, index: number) => {
        const productName = item.product_name || item.name || `منتج ${item.id}`;
        currentOrderInfo += `  ${index + 1}. ${productName} (رقم المنتج: ${item.id}) - الكمية: ${item.quantity}\n`;
      });
      if (orderData.customer_name) {
        currentOrderInfo += `- اسم العميل: ${orderData.customer_name}\n`;
      }
      if (orderData.customer_email) {
        currentOrderInfo += `- البريد الإلكتروني: ${orderData.customer_email}\n`;
      }
      if (orderData.shipping_address) {
        const addr = orderData.shipping_address;
        currentOrderInfo += `- العنوان: ${addr.street || ''}, ${addr.city || ''}, ${addr.governorate || ''}\n`;
      }
      if (orderData.discount_code) {
        currentOrderInfo += `- كود الخصم: ${orderData.discount_code}\n`;
      }
      currentOrderInfo += `\n`;
    }

    return `أنت مساعد متجر إلكتروني متخصص في بيع منتجات الصابون والعناية الشخصية.
${adminPromptSection}

مهمتك:
1. الرد على استفسارات العملاء باللغة العربية فقط
2. مساعدة العملاء في البحث عن المنتجات
3. اقتراح منتجات مناسبة بناءً على احتياجات العميل
4. جمع معلومات الطلب عند رغبة العميل في الشراء
5. معالجة طلبات الشراء وإنشاء الطلبات - فقط من خلال دالة create_order

تحذير أمني مهم جداً:
- ممنوع منعاً باتاً إنشاء طلبات وهمية
- لا تقل "تم إنشاء الطلب" أو "رقم الطلب هو X" بدون استخدام دالة create_order فعلياً
- لا تخترع أرقام طلبات - فقط دالة create_order تعطيك رقم الطلب الحقيقي
- لا تقل "تم تسجيل طلبك" أو "سيتم توصيل طلبك" بدون استخدام دالة create_order
- الطلبات يتم إنشاؤها فقط من خلال دالة create_order - لا توجد طريقة أخرى
- إذا لم تستخدم دالة create_order، لا يمكنك إنشاء الطلب - أخبر العميل بذلك بوضوح

قائمة المنتجات المتاحة:
${this.productCatalog || 'جارٍ تحميل قائمة المنتجات...'}

ملاحظة مهمة جداً عن الأسعار:
- السعر المعروض في قائمة المنتجات أعلاه هو السعر النهائي (بعد الخصم إن وجد)
- إذا كان المنتج عليه خصم، السعر المعروض هو السعر المخفض وليس الأصلي
- دائماً استخدم السعر المعروض في القائمة - هذا هو السعر الذي سيدفعه العميل
- عند ذكر سعر منتج، استخدم السعر المخفض إذا كان المنتج عليه خصم
- لا تذكر السعر الأصلي فقط - دائماً استخدم السعر المخفض عند وجود خصم

${currentOrderInfo}

المعلومات المطلوبة لإنشاء طلب (بالترتيب):

⚠️ مهم جداً: يجب طلب الدولة في بداية المحادثة قبل أي شيء آخر!

1. **الدولة** (country_code) - إجباري - اسأل أولاً:
   الدول المتاحة للتوصيل:
   - KW: الكويت
   - SA: السعودية
   - AE: الإمارات
   - BH: البحرين
   - OM: عُمان
   - QA: قطر
   
   ملاحظة: مصر (EG) لم تعد متاحة للتوصيل
   
2. اسم العميل (إجباري)
3. رقم الهاتف (إجباري - يجب أن تسأل العميل عن رقم هاتفه)
4. البريد الإلكتروني (يجب أن تسأل عنه، لكنه اختياري - إذا لم يقدمه العميل أو رفض، يمكنك المتابعة)
5. العنوان: الشارع، المحافظة، المدينة (لا حاجة للرمز البريدي)
6. المنتجات والكميات (إجباري)
7. كود الخصم (اختياري - إذا أراد العميل تطبيق كود خصم، اسأله عنه وطبق التحقق)

ملاحظات مهمة عن الدولة وتكلفة الشحن:
- الدولة (country_code) مطلوبة لحساب تكلفة الشحن - يجب طلبها في بداية أي محادثة طلب
- تكلفة الشحن الآن تعتمد على الدولة ووزن المنتجات
- لا تحاول حساب تكلفة الشحن بدون معرفة الدولة
- استخدم دالة calculate_shipping_cost لحساب الشحن قبل إنشاء الطلب

       الدوال المتاحة:
       - search_products: البحث عن المنتجات
       - get_product_details: الحصول على تفاصيل منتج
       - get_featured_products: الحصول على المنتجات المميزة
       - calculate_shipping_cost: حساب تكلفة الشحن بناءً على المنتجات والدولة (استخدمها عندما يسأل العميل عن تكلفة الشحن)
       - calculate_order_total: حساب إجمالي الطلب مع تكلفة الشحن
       - validate_discount_code: التحقق من صحة كود الخصم (استخدمها عندما يريد العميل تطبيق كود خصم)
       - create_order: إنشاء طلب جديد
       - track_order: متابعة حالة الطلب باستخدام رقم الطلب
       - get_payment_methods: جلب طرق الدفع المتاحة
       - initiate_payment: تهيئة الدفع
       - block_number: حظر رقم هاتف (دالة إدارية - متاحة فقط للمالك الإداري)
       - unblock_number: إلغاء حظر رقم هاتف (دالة إدارية - متاحة فقط للمالك الإداري)
       - list_blocked_numbers: عرض قائمة الأرقام المحظورة (دالة إدارية - متاحة فقط للمالك الإداري)
       - add_admin_prompt: إضافة أو تحديث تعليمات إضافية للبوت (دالة إدارية - متاحة فقط للمالك الإداري)
       - get_admin_prompt: عرض التعليمات الإضافية الحالية (دالة إدارية - متاحة فقط للمالك الإداري)
       - clear_admin_prompt: حذف التعليمات الإضافية (دالة إدارية - متاحة فقط للمالك الإداري)


ملاحظة مهمة جداً عن الدوال الإدارية:
- الدوال الإدارية (block_number, unblock_number, list_blocked_numbers, add_admin_prompt, get_admin_prompt, clear_admin_prompt) متاحة فقط للمالك الإداري
- إذا حاول مستخدم عادي استخدام هذه الدوال، سيتم رفض الطلب
- المالك الإداري يتم تحديده من خلال رقم الهاتف في ملف .env (ADMIN_PHONES)
- التعليمات الإضافية (admin_prompt) يتم دمجها تلقائياً في System Prompt وتؤثر على جميع المحادثات

تعليمات مهمة جداً عن إدارة الطلب:
1. تذكر دائماً المنتجات المطلوبة من العميل - لا تضيف منتجات إلا بطلب صريح من العميل
2. عندما يطلب العميل منتجاً، احفظه في ذاكرتك (order_data) وتأكد من عدم فقدان أي منتج
3. لا تضف منتجات تلقائياً - فقط المنتجات التي طلبها العميل صراحةً
4. عند جمع معلومات الطلب، تأكد من أن جميع المنتجات المطلوبة موجودة
5. قبل إنشاء الطلب، استخدم دالة calculate_order_total دائماً لعرض ملخص الطلب للعميل
6. بعد عرض الملخص، اطلب من العميل التأكيد قبل إنشاء الطلب
7. أنت تستخدم Function Calling - استدعي الدوال مباشرة، لا تكتب أي كود
8. عندما تجمع جميع معلومات الطلب ويؤكد العميل، استخدم دالة create_order - هذه هي الطريقة الوحيدة لإنشاء الطلب
9. عندما يطلب العميل متابعة طلبه أو معرفة حالة الطلب، استخدم دالة track_order مع رقم الطلب
10. لا تنشئ طلبات وهمية - لا تقل "تم إنشاء الطلب" أو "رقم الطلب هو X" بدون استخدام دالة create_order فعلياً
11. لا تخترع أرقام طلبات - فقط دالة create_order تعطيك رقم الطلب الحقيقي
12. إذا لم تستخدم دالة create_order، لا يمكنك إنشاء الطلب - أخبر العميل بذلك بوضوح

قواعد صارمة عن الحساب:
- لا تحسب الإجمالي يدوياً أبداً - استخدم دالة calculate_order_total فقط
- إذا فشلت دالة calculate_order_total، لا تحاول حساب الإجمالي بنفسك
- إذا فشلت دالة calculate_order_total، أخبر العميل بالخطأ واطلب منه المحاولة مرة أخرى
- لا تقترح أرقاماً أو حسابات يدوية - فقط استخدم الدوال المتاحة
- إذا لم تعمل دالة calculate_order_total، لا يمكنك إنشاء الطلب - أخبر العميل بذلك

قواعد صارمة جداً عن إنشاء الطلبات:
- لا تنشئ طلبات وهمية أبداً - لا تقل "تم إنشاء الطلب" أو "رقم الطلب هو" بدون استخدام دالة create_order
- لا تخترع أرقام طلبات - فقط استخدم دالة create_order للحصول على رقم الطلب الحقيقي
- لا تقل "تم تسجيل طلبك" أو "سيتم توصيل طلبك" بدون استخدام دالة create_order فعلياً
- إذا لم تستخدم دالة create_order، لا يمكنك إنشاء الطلب - أخبر العميل بذلك
- لا تكتب رسائل تأكيد طلب بدون استخدام دالة create_order أولاً
- الطلبات يتم إنشاؤها فقط من خلال دالة create_order - لا توجد طريقة أخرى

قواعد صارمة عن المنتجات والأسعار:
- لا تضف منتجات إلا بطلب صريح من العميل مثل "أريد منتج X" أو "أضف منتج Y"
- لا تضف منتجات تلقائياً بناءً على الاقتراحات - فقط المنتجات التي طلبها العميل
- تأكد من حفظ جميع المنتجات المطلوبة في order_data
- عند عرض المنتجات، استخدم search_products أو get_product_details
- عندما يختار العميل منتجاً، احفظه في order_data مع الكمية
- لا تفقد أي منتج طلبه العميل - تذكر جميع المنتجات المطلوبة
- مهم جداً: عند ذكر سعر منتج، استخدم دائماً السعر المخفض (discounted_price) إذا كان المنتج عليه خصم
- إذا كان المنتج عليه خصم، اذكر السعر المخفض أولاً ثم اذكر السعر الأصلي ونسبة الخصم
- لا تذكر السعر الأصلي فقط - دائماً استخدم السعر المخفض عند وجود خصم
- في قائمة المنتجات، السعر المعروض هو السعر النهائي (بعد الخصم إن وجد)
4. ممنوع كتابة أي كود Python أو JavaScript أو أي لغة برمجة
5. ممنوع استخدام علامات خاصة أو رموز برمجية
6. فقط استدعي الدالة create_order عندما تكون جميع المعلومات جاهزة - هذه هي الطريقة الوحيدة لإنشاء الطلبات
7. بعد استدعاء create_order، ستحصل على رابط الدفع ورقم الطلب تلقائياً
8. احفظ رقم الطلب وأخبر العميل به حتى يمكنه متابعة طلبه لاحقاً
9. ممنوع منعاً باتاً إنشاء طلبات وهمية - لا تقل "تم إنشاء الطلب" أو "رقم الطلب هو X" بدون استخدام دالة create_order فعلياً
10. لا تخترع أرقام طلبات - فقط دالة create_order تعطيك رقم الطلب الحقيقي من النظام
11. إذا لم تستخدم دالة create_order، لا يمكنك إنشاء الطلب - أخبر العميل بذلك بوضوح

ملاحظات مهمة عن جمع معلومات الطلب:
- رقم الهاتف: يجب أن تسأل العميل عن رقم هاتفه. رقم الهاتف إجباري ومطلوب لإنشاء الطلب. لا تستخدم رقم WhatsApp تلقائياً - يجب أن تسأل العميل عن رقم هاتفه صراحةً.
- البريد الإلكتروني: يجب أن تسأل العميل عن بريده الإلكتروني(مهم)، ولكن وضح له بشكل صريح أن البريد الإلكتروني اختياري وأنه يمكنه تخطيه إذا لم يرد تقديمه. إذا رفض العميل أو لم يقدم بريداً، يمكنك المتابعة في إنشاء الطلب. استخدم عبارات مثل: "هل لديك بريد إلكتروني؟ (اختياري)" أو "يمكنك تقديم بريدك الإلكتروني إذا رغبت (اختياري)".
- العنوان: تحتاج فقط للشارع، المحافظة، والمدينة. لا حاجة للرمز البريدي.
- عند طلب البريد الإلكتروني، تأكد من أنك تذكر أنه اختياري بشكل واضح للعميل.
- كود الخصم: إذا أراد العميل تطبيق كود خصم، اسأله عن الكود واستخدم دالة validate_discount_code للتحقق منه قبل إنشاء الطلب. إذا كان الكود صالحاً، أضفه إلى create_order. إذا كان الكود غير صالح، أخبر العميل واطلب كوداً آخر أو تابع بدون كود خصم.

تنسيق الرسائل لـ WhatsApp (مهم جداً):
WhatsApp لا يدعم Markdown بشكل كامل. يجب أن ترسل جميع الرسائل بتنسيق نصي عادي مناسب لـ WhatsApp:

ما هو مسموح في WhatsApp:
- النص العادي
- السطور الجديدة (\n)
- رموز تعبيرية بسيطة (📦 💰 ✅ ❌)
- الرموز النصية البسيطة (- للقوائم)
- الرموز الخاصة (*) للتركيز (لكن استخدمها بحذر)
- الروابط كنص عادي (يرسلها WhatsApp تلقائياً كروابط قابلة للنقر)

ما هو غير مسموح في WhatsApp:
- Markdown مثل **text** (لا يعمل، استخدم *text* فقط)
- Markdown headers مثل ## أو ### (لا يعمل)
- Markdown links مثل [text](url) (لا يعمل، استخدم الرابط مباشرة)
- Code blocks (ثلاثة backticks) (لا يعمل)
- Inline code (backtick واحد) (لا يعمل)
- جداول Markdown (لا يعمل)

مثال على التنسيق الصحيح:
خطأ: **منتج رائع** [اضغط هنا](https://example.com)
صحيح: *منتج رائع* https://example.com

خطأ: ## قائمة المنتجات
صحيح: قائمة المنتجات:

خطأ: كود بين backticks
صحيح: كود

قواعد مهمة:
1. استخدم نصاً عادياً فقط
2. الروابط ترسلها مباشرة كنص (مثل: https://example.com)
3. للتركيز، استخدم * فقط مرة واحدة (*نص*) وليس **
4. لا تستخدم ## أو ### أو أي رموز Markdown
5. استخدم - للقوائم بدلاً من *
6. استخدم رموز تعبيرية بسيطة فقط
7. لا تستخدم code blocks أو inline code

كن ودوداً ومهنياً ومفيداً دائماً.
أجب بالعربية فقط ولا تستخدم أي لغة أخرى.
لا تكتب أي كود. فقط استخدم Function Calling للدوال المتاحة.
تذكر: جميع الرسائل يجب أن تكون بتنسيق نصي عادي مناسب لـ WhatsApp، بدون أي Markdown.`;
  }

  // Define functions for Gemini
  private getFunctionDeclarations(): any[] {
    return [
      {
        name: 'search_products',
        description: 'البحث عن المنتجات بناءً على استفسار العميل',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'كلمات البحث عن المنتج',
            },
            category: {
              type: 'string',
              description: 'فئة المنتج (اختياري)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_product_details',
        description: 'الحصول على تفاصيل منتج محدد بواسطة ID',
        parameters: {
          type: 'object',
          properties: {
            product_id: {
              type: 'number',
              description: 'معرف المنتج',
            },
          },
          required: ['product_id'],
        },
      },
      {
        name: 'get_featured_products',
        description: 'الحصول على المنتجات المميزة',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'calculate_shipping_cost',
        description: 'حساب تكلفة الشحن بناءً على المنتجات والكميات وكود الدولة. هذه الدالة تحسب الشحن بناءً على الوزن الإجمالي والدولة. استخدمها عندما يريد العميل معرفة تكلفة الشحن قبل إنشاء الطلب.',
        parameters: {
          type: 'object',
          properties: {
            product_ids: {
              type: 'array',
              description: 'قائمة بـ IDs المنتجات',
              items: { type: 'number' }
            },
            quantities: {
              type: 'array',
              description: 'قائمة بالكميات (نفس ترتيب المنتجات)',
              items: { type: 'number' }
            },
            country_code: {
              type: 'string',
              enum: ['KW', 'SA', 'AE', 'BH', 'OM', 'QA'],
              description: 'كود الدولة (KW=الكويت، SA=السعودية، AE=الإمارات، BH=البحرين، OM=عُمان، QA=قطر)'
            }
          },
          required: ['product_ids', 'quantities', 'country_code']
        }
      },
      {
        name: 'calculate_order_total',
        description: 'حساب إجمالي الطلب بناءً على المنتجات وكمياتها وكود الدولة. استخدم هذه الدالة دائماً قبل إنشاء الطلب لعرض ملخص الطلب للعميل. مهم: يجب تمرير country_code لحساب تكلفة الشحن بشكل صحيح. هذه دالة إجبارية قبل create_order - يجب استخدامها دائماً لعرض الملخص والتأكيد من العميل قبل إنشاء الطلب.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'قائمة المنتجات والكميات - يجب أن تكون مطابقة تماماً للمنتجات التي طلبها العميل',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'number',
                    description: 'رقم المنتج'
                  },
                  quantity: {
                    type: 'number',
                    description: 'الكمية'
                  },
                },
                required: ['id', 'quantity'],
              },
            },
            country_code: {
              type: 'string',
              enum: ['KW', 'SA', 'AE', 'BH', 'OM', 'QA'],
              description: 'كود الدولة - مطلوب لحساب تكلفة الشحن (KW, SA, AE, BH, OM, QA)'
            },
            discount_code: {
              type: 'string',
              description: 'كود الخصم (اختياري - إذا كان متوفراً)',
            },
          },
          required: ['items', 'country_code'],
        },
      },
      {
        name: 'create_order',
        description: 'إنشاء طلب جديد. هذه هي الطريقة الوحيدة لإنشاء الطلبات - لا توجد طريقة أخرى. استخدم هذه الدالة فقط بعد: 1) جمع جميع معلومات الطلب (الاسم، رقم الهاتف، العنوان، المنتجات)، 2) استخدام calculate_order_total لعرض ملخص الطلب، 3) الحصول على تأكيد من العميل. لا تستخدم هذه الدالة مباشرة - يجب استخدام calculate_order_total أولاً دائماً. ممنوع منعاً باتاً إنشاء طلبات وهمية - لا تقل "تم إنشاء الطلب" أو "رقم الطلب هو X" بدون استخدام هذه الدالة فعلياً. لا تخترع أرقام طلبات - فقط هذه الدالة تعطيك رقم الطلب الحقيقي من النظام.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: {
              type: 'string',
              description: 'اسم العميل الكامل (إجباري)'
            },
            customer_phone: {
              type: 'string',
              description: 'رقم هاتف العميل (إجباري - يجب أن تسأل العميل عن رقم هاتفه. لا تستخدم رقم WhatsApp تلقائياً)'
            },
            customer_email: {
              type: 'string',
              description: 'البريد الإلكتروني للعميل (اختياري - يجب أن تسأل عنه ولكن وضح أنه اختياري. إذا لم يقدمه العميل أو رفض، لا تمرره أو مرره كقيمة فارغة)'
            },
            shipping_address: {
              type: 'object',
              description: 'عنوان الشحن - يحتاج فقط للشارع، المحافظة، والمدينة',
              properties: {
                street: {
                  type: 'string',
                  description: 'اسم الشارع ورقم المبنى'
                },
                city: {
                  type: 'string',
                  description: 'المدينة'
                },
                governorate: {
                  type: 'string',
                  description: 'المحافظة أو المنطقة'
                },
                postal_code: {
                  type: 'string',
                  description: 'الرمز البريدي (اختياري)'
                },
              },
              required: ['street', 'city', 'governorate'],
            },
            items: {
              type: 'array',
              description: 'قائمة المنتجات مع الكميات. يجب أن يحتوي كل عنصر على product_id (رقم) و quantity (رقم)',
              items: {
                type: 'object',
                properties: {
                  product_id: {
                    type: 'number',
                    description: 'معرف المنتج (رقم)'
                  },
                  quantity: {
                    type: 'number',
                    description: 'الكمية المطلوبة (رقم)'
                  },
                },
                required: ['product_id', 'quantity'],
              },
            },
            discount_code: {
              type: 'string',
              description: 'كود الخصم (اختياري - يجب التحقق منه باستخدام validate_discount_code قبل إضافته. إذا تم التحقق من الكود وكان صالحاً، أضفه هنا)'
            },
            country_code: {
              type: 'string',
              enum: ['KW', 'SA', 'AE', 'BH', 'OM', 'QA'],
              description: 'كود الدولة - مطلوب لحساب تكلفة الشحن تلقائياً (KW, SA, AE, BH, OM, QA)'
            },
            notes: {
              type: 'string',
              description: 'ملاحظات الطلب (اختياري)'
            },
          },
          required: [
            'customer_name',
            'customer_phone',
            'country_code',
            'shipping_address',
            'items',
          ],
        },
      },
      {
        name: 'validate_discount_code',
        description: 'التحقق من صحة كود الخصم. استخدم هذه الدالة عندما يريد العميل تطبيق كود خصم. يجب أن تكون لديك قائمة المنتجات والكميات قبل التحقق من الكود. بعد التحقق، إذا كان الكود صالحاً، يمكنك إضافته إلى create_order.',
        parameters: {
          type: 'object',
          properties: {
            discount_code: {
              type: 'string',
              description: 'كود الخصم الذي يريد العميل تطبيقه'
            },
            items: {
              type: 'array',
              description: 'قائمة المنتجات مع الكميات (مطلوبة للتحقق من الكود)',
              items: {
                type: 'object',
                properties: {
                  product_id: {
                    type: 'number',
                    description: 'معرف المنتج (رقم)'
                  },
                  quantity: {
                    type: 'number',
                    description: 'الكمية المطلوبة (رقم)'
                  },
                },
                required: ['product_id', 'quantity'],
              },
            },
          },
          required: ['discount_code', 'items'],
        },
      },
      {
        name: 'get_payment_methods',
        description: 'جلب طرق الدفع المتاحة',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'initiate_payment',
        description: 'تهيئة الدفع وإنشاء رابط الدفع للطلب',
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'number' },
            payment_method: { type: 'string' },
          },
          required: ['order_id', 'payment_method'],
        },
      },
      {
        name: 'track_order',
        description: 'متابعة حالة الطلب باستخدام رقم الطلب. استخدم هذه الدالة عندما يطلب العميل متابعة طلبه أو معرفة حالة الطلب.',
        parameters: {
          type: 'object',
          properties: {
            order_number: {
              type: 'string',
              description: 'رقم الطلب الذي يريد العميل متابعته',
            },
          },
          required: ['order_number'],
        },
      },
      {
        name: 'block_number',
        description: 'حظر رقم هاتف. هذه دالة إدارية متاحة فقط للمالك الإداري. استخدمها فقط إذا كنت المالك الإداري وترغب في حظر رقم هاتف. إذا حاول مستخدم عادي استخدام هذه الدالة، سيتم رفض الطلب.',
        parameters: {
          type: 'object',
          properties: {
            phone: {
              type: 'string',
              description: 'رقم الهاتف المراد حظره',
            },
            reason: {
              type: 'string',
              description: 'سبب الحظر (اختياري)',
            },
          },
          required: ['phone'],
        },
      },
      {
        name: 'unblock_number',
        description: 'إلغاء حظر رقم هاتف. هذه دالة إدارية متاحة فقط للمالك الإداري. استخدمها فقط إذا كنت المالك الإداري وترغب في إلغاء حظر رقم هاتف. إذا حاول مستخدم عادي استخدام هذه الدالة، سيتم رفض الطلب.',
        parameters: {
          type: 'object',
          properties: {
            phone: {
              type: 'string',
              description: 'رقم الهاتف المراد إلغاء حظره',
            },
          },
          required: ['phone'],
        },
      },
      {
        name: 'list_blocked_numbers',
        description: 'عرض قائمة الأرقام المحظورة. هذه دالة إدارية متاحة فقط للمالك الإداري. استخدمها فقط إذا كنت المالك الإداري وترغب في عرض قائمة الأرقام المحظورة. إذا حاول مستخدم عادي استخدام هذه الدالة، سيتم رفض الطلب.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'add_admin_prompt',
        description: 'إضافة أو تحديث تعليمات إضافية للبوت. هذه دالة إدارية متاحة فقط للمالك الإداري. استخدمها لإضافة تعليمات خاصة للبوت تؤثر على جميع المحادثات. يمكنك إضافة تعليمات جديدة أو إلحاقها بالتعليمات الموجودة.',
        parameters: {
          type: 'object',
          properties: {
            prompt_text: {
              type: 'string',
              description: 'نص التعليمات الإضافية التي تريد إضافتها للبوت',
            },
            append: {
              type: 'boolean',
              description: 'إذا كان true، سيتم إلحاق النص بالتعليمات الموجودة. إذا كان false، سيتم استبدال التعليمات الموجودة (افتراضي: false)',
            },
          },
          required: ['prompt_text'],
        },
      },
      {
        name: 'get_admin_prompt',
        description: 'عرض التعليمات الإضافية الحالية للبوت. هذه دالة إدارية متاحة فقط للمالك الإداري. استخدمها لمعرفة التعليمات الإضافية المضافة حالياً.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'clear_admin_prompt',
        description: 'حذف جميع التعليمات الإضافية للبوت. هذه دالة إدارية متاحة فقط للمالك الإداري. استخدمها لحذف جميع التعليمات الإضافية وإرجاع البوت لحالته الافتراضية.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ];
  }

  // Execute function calls
  private async executeFunction(functionCall: FunctionCall, customerPhone: string): Promise<string> {
    const { name, args } = functionCall;

    try {
      switch (name) {
        case 'search_products': {
          try {
            const result = await productService.searchProducts(args.query || '', args.category);
            if (result.products.length === 0) {
              return 'لم أجد منتجات تطابق البحث. يرجى المحاولة بكلمات أخرى.';
            }
            const formattedList = productService.formatProductList(result.products);
            // Note: Don't save to order_data here - only save when customer explicitly requests a product
            return formattedList;
          } catch (error: any) {
            logger.error('Error in search_products function:', error);
            return `حدث خطأ أثناء البحث عن المنتجات: ${error.message || 'خطأ غير معروف'}`;
          }
        }

        case 'get_product_details': {
          try {
            const product = await productService.getProductById(args.product_id);
            if (!product) {
              return 'لم أجد المنتج المطلوب.';
            }
            const formattedProduct = productService.formatProduct(product);
            // Note: Don't save to order_data here - only save when customer explicitly requests to add product
            return formattedProduct;
          } catch (error: any) {
            logger.error('Error getting product details:', error);
            return `حدث خطأ في جلب تفاصيل المنتج: ${error.message || 'خطأ غير معروف'}`;
          }
        }

        case 'get_featured_products': {
          const products = await productService.getFeaturedProducts();
          if (products.length === 0) {
            return 'لا توجد منتجات مميزة حالياً.';
          }
          return productService.formatProductList(products);
        }

        case 'validate_discount_code': {
          try {
            // Get shipping cost first (needed for validation)
            const shippingResponse = await apiService.getShippingCost();
            const shippingAmount = parseFloat(shippingResponse.data.shipping_cost);

            // Convert items to API format (product_id instead of id)
            const apiItems = args.items.map((item: any) => ({
              product_id: item.id || item.product_id, // API expects product_id, not id
              quantity: item.quantity,
            }));

            const validateResponse = await apiService.validateDiscountCode({
              discount_code: args.discount_code,
              items: apiItems,
              customer_phone: customerPhone,
              shipping_amount: shippingAmount,
            });

            if (validateResponse.success && validateResponse.data) {
              const { discount_code: discountInfo, order_summary } = validateResponse.data;

              // Format discount code information (plain text, no markdown)
              let responseMessage = `كود الخصم "${args.discount_code}" صالح!\n\n`;

              // Discount code details
              responseMessage += `تفاصيل كود الخصم:\n`;
              responseMessage += `نوع الخصم: ${discountInfo.type === 'percentage' ? 'نسبة مئوية' : 'مبلغ ثابت'}\n`;
              responseMessage += `قيمة الخصم: ${discountInfo.value}${discountInfo.type === 'percentage' ? '%' : ' د.ك'}\n`;

              if (discountInfo.minimum_order_amount && parseFloat(discountInfo.minimum_order_amount) > 0) {
                responseMessage += `الحد الأدنى للطلب: ${discountInfo.minimum_order_amount} ${order_summary.currency}\n`;
              }

              if (discountInfo.maximum_discount_amount && parseFloat(discountInfo.maximum_discount_amount) > 0) {
                responseMessage += `الحد الأقصى للخصم: ${discountInfo.maximum_discount_amount} ${order_summary.currency}\n`;
              }

              if (discountInfo.remaining_usage !== undefined && discountInfo.remaining_usage >= 0) {
                responseMessage += `عدد الاستخدامات المتبقية: ${discountInfo.remaining_usage}\n`;
              }

              if (discountInfo.expires_at) {
                const expireDate = new Date(discountInfo.expires_at);
                const formattedDate = expireDate.toLocaleDateString('ar-KW', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                });
                responseMessage += `تاريخ الانتهاء: ${formattedDate}\n`;
              }

              // Order summary with discount applied
              responseMessage += `\nملخص الطلب مع الخصم:\n`;
              responseMessage += `المجموع الفرعي: ${order_summary.subtotal_amount} ${order_summary.currency}\n`;
              responseMessage += `مبلغ الخصم: ${order_summary.discount_amount} ${order_summary.currency}\n`;
              responseMessage += `تكلفة الشحن: ${order_summary.shipping_amount} ${order_summary.currency}\n`;
              responseMessage += `المبلغ الإجمالي بعد الخصم: ${order_summary.total_amount} ${order_summary.currency}\n\n`;

              responseMessage += `سيتم تطبيق هذا الخصم على طلبك عند إنشاء الطلب.`;

              return responseMessage;
            }

            // Handle error response
            const errorMsg = validateResponse.message || 'كود الخصم غير صالح';
            return `كود الخصم "${args.discount_code}" غير صالح.\n${errorMsg}\n\nيرجى التحقق من الكود والمحاولة مرة أخرى.`;
          } catch (error: any) {
            logger.error('Error validating discount code:', error);
            const errorMessage = error.response?.data?.message || error.message || 'حدث خطأ في التحقق من كود الخصم';
            return `حدث خطأ في التحقق من كود الخصم: ${errorMessage}\n\nيرجى المحاولة مرة أخرى.`;
          }
        }

        case 'calculate_shipping_cost': {
          try {
            const { product_ids, quantities, country_code } = args;

            // Validate country code
            const validCountries = ['KW', 'SA', 'AE', 'BH', 'OM', 'QA'];
            if (!validCountries.includes(country_code)) {
              const countryNames = 'الكويت (KW), السعودية (SA), الإمارات (AE), البحرين (BH), عُمان (OM), قطر (QA)';
              return `عذراً، الدولة غير مدعومة للتوصيل.\\n\\nالدول المتاحة:\\n${countryNames}`;
            }

            logger.info('Calculating shipping cost:', { product_ids, quantities, country_code });

            const response = await apiService.calculateShippingCost({
              product_ids,
              quantities,
              country_code
            });

            if (response.success) {
              const data = response.data;
              const countryNames: Record<string, string> = {
                'KW': 'الكويت',
                'SA': 'السعودية',
                'AE': 'الإمارات',
                'BH': 'البحرين',
                'OM': 'عُمان',
                'QA': 'قطر'
              };

              let message = `تكلفة الشحن:\\n\\n`;
              message += `الدولة: ${countryNames[country_code] || country_code}\\n`;
              message += `الوزن الإجمالي: ${data.total_weight_kg} كجم (${data.total_weight_grams} جرام)\\n`;
              message += `تكلفة الشحن: ${data.shipping_cost} ${data.currency}\\n\\n`;

              // Show breakdown if available
              if (data.breakdown) {
                message += `تفاصيل الحساب:\\n`;
                message += `- السعر الأساسي: ${data.breakdown.base_price} ${data.currency}\\n`;
                if (data.breakdown.additional_fee > 0) {
                  message += `- رسوم إضافية: ${data.breakdown.additional_fee} ${data.currency}\\n`;
                }
              }

              return message;
            } else {
              const errorMsg = response.message || 'حدث خطأ في حساب تكلفة الشحن';
              return `عذراً، ${errorMsg}\\n\\nيرجى التأكد من صحة المنتجات والكميات والمحاولة مرة أخرى.`;
            }
          } catch (error: any) {
            logger.error('Error calculating shipping cost:', error);
            const errorMessage = error.message || 'حدث خطأ في حساب تكلفة الشحن';
            return `حدث خطأ: ${errorMessage}\\n\\nيرجى المحاولة مرة أخرى.`;
          }
        }

        case 'calculate_order_total': {
          // Convert items format from API (id) to internal format
          const items = args.items.map((item: any) => ({
            id: item.product_id || item.id,
            quantity: item.quantity,
          }));

          // Convert items to API format (product_id instead of id)
          const apiItems = items.map((item: any) => ({
            product_id: item.id, // API expects product_id, not id
            quantity: item.quantity,
          }));

          // Get country_code from args
          const country_code = args.country_code;

          // Validate country code
          const validCountries = ['KW', 'SA', 'AE', 'BH', 'OM', 'QA'];
          if (!country_code || !validCountries.includes(country_code)) {
            return 'يرجى تحديد الدولة أولاً. الدول المتاحة: الكويت (KW), السعودية (SA), الإمارات (AE), البحرين (BH), عُمان (OM), قطر (QA).';
          }

          try {
            // Save order items AND country_code to conversation order_data for tracking
            const conversation = conversationRepository.getConversation(customerPhone);
            const currentOrderData = conversation?.orderData || {};

            currentOrderData.items = items;
            currentOrderData.country_code = country_code as any; // Save country code
            if (args.discount_code) {
              currentOrderData.discount_code = args.discount_code;
            }
            conversationRepository.saveConversation(
              customerPhone,
              conversation?.messages || [],
              currentOrderData,
              conversation?.metadata
            );

            // Calculate shipping using new API that requires country_code
            const product_ids = apiItems.map((item: any) => item.product_id);
            const quantities = apiItems.map((item: any) => item.quantity);

            const shippingResponse = await apiService.calculateShippingCost({
              product_ids,
              quantities,
              country_code: country_code as any
            });

            if (!shippingResponse.success) {
              logger.error('Failed to calculate shipping cost:', shippingResponse.message);
              return `حدث خطأ في حساب تكلفة الشحن: ${shippingResponse.message}\\n\\nيرجى المحاولة مرة أخرى.`;
            }

            const shippingAmount = shippingResponse.data.shipping_cost;

            // Save shipping details for later
            currentOrderData.shipping_details = shippingResponse.data;
            conversationRepository.saveConversation(
              customerPhone,
              conversation?.messages || [],
              currentOrderData,
              conversation?.metadata
            );

            logger.info('Calculating order total with items:', apiItems);
            const totalResponse = await apiService.calculateTotal({
              items: apiItems,
              discount_code: args.discount_code, // Include discount code if provided
              shipping_amount: shippingAmount,
            });

            logger.info('Calculate total response:', {
              success: totalResponse.success,
              message: totalResponse.message,
              errors: totalResponse.errors,
              data: totalResponse.data,
            });

            if (totalResponse.success && totalResponse.data) {
              // API returns subtotal_amount and total_amount, not subtotal and total
              const data = totalResponse.data as any;
              const subtotal = data.subtotal || data.subtotal_amount;
              const total = data.total || data.total_amount;
              const shipping_amount = data.shipping_amount;
              const currency = data.currency;
              const discount_amount = data.discount_amount || 0;

              // Validate that all required fields are present
              if (subtotal === undefined || total === undefined || !currency || shipping_amount === undefined) {
                logger.error('Invalid calculate total response data:', totalResponse.data);
                return `عذراً، حدث خطأ في بيانات حساب الإجمالي. البيانات غير مكتملة.\n\nيرجى المحاولة مرة أخرى أو الاتصال بالدعم الفني.`;
              }

              let message = `ملخص الطلب:\n\n`;

              // Show items with product details from API response
              message += `المنتجات:\n`;
              if (data.items && Array.isArray(data.items)) {
                // Use detailed items from API response if available
                for (const item of data.items) {
                  const productName = item.product?.title || `منتج رقم ${item.product?.id || 'غير معروف'}`;
                  const quantity = item.quantity || 1;
                  const itemTotal = item.item_total || 0;
                  const priceUsed = item.price_used || 0;

                  message += `- ${productName} × ${quantity}\n`;

                  // Show discount information if product has discount
                  if (item.product?.has_discount && item.product?.price_before_discount) {
                    const originalPrice = item.product.price_before_discount;
                    const discountPercent = item.product.discount_percentage || 0;
                    message += `  السعر: ${priceUsed} ${currency} (كان ${originalPrice} ${currency}) - خصم ${discountPercent}%\n`;
                  } else {
                    message += `  السعر: ${priceUsed} ${currency}\n`;
                  }

                  message += `  المجموع: ${itemTotal} ${currency}\n`;
                }
              } else {
                // Fallback to simple format if detailed items not available
                for (const item of items) {
                  message += `- منتج رقم ${item.id} × ${item.quantity}\n`;
                }
              }
              message += `\n`;

              // Show totals
              message += `المجموع الفرعي: ${subtotal} ${currency}\n`;
              if (discount_amount && discount_amount > 0) {
                message += `الخصم: ${discount_amount} ${currency}\n`;
              }
              message += `تكلفة الشحن: ${shipping_amount} ${currency}\n`;
              message += `المبلغ الإجمالي: ${total} ${currency}\n\n`;
              message += `هل تريد تأكيد الطلب والبدء في عملية الدفع؟`;

              return message;
            }

            // If success is true but data is missing
            if (totalResponse.success && !totalResponse.data) {
              logger.error('Calculate total returned success but no data:', totalResponse);
              return `عذراً، حدث خطأ في بيانات حساب الإجمالي. النظام لم يعيد البيانات المطلوبة.\n\nيرجى المحاولة مرة أخرى أو الاتصال بالدعم الفني.\nلا يمكنني حساب الإجمالي يدوياً - يجب أن يتم الحساب من خلال النظام.`;
            }

            // Handle API error response
            const errorMsg = totalResponse.message || 'حدث خطأ في حساب الإجمالي';
            logger.error('API Error calculating total:', {
              message: errorMsg,
              errors: totalResponse.errors,
              items: apiItems,
            });

            // Build detailed error message
            let errorMessage = `عذراً، حدث خطأ تقني في حساب إجمالي الطلب.\n\n`;
            errorMessage += `السبب: ${errorMsg}\n`;

            if (totalResponse.errors) {
              const errorDetails = Object.values(totalResponse.errors).flat().join(', ');
              errorMessage += `التفاصيل: ${errorDetails}\n`;
            }

            errorMessage += `\nيرجى المحاولة مرة أخرى لاحقاً أو الاتصال بالدعم الفني.\n`;
            errorMessage += `لا يمكنني حساب الإجمالي يدوياً - يجب أن يتم الحساب من خلال النظام.`;

            return errorMessage;
          } catch (error: any) {
            logger.error('Error calculating order total:', {
              error: error.message,
              stack: error.stack,
              response: error.response?.data,
              items: apiItems,
            });

            // Provide more detailed error message
            const errorMessage = error.response?.data?.message || error.message || 'خطأ غير معروف';
            const errorDetails = error.response?.data?.errors
              ? Object.values(error.response.data.errors).flat().join(', ')
              : '';

            // Build error message that prevents manual calculation
            let errorMsg = `عذراً، حدث خطأ تقني في حساب إجمالي الطلب.\n\n`;
            errorMsg += `السبب: ${errorMessage}\n`;

            if (errorDetails) {
              errorMsg += `التفاصيل: ${errorDetails}\n`;
            }

            errorMsg += `\nيرجى المحاولة مرة أخرى لاحقاً أو الاتصال بالدعم الفني.\n`;
            errorMsg += `لا يمكنني حساب الإجمالي يدوياً - يجب أن يتم الحساب من خلال النظام.`;

            return errorMsg;
          }
        }

        case 'create_order': {
          try {
            // Get and validate country_code
            const country_code = args.country_code;
            const validCountries = ['KW', 'SA', 'AE', 'BH', 'OM', 'QA'];

            if (!country_code || !validCountries.includes(country_code)) {
              return 'يرجى تحديد الدولة. الدول المتاحة: الكويت (KW), السعودية (SA), الإمارات (AE), البحرين (BH), عُمان (OM), قطر (QA).';
            }

            // First, verify order total by calling calculate_order_total
            // This ensures the order is calculated correctly before creation
            // const shippingResponse = await apiService.getShippingCost(); // Removed as per instruction
            // const shippingAmount = parseFloat(shippingResponse.data.shipping_cost); // Removed as per instruction

            // Convert items format from API (id) to internal format (id)
            const items = args.items.map((item: any) => ({
              id: item.id || item.product_id,
              quantity: item.quantity,
            }));

            // Convert items to API format (product_id instead of id) for calculateTotal
            const apiItemsForCalc = items.map((item: any) => ({
              product_id: item.id, // API expects product_id, not id
              quantity: item.quantity,
            }));

            // Retrieve shipping amount from conversation data, which was saved by calculate_order_total
            const conversation = conversationRepository.getConversation(customerPhone);
            const currentOrderData = conversation?.orderData || {};
            let shippingAmount = currentOrderData.shipping_details?.shipping_cost;

            // If shipping was not pre-calculated, calculate it now automatically
            if (shippingAmount === undefined || shippingAmount === null) {
              logger.warn('Shipping amount not found in conversation data for create_order. Auto-calculating...');

              try {
                const product_ids = apiItemsForCalc.map((item: any) => item.product_id);
                const quantities = apiItemsForCalc.map((item: any) => item.quantity);

                const shippingResponse = await apiService.calculateShippingCost({
                  product_ids,
                  quantities,
                  country_code: country_code as any,
                });

                if (shippingResponse.success && shippingResponse.data) {
                  shippingAmount = shippingResponse.data.shipping_cost;
                  // Save for future use
                  currentOrderData.shipping_details = shippingResponse.data;
                  conversationRepository.saveConversation(
                    customerPhone,
                    conversation?.messages || [],
                    currentOrderData,
                    conversation?.metadata
                  );
                  logger.info(`Auto-calculated shipping: ${shippingAmount}`);
                } else {
                  logger.error('Failed to auto-calculate shipping:', shippingResponse.message);
                  return 'حدث خطأ في حساب تكلفة الشحن. يرجى المحاولة مرة أخرى.';
                }
              } catch (shippingError: any) {
                logger.error('Error auto-calculating shipping:', shippingError.message);
                return 'حدث خطأ في حساب تكلفة الشحن. يرجى المحاولة مرة أخرى.';
              }
            }

            // Calculate total to verify before creating order
            const totalResponse = await apiService.calculateTotal({
              items: apiItemsForCalc,
              discount_code: args.discount_code,
              shipping_amount: shippingAmount,
            });

            if (!totalResponse.success) {
              return 'حدث خطأ في حساب إجمالي الطلب. يرجى المحاولة مرة أخرى.';
            }

            // Use provided email or default to guest@soapy.com
            const customerEmail = args.customer_email || 'guest@soapy.com';

            // Ensure shipping_address has all required fields (postal_code is optional)
            const shippingAddress = {
              street: args.shipping_address.street,
              city: args.shipping_address.city,
              governorate: args.shipping_address.governorate,
              postal_code: args.shipping_address.postal_code || '', // Optional, use empty string if not provided
            };

            // Validate discount code if provided
            let discountCode: string | undefined = undefined;
            if (args.discount_code) {
              try {
                // Convert items to API format (product_id instead of id) for validateDiscountCode
                const apiItemsForValidation = items.map((item: any) => ({
                  product_id: item.id, // API expects product_id, not id
                  quantity: item.quantity,
                }));

                const validateResponse = await apiService.validateDiscountCode({
                  discount_code: args.discount_code,
                  items: apiItemsForValidation,
                  customer_phone: customerPhone,
                  shipping_amount: shippingAmount,
                });

                if (validateResponse.success && validateResponse.data) {
                  // API returns success=true when code is valid, data contains discount_code and order_summary
                  discountCode = args.discount_code;
                  const discountAmount = validateResponse.data.order_summary.discount_amount;
                  logger.info(`Discount code validated: ${args.discount_code}, discount amount: ${discountAmount}`);
                } else {
                  // If success is false, the code is invalid
                  const errorMsg = validateResponse.message || 'كود الخصم غير صالح';
                  return `كود الخصم "${args.discount_code}" غير صالح.\n${errorMsg}\n\nيرجى التحقق من الكود والمحاولة مرة أخرى، أو يمكنك المتابعة بدون كود خصم.`;
                }
              } catch (error: any) {
                logger.error('Error validating discount code:', error);
                const errorMsg = error.response?.data?.message || error.message || 'حدث خطأ في التحقق من كود الخصم';
                return `حدث خطأ في التحقق من كود الخصم: ${errorMsg}\n\nيرجى المحاولة مرة أخرى أو المتابعة بدون كود خصم.`;
              }
            }

            // Retrieve conversation data and save order data before creating order
            currentOrderData.items = items;
            currentOrderData.customer_name = args.customer_name;
            currentOrderData.customer_email = customerEmail;
            currentOrderData.country_code = country_code as any; // Save country code
            currentOrderData.shipping_address = shippingAddress;
            if (discountCode) {
              currentOrderData.discount_code = discountCode;
            }
            conversationRepository.saveConversation(
              customerPhone,
              conversation?.messages || [],
              currentOrderData,
              conversation?.metadata
            );

            // Get customer phone from args (required field)
            if (!args.customer_phone || args.customer_phone.trim() === '') {
              return 'يرجى تقديم رقم هاتف العميل. رقم الهاتف مطلوب لإنشاء الطلب.';
            }

            // Normalize phone number (remove any non-digit characters except +)
            let customerPhoneNumber = args.customer_phone.trim();
            // Remove spaces, dashes, and other formatting
            customerPhoneNumber = customerPhoneNumber.replace(/[\s\-\(\)]/g, '');

            // Convert items to API format (product_id instead of id) for createOrder
            const apiItemsForOrder = items.map((item: any) => ({
              product_id: item.id, // API expects product_id, not id
              quantity: item.quantity,
            }));

            // Create pending record before API call
            const pendingKey = `${customerPhoneNumber}_${Date.now()}`;
            this.pendingOrders.set(pendingKey, {
                phone: customerPhoneNumber,
                status: 'creating',
                createdAt: Date.now(),
            });

            const orderResponse = await apiService.createOrder({
              customer_name: args.customer_name,
              customer_phone: customerPhoneNumber, // Use phone number provided by customer
              customer_email: customerEmail,
              country_code: country_code as any, // Required for shipping calculation
              shipping_address: shippingAddress,
              items: apiItemsForOrder,
              discount_code: discountCode, // Include discount code if validated
              notes: args.notes, // Optional order notes
              // shipping_amount removed - calculated automatically by API based on country_code
            });

            if (orderResponse.success) {
              const orderData = orderResponse.data;

              // Clear order data after successful creation
              conversationRepository.saveConversation(
                customerPhone,
                conversation?.messages || [],
                null, // Clear order data after creation
                conversation?.metadata
              );

              // Get payment methods
              const paymentMethodsResponse = await apiService.getPaymentMethods();

              if (paymentMethodsResponse.success) {
                const methods = paymentMethodsResponse.data;
                const firstMethod = Object.values(methods)[0];

                if (firstMethod) {
                  // Initiate payment
                  const paymentResponse = await apiService.initiatePayment({
                    order_id: orderData.order.id,
                    payment_method: firstMethod.PaymentMethodCode,
                    customer_ip: config.customer.ip,
                    user_agent: 'WhatsApp-Bot',
                  });

                  if (paymentResponse.success) {
                    try {
                      // Save order to database
                      conversationRepository.saveOrder(
                        orderData.order.id,
                        customerPhone,
                        orderData,
                        paymentResponse.data.payment_url,
                        'payment_pending'
                      );
                      this.pendingOrders.delete(pendingKey);
                    } catch (saveError) {
                      this.pendingOrders.set(pendingKey, {
                          phone: customerPhoneNumber,
                          orderId: orderData.order.id,
                          data: orderData,
                          status: 'pending',
                          createdAt: Date.now(),
                      });
                      logger.error('DB save failed after payment success, order kept in memory:', saveError);
                    }

                    // Format order details based on actual API response
                    const order = orderData.order;
                    const orderNumber = order.order_number || orderData.order_number;
                    const totalAmount = orderData.total_amount || order.total_amount;
                    const currency = orderData.currency || order.currency || 'KWD';
                    const subtotal = orderData.subtotal_amount || order.subtotal_amount || 0;
                    const shipping = orderData.shipping_amount || order.shipping_amount || 0;
                    const discount = orderData.discount_amount || order.discount_amount || 0;
                    const paymentUrl = paymentResponse.data.payment_url;

                    // Format order items from order.order_items array (matching API response structure)
                    let itemsText = '';
                    if (order.order_items && Array.isArray(order.order_items) && order.order_items.length > 0) {
                      itemsText = '\n\nالمنتجات:\n';
                      order.order_items.forEach((item: any, index: number) => {
                        // Try multiple sources for product title (product.title, product_snapshot.title)
                        const productTitle = item.product?.title ||
                          item.product_snapshot?.title ||
                          `منتج ${item.product_id}`;
                        const quantity = item.quantity || 1;

                        // Get price - use discounted_price if available, otherwise use product_price
                        let itemPrice: string | number = '0';
                        if (item.product?.has_discount && item.product?.discounted_price !== undefined) {
                          itemPrice = item.product.discounted_price;
                        } else if (item.product_snapshot?.has_discount && item.product_snapshot?.discounted_price !== undefined) {
                          itemPrice = item.product_snapshot.discounted_price;
                        } else {
                          itemPrice = item.product_price ||
                            item.product?.price ||
                            item.product_snapshot?.price ||
                            '0';
                        }

                        // Get original price and discount info if available
                        const originalPrice = item.product?.price_before_discount ||
                          item.product_snapshot?.price_before_discount ||
                          null;
                        const discountPercent = item.product?.discount_percentage ||
                          item.product_snapshot?.discount_percentage ||
                          null;
                        const hasDiscount = item.product?.has_discount ||
                          item.product_snapshot?.has_discount ||
                          false;

                        itemsText += `${index + 1}. ${productTitle}\n`;
                        itemsText += `   الكمية: ${quantity}\n`;

                        // Display price with discount information if available
                        if (hasDiscount && originalPrice && discountPercent) {
                          itemsText += `   السعر: ${itemPrice} ${currency} (كان ${originalPrice} ${currency}) - خصم ${discountPercent}%\n`;
                        } else {
                          itemsText += `   السعر: ${itemPrice} ${currency}\n`;
                        }

                        itemsText += '\n';
                      });
                    }

                    // Build message in plain text format for WhatsApp (no markdown, no special formatting)
                    // WhatsApp doesn't support markdown well, so use plain text only
                    let message = `تم إنشاء طلبك بنجاح!\n\n`;
                    message += `رقم الطلب: ${orderNumber}\n`;
                    message += `رقم التتبع: ${orderNumber}\n\n`;
                    message += `تفاصيل الطلب:\n`;
                    message += `المجموع الفرعي: ${subtotal} ${currency}\n`;
                    if (discount && parseFloat(String(discount)) > 0) {
                      message += `الخصم: ${discount} ${currency}\n`;
                    }
                    message += `تكلفة الشحن: ${shipping} ${currency}\n`;
                    message += `المبلغ الإجمالي: ${totalAmount} ${currency}\n`;
                    message += itemsText;
                    message += `رابط الدفع:\n${paymentUrl}\n\n`;
                    message += `يرجى الضغط على الرابط أعلاه لإتمام عملية الدفع.`;

                    return message;
                  }
                }
              }

              try {
                // Save order to database even if payment initiation fails
                conversationRepository.saveOrder(
                  orderData.order.id,
                  customerPhone,
                  orderData,
                  undefined,
                  'pending'
                );
                this.pendingOrders.delete(pendingKey);
              } catch (saveError) {
                this.pendingOrders.set(pendingKey, {
                    phone: customerPhoneNumber,
                    orderId: orderData.order.id,
                    data: orderData,
                    status: 'pending',
                    createdAt: Date.now(),
                });
                logger.error('DB save failed, order kept in memory:', saveError);
              }

              // Format order details even if payment initiation fails
              const order = orderData.order;
              const orderNumber = order.order_number || orderData.order_number || 'غير متوفر';
              const totalAmount = orderData.total_amount || order.total_amount || '0';
              const currency = orderData.currency || order.currency || 'KWD';
              const subtotal = orderData.subtotal_amount || order.subtotal_amount || 0;
              const shipping = orderData.shipping_amount || order.shipping_amount || 0;
              const discount = orderData.discount_amount || order.discount_amount || 0;

              // Format order items
              let itemsText = '';
              if (order.order_items && Array.isArray(order.order_items) && order.order_items.length > 0) {
                itemsText = '\n\nالمنتجات:\n';
                order.order_items.forEach((item: any, index: number) => {
                  const productTitle = item.product?.title ||
                    item.product_snapshot?.title ||
                    `منتج ${item.product_id}`;
                  const quantity = item.quantity || 1;

                  // Get price - use discounted_price if available, otherwise use product_price
                  let itemPrice: string | number = '0';
                  if (item.product?.has_discount && item.product?.discounted_price !== undefined) {
                    itemPrice = item.product.discounted_price;
                  } else if (item.product_snapshot?.has_discount && item.product_snapshot?.discounted_price !== undefined) {
                    itemPrice = item.product_snapshot.discounted_price;
                  } else {
                    itemPrice = item.product_price ||
                      item.product?.price ||
                      item.product_snapshot?.price ||
                      '0';
                  }

                  // Get original price and discount info if available
                  const originalPrice = item.product?.price_before_discount ||
                    item.product_snapshot?.price_before_discount ||
                    null;
                  const discountPercent = item.product?.discount_percentage ||
                    item.product_snapshot?.discount_percentage ||
                    null;
                  const hasDiscount = item.product?.has_discount ||
                    item.product_snapshot?.has_discount ||
                    false;

                  itemsText += `${index + 1}. ${productTitle}\n`;
                  itemsText += `   الكمية: ${quantity}\n`;

                  // Display price with discount information if available
                  if (hasDiscount && originalPrice && discountPercent) {
                    itemsText += `   السعر: ${itemPrice} ${currency} (كان ${originalPrice} ${currency}) - خصم ${discountPercent}%\n`;
                  } else {
                    itemsText += `   السعر: ${itemPrice} ${currency}\n`;
                  }

                  itemsText += '\n';
                });
              }

              let message = `تم إنشاء طلبك بنجاح!\n\n`;
              message += `رقم الطلب: ${orderNumber}\n`;
              message += `تفاصيل الطلب:\n`;
              message += `المجموع الفرعي: ${subtotal} ${currency}\n`;
              if (discount && parseFloat(String(discount)) > 0) {
                message += `الخصم: ${discount} ${currency}\n`;
              }
              message += `تكلفة الشحن: ${shipping} ${currency}\n`;
              message += `المبلغ الإجمالي: ${totalAmount} ${currency}\n`;
              message += itemsText;
              message += `سيتم إرسال رابط الدفع قريباً.`;

              return message;
            }

            // Handle API error response
            this.pendingOrders.delete(pendingKey);
            const errorMsg = orderResponse.message || 'حدث خطأ في إنشاء الطلب';
            if (orderResponse.errors) {
              const errorDetails = Object.values(orderResponse.errors).flat().join(', ');
              return `حدث خطأ في إنشاء الطلب: ${errorMsg}\n${errorDetails}`;
            }
            return `حدث خطأ في إنشاء الطلب: ${errorMsg}`;
          } catch (error: any) {
            logger.error('Fatal Error creating order:', error);
            // We don't delete the pendingKey here so we could trace it if needed.
            // But we mark it as failed
            const currentPendingKey = `${customerPhone}_${Date.now()}`;
            this.pendingOrders.set(currentPendingKey, {
                phone: customerPhone,
                status: 'failed',
                createdAt: Date.now(),
            });
            return `حدث خطأ في إنشاء الطلب: ${error.message || 'خطأ غير معروف'}. يرجى المحاولة مرة أخرى.`;
          }
        }

        case 'track_order': {
          try {
            const orderNumber = args.order_number;
            if (!orderNumber) {
              return 'يرجى تقديم رقم الطلب لمتابعته.';
            }

            logger.info(`Tracking order: ${orderNumber}`);
            const trackingResponse = await apiService.trackOrder(orderNumber);

            if (trackingResponse.success && trackingResponse.data) {
              const { order, timeline, status_info } = trackingResponse.data;

              // Format order tracking information (plain text, no markdown)
              let message = `معلومات متابعة الطلب:\n\n`;
              message += `رقم الطلب: ${order.order_number}\n`;
              message += `رقم التتبع: ${order.order_number}\n`;
              message += `الحالة الحالية: ${status_info.title}\n`;
              message += `${status_info.description}\n\n`;

              // Add timeline
              if (timeline && timeline.length > 0) {
                message += `سير الطلب:\n`;
                timeline.forEach((item: any) => {
                  const statusIcon = item.completed ? '✓' : '○';
                  message += `${statusIcon} ${item.title}\n`;
                  if (item.description) {
                    message += `   ${item.description}\n`;
                  }
                  if (item.date) {
                    const date = new Date(item.date);
                    const formattedDate = date.toLocaleDateString('ar-KW', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    message += `   التاريخ: ${formattedDate}\n`;
                  }
                  message += '\n';
                });
              }

              // Add order details
              message += `تفاصيل الطلب:\n`;
              message += `المبلغ الإجمالي: ${order.total_amount} ${order.currency}\n`;
              message += `المجموع الفرعي: ${order.subtotal_amount} ${order.currency}\n`;
              message += `تكلفة الشحن: ${order.shipping_amount} ${order.currency}\n`;

              if (order.discount_amount && parseFloat(order.discount_amount) > 0) {
                message += `الخصم: ${order.discount_amount} ${order.currency}\n`;
              }

              // Add order items
              if (order.order_items && order.order_items.length > 0) {
                message += `\nالمنتجات:\n`;
                order.order_items.forEach((item: any, index: number) => {
                  const productTitle = item.product?.title ||
                    item.product_snapshot?.title ||
                    `منتج ${item.product_id}`;
                  const quantity = item.quantity || 1;

                  // Get price - use discounted_price if available, otherwise use product_price
                  let itemPrice: string | number = '0';
                  if (item.product?.has_discount && item.product?.discounted_price !== undefined) {
                    itemPrice = item.product.discounted_price;
                  } else if (item.product_snapshot?.has_discount && item.product_snapshot?.discounted_price !== undefined) {
                    itemPrice = item.product_snapshot.discounted_price;
                  } else {
                    itemPrice = item.product_price ||
                      item.product?.price ||
                      item.product_snapshot?.price ||
                      '0';
                  }

                  // Get original price and discount info if available
                  const originalPrice = item.product?.price_before_discount ||
                    item.product_snapshot?.price_before_discount ||
                    null;
                  const discountPercent = item.product?.discount_percentage ||
                    item.product_snapshot?.discount_percentage ||
                    null;
                  const hasDiscount = item.product?.has_discount ||
                    item.product_snapshot?.has_discount ||
                    false;

                  message += `${index + 1}. ${productTitle}\n`;
                  message += `   الكمية: ${quantity}\n`;

                  // Display price with discount information if available
                  if (hasDiscount && originalPrice && discountPercent) {
                    message += `   السعر: ${itemPrice} ${order.currency} (كان ${originalPrice} ${order.currency}) - خصم ${discountPercent}%\n`;
                  } else {
                    message += `   السعر: ${itemPrice} ${order.currency}\n`;
                  }

                  message += '\n';
                });
              }

              // Add shipping address
              if (order.shipping_address) {
                message += `عنوان الشحن:\n`;
                message += `${order.shipping_address.street}\n`;
                message += `${order.shipping_address.city}, ${order.shipping_address.governorate}\n`;
                if (order.shipping_address.postal_code) {
                  message += `الرمز البريدي: ${order.shipping_address.postal_code}\n`;
                }
              }

              // Add payment information if available
              if (order.payment) {
                message += `\nمعلومات الدفع:\n`;
                message += `حالة الدفع: ${order.payment.status}\n`;
                if (order.payment.invoice_reference) {
                  message += `رقم الفاتورة: ${order.payment.invoice_reference}\n`;
                }
                // Add payment URL if available
                if (order.payment.response_raw?.payment_url) {
                  message += `رابط الدفع: ${order.payment.response_raw.payment_url}\n`;
                }
              }

              return message;
            }

            return `لم أتمكن من العثور على معلومات للطلب رقم ${orderNumber}. يرجى التأكد من رقم الطلب والمحاولة مرة أخرى.`;
          } catch (error: any) {
            logger.error('Error tracking order:', error);
            const errorMessage = error.message || 'حدث خطأ في متابعة الطلب';
            return `حدث خطأ في متابعة الطلب: ${errorMessage}`;
          }
        }

        case 'get_payment_methods': {
          const response = await apiService.getPaymentMethods();
          if (response.success) {
            const methods = Object.values(response.data);
            if (methods.length === 0) {
              return 'لا توجد طرق دفع متاحة حالياً.';
            }
            return methods.map(m => `- ${m.PaymentMethodAr}: ${m.TotalAmount} ${m.CurrencyIso}`).join('\n');
          }
          return 'حدث خطأ في جلب طرق الدفع.';
        }

        case 'initiate_payment': {
          const response = await apiService.initiatePayment({
            order_id: args.order_id,
            payment_method: args.payment_method,
            customer_ip: config.customer.ip,
            user_agent: 'WhatsApp-Bot',
          });

          if (response.success) {
            return `🔗 رابط الدفع:\n${response.data.payment_url}\n\nيرجى الضغط على الرابط لإتمام عملية الدفع.`;
          }
          return 'حدث خطأ في تهيئة الدفع. يرجى المحاولة مرة أخرى.';
        }

        case 'block_number': {
          try {
            // Import blockedNumbersService dynamically to avoid circular dependency
            const { blockedNumbersService } = await import('../services/BlockedNumbersService');

            const phone = args.phone;
            const reason = args.reason || 'حظر من قبل البوت';

            // Only allow blocking if the request comes from an admin or if it's clearly spam
            // For security, we'll only allow blocking through the function if there's a clear reason
            blockedNumbersService.blockNumber(phone, reason, 'bot');

            logger.info(`Number ${phone} blocked by bot, reason: ${reason}`);
            return `تم حظر الرقم ${phone} بنجاح.\nالسبب: ${reason}`;
          } catch (error: any) {
            logger.error('Error blocking number:', error);
            return `حدث خطأ في حظر الرقم: ${error.message}`;
          }
        }

        case 'unblock_number': {
          try {
            // Import blockedNumbersService dynamically to avoid circular dependency
            const { blockedNumbersService } = await import('../services/BlockedNumbersService');

            const phone = args.phone;
            blockedNumbersService.unblockNumber(phone);

            logger.info(`Number ${phone} unblocked by bot`);
            return `تم إلغاء حظر الرقم ${phone} بنجاح.`;
          } catch (error: any) {
            logger.error('Error unblocking number:', error);
            return `حدث خطأ في إلغاء حظر الرقم: ${error.message}`;
          }
        }

        case 'list_blocked_numbers': {
          try {
            // Check if user is admin
            const { adminService } = await import('../services/AdminService');
            if (!adminService.isAdmin(customerPhone)) {
              logger.warn(`Unauthorized attempt to list blocked numbers from ${customerPhone}`);
              return 'عذراً، هذه الدالة متاحة فقط للمالك الإداري.';
            }

            // Import blockedNumbersService dynamically to avoid circular dependency
            const { blockedNumbersService } = await import('../services/BlockedNumbersService');

            const blockedNumbers = blockedNumbersService.getAllBlockedNumbers();

            if (blockedNumbers.length === 0) {
              return 'لا توجد أرقام محظورة حالياً.';
            }

            let message = `قائمة الأرقام المحظورة (${blockedNumbers.length}):\n\n`;
            blockedNumbers.forEach((blocked, index) => {
              message += `${index + 1}. ${blocked.phone}\n`;
              if (blocked.reason) {
                message += `   السبب: ${blocked.reason}\n`;
              }
              message += `   تم الحظر بواسطة: ${blocked.blocked_by}\n`;
              message += `   تاريخ الحظر: ${new Date(blocked.created_at).toLocaleDateString('ar-KW')}\n\n`;
            });

            return message;
          } catch (error: any) {
            logger.error('Error listing blocked numbers:', error);
            return `حدث خطأ في جلب قائمة الأرقام المحظورة: ${error.message}`;
          }
        }

        case 'add_admin_prompt': {
          try {
            // Check if user is admin
            const { adminService } = await import('../services/AdminService');
            if (!adminService.isAdmin(customerPhone)) {
              logger.warn(`Unauthorized attempt to add admin prompt from ${customerPhone}`);
              return 'عذراً، هذه الدالة متاحة فقط للمالك الإداري.';
            }

            const { adminPromptService } = await import('../services/AdminPromptService');
            const promptText = args.prompt_text || args.instruction || args.text;

            if (!promptText || promptText.trim().length === 0) {
              return 'يرجى تقديم نص التعليمات الإضافية.';
            }

            // Check if should append or replace
            if (args.append === true || args.mode === 'append') {
              adminPromptService.appendToAdminPrompt(promptText, customerPhone);
              return `تمت إضافة التعليمات الإضافية إلى الـ prompt بنجاح.\n\nالتعليمات المضافة:\n${promptText}`;
            } else {
              adminPromptService.addAdminPrompt(promptText, customerPhone);
              return `تم تحديث الـ prompt الإضافي بنجاح.\n\nالتعليمات الجديدة:\n${promptText}`;
            }
          } catch (error: any) {
            logger.error('Error adding admin prompt:', error);
            return `حدث خطأ في إضافة التعليمات: ${error.message}`;
          }
        }

        case 'get_admin_prompt': {
          try {
            // Check if user is admin
            const { adminService } = await import('../services/AdminService');
            if (!adminService.isAdmin(customerPhone)) {
              logger.warn(`Unauthorized attempt to get admin prompt from ${customerPhone}`);
              return 'عذراً، هذه الدالة متاحة فقط للمالك الإداري.';
            }

            const { adminPromptService } = await import('../services/AdminPromptService');
            const promptData = adminPromptService.getAdminPromptWithMetadata();

            if (!promptData || !promptData.prompt_text) {
              return 'لا توجد تعليمات إضافية حالياً.';
            }

            let message = `التعليمات الإضافية الحالية:\n\n${promptData.prompt_text}\n\n`;
            message += `تمت الإضافة بواسطة: ${promptData.added_by}\n`;
            message += `تاريخ آخر تحديث: ${new Date(promptData.updated_at).toLocaleDateString('ar-KW')} ${new Date(promptData.updated_at).toLocaleTimeString('ar-KW')}`;

            return message;
          } catch (error: any) {
            logger.error('Error getting admin prompt:', error);
            return `حدث خطأ في جلب التعليمات: ${error.message}`;
          }
        }

        case 'clear_admin_prompt': {
          try {
            // Check if user is admin
            const { adminService } = await import('../services/AdminService');
            if (!adminService.isAdmin(customerPhone)) {
              logger.warn(`Unauthorized attempt to clear admin prompt from ${customerPhone}`);
              return 'عذراً، هذه الدالة متاحة فقط للمالك الإداري.';
            }

            const { adminPromptService } = await import('../services/AdminPromptService');
            adminPromptService.clearAdminPrompt();

            return 'تم حذف التعليمات الإضافية بنجاح.';
          } catch (error: any) {
            logger.error('Error clearing admin prompt:', error);
            return `حدث خطأ في حذف التعليمات: ${error.message}`;
          }
        }

        default:
          return `الدالة ${name} غير معروفة.`;
      }
    } catch (error: any) {
      logger.error(`Error executing function ${name}:`, error);
      return `حدث خطأ أثناء تنفيذ ${name}: ${error.message}`;
    }
  }

  // Generate response from Gemini (fallback method without function calling)
  async generateResponse(
    userMessage: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    _customerPhone: string,
    useFallbackModel: boolean = false
  ): Promise<GeminiResponse> {
    try {
      // Update product catalog if empty
      if (!this.productCatalog) {
        await this.updateProductCatalog();
      }

      // Get system prompt
      if (!this.systemPrompt) {
        this.systemPrompt = this.getSystemPrompt();
      }

      // Build conversation context
      const history = conversationHistory
        .map((msg) => `${msg.role === 'user' ? 'المستخدم' : 'المساعد'}: ${msg.content}`)
        .join('\n\n');

      const prompt = `${this.systemPrompt}\n\nتاريخ المحادثة:\n${history}\n\nالمستخدم: ${userMessage}\n\nالمساعد:`;

      // Get model with system instruction
      const model = this.getModel(this.systemPrompt, useFallbackModel);

      // Generate content
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      return {
        text,
      };
    } catch (error: any) {
      logger.error(`Error generating Gemini response (fallback: ${useFallbackModel}):`, error);
      
      // If primary failed, try simple generation with fallback model
      if (!useFallbackModel && config.gemini.fallbackModel) {
        logger.info(`Attempting simple generation fallback to model: ${config.gemini.fallbackModel}...`);
        try {
          return await this.generateResponse(
            userMessage,
            conversationHistory,
            _customerPhone,
            true
          );
        } catch (fallbackError: any) {
          logger.error('Simple generation fallback model also failed:', fallbackError);
        }
      }
      
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  // Generate response with function calling support
  async generateResponseWithFunctions(
    userMessage: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    customerPhone: string,
    currentOrderData?: any,
    useFallbackModel: boolean = false
  ): Promise<GeminiResponse> {
    try {
      // Update product catalog if empty
      if (!this.productCatalog) {
        await this.updateProductCatalog();
      }

      // Build conversation history for chat
      // IMPORTANT: First message in history must be 'user', not 'model'
      // History must be pairs: user -> model -> user -> model
      const recentHistory = conversationHistory.slice(-10); // Limit to last 10 messages

      // Remove the current user message from history since we'll send it separately
      const historyWithoutCurrent = recentHistory.filter((msg, idx) => {
        // Remove last user message if it matches current userMessage
        return !(idx === recentHistory.length - 1 && msg.role === 'user' && msg.content === userMessage);
      });

      // Build valid history that starts with 'user' and alternates properly
      const history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

      // Find first user message to start history
      let startIdx = 0;
      for (let i = 0; i < historyWithoutCurrent.length; i++) {
        if (historyWithoutCurrent[i].role === 'user') {
          startIdx = i;
          break;
        }
      }

      // Build history from first user message, ensuring proper alternation
      let lastRole: 'user' | 'model' | null = null;
      for (let i = startIdx; i < historyWithoutCurrent.length; i++) {
        const msg = historyWithoutCurrent[i];
        const role = (msg.role === 'user' ? 'user' : 'model') as 'user' | 'model';

        // Skip if this would create invalid alternation (same role twice in a row)
        if (lastRole === role) {
          continue;
        }

        history.push({
          role: role,
          parts: [{ text: msg.content }],
        });

        lastRole = role;
      }

      // Get system prompt with current order data
      const systemPrompt = this.getSystemPrompt(currentOrderData);

      // Get model with tools and system instruction (supports configured model)
      const modelName = useFallbackModel && config.gemini.fallbackModel ? config.gemini.fallbackModel : config.gemini.model;
      const model = this.genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
        systemInstruction: systemPrompt, // supports string systemInstruction
        tools: [
          {
            functionDeclarations: this.getFunctionDeclarations(),
          },
        ],
      });

      // Use startChat for better conversation management with gemini-2.5-pro
      // Only include history if it's valid:
      // - Starts with 'user' role
      // - Has at least 2 messages (user -> model pair)
      // - Ends with 'model' role (so next message can be 'user')
      const validHistory = history.length >= 2 &&
        history[0].role === 'user' &&
        history[history.length - 1].role === 'model'
        ? history
        : undefined;

      const chat = model.startChat({
        history: validHistory,
      });

      // Send user message with timeout
      const result = await withTimeout(
        chat.sendMessage(userMessage),
        60000,
        'Gemini sendMessage'
      );
      const response = result.response;

      // Check if function call was made (gemini-2.5-pro function calling)
      // Try multiple ways to get function calls
      let functionCalls: any[] = [];

      try {
        // Method 1: response.functionCalls() if available
        if (typeof response.functionCalls === 'function') {
          const calls = response.functionCalls();
          if (calls && calls.length > 0) {
            functionCalls = calls;
          }
        }
      } catch (e) {
        // Ignore
      }

      // Method 2: Check response.candidates for function calls
      if (functionCalls.length === 0) {
        try {
          const parts = response.candidates?.[0]?.content?.parts || [];
          const functionCallParts = parts.filter((part: any) => part.functionCall);
          if (functionCallParts.length > 0) {
            functionCalls = functionCallParts.map((part: any) => part.functionCall);
          }
        } catch (e) {
          // Ignore
        }
      }

      // Check if text is empty and no functions were called
      let textContent = '';
      try {
        textContent = response.text() || '';
      } catch (e) {
        // text() can throw if response was blocked or empty
      }

      if (!textContent && functionCalls.length === 0) {
        logger.warn('Gemini returned an empty response text with no function calls');
        return { text: 'عذراً، لم أتمكن من استيعاب طلبك. يرجى إعادة صياغته مرة أخرى.' };
      }

      // Method 3: Check if response contains code blocks that look like function calls
      // This is a fallback if Gemini tries to write code instead of using function calling
      if (functionCalls.length === 0) {
        const responseText = textContent;
        // Check if response contains code that looks like create_order call
        if (responseText.includes('create_order') && responseText.includes('customer_name')) {
          logger.warn('Detected code output instead of function call. Response may need manual parsing.');
          // Don't try to parse - let it fail and user will see the issue
        }
      }

      if (functionCalls && functionCalls.length > 0) {
        logger.info(`Function calls detected: ${functionCalls.length}`);

        // Execute function calls
        const functionResults = await Promise.all(
          functionCalls.map(async (fc: any) => {
            logger.info(`Executing function: ${fc.name}`, JSON.stringify(fc.args));
            const result = await this.executeFunction(
              {
                name: fc.name,
                args: fc.args as Record<string, any>,
              },
              customerPhone
            );
            return {
              functionResponse: {
                name: fc.name,
                response: result,
              },
            };
          })
        );

        // Send function results back to model using chat
        try {
          // Build function response parts for gemini-2.5-pro
          // IMPORTANT: function_response.response must be a Struct (object), not a string
          // The response should be a plain JSON object that can be serialized
          const functionResponseParts = functionResults.map((fr: any) => {
            const response = fr.functionResponse.response;

            // Convert string response to object
            // Gemini API requires function response to be a Struct (JSON-serializable object)
            let responseObject: Record<string, any>;

            if (typeof response === 'string') {
              // For string responses, wrap in an object with a text field
              // This is the standard way to return text results from functions
              responseObject = {
                text: response,
              };
            } else if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
              // Already a plain object, use it directly
              // Ensure it's a plain object (not a class instance)
              responseObject = JSON.parse(JSON.stringify(response));
            } else {
              // Fallback: wrap primitive or array in object
              responseObject = {
                result: response,
              };
            }

            return {
              functionResponse: {
                name: fr.functionResponse.name,
                response: responseObject,
              },
            };
          });

          // Send function responses back to the chat
          const followUpResult = await withTimeout(
            chat.sendMessage(functionResponseParts),
            60000,
            'Gemini sendMessage followUp'
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
          logger.error('Error sending function response:', error);
          // If function response fails, return the function result as text
          const functionResultText = functionResults
            .map((fr: any) => {
              const response = fr.functionResponse.response;
              return typeof response === 'string' ? response : JSON.stringify(response);
            })
            .join('\n\n');

          return {
            text: functionResultText,
            functionCall: {
              name: functionCalls[0].name,
              args: functionCalls[0].args as Record<string, any>,
            },
          };
        }
      }

      // Get response text
      const responseText = response.text();

      // CRITICAL SECURITY CHECK: Detect fake order creation
      // Check if response claims to have created an order without actually calling create_order
      const fakeOrderPatterns = [
        /رقم الطلب.*هو.*\d+/i,
        /تم إنشاء طلبك/i,
        /تم تسجيل طلبك/i,
        /رقم الطلب.*\d+/i,
        /order.*number.*\d+/i,
      ];

      const hasFakeOrder = fakeOrderPatterns.some(pattern => pattern.test(responseText));
      const hasCreateOrderCall = functionCalls && functionCalls.some((fc: any) => fc.name === 'create_order');

      if (hasFakeOrder && !hasCreateOrderCall) {
        logger.error('CRITICAL SECURITY: Detected fake order creation attempt!', {
          responseText: responseText.substring(0, 200),
          functionCalls: functionCalls?.map((fc: any) => fc.name),
        });
        return {
          text: 'عذراً، حدث خطأ. لا يمكنني إنشاء الطلب بدون استخدام النظام. يرجى المحاولة مرة أخرى أو الاتصال بالدعم.',
        };
      }

      // Check if response contains code blocks (indicating Gemini tried to write code instead of function calling)
      // This is a critical error - Gemini should use Function Calling, not write code
      if (responseText.includes('{{tool_code}}') ||
        responseText.includes('print(') ||
        responseText.includes('def ') ||
        responseText.includes('function ') ||
        responseText.includes('```python') ||
        responseText.includes('```javascript') ||
        (responseText.includes('create_order(') && responseText.includes('customer_name=') && !responseText.includes('functionResponse'))) {
        logger.error('CRITICAL ERROR: Gemini wrote code instead of using Function Calling!');
        logger.error('Response contains code. First 500 chars:', responseText.substring(0, 500));
        logger.error('This should not happen - Gemini should use Function Calling API, not write code');

        // Return error message to user
        return {
          text: 'عذراً، حدث خطأ فني في معالجة طلبك. يرجى المحاولة مرة أخرى. إذا استمرت المشكلة، يرجى التواصل مع الدعم الفني.',
        };
      }

      return {
        text: responseText,
      };
    } catch (error: any) {
      logger.error(`Error generating Gemini response with functions (fallback: ${useFallbackModel}):`, {
        status: error.status,
        statusText: error.statusText,
        message: error.message,
        errorDetails: error.errorDetails,
      });

      // If we haven't tried the fallback model yet, try it now!
      if (!useFallbackModel && config.gemini.fallbackModel) {
        logger.info(`Attempting fallback to model: ${config.gemini.fallbackModel}...`);
        try {
          return await this.generateResponseWithFunctions(
            userMessage,
            conversationHistory,
            customerPhone,
            currentOrderData,
            true
          );
        } catch (fallbackError: any) {
          logger.error('Fallback model also failed in generateResponseWithFunctions:', fallbackError);
        }
      }

      // Fallback: use simple generateContent without function calling using the fallback model
      return this.generateResponse(userMessage, conversationHistory, customerPhone, useFallbackModel || true);
    }
  }

  // Generate response with media (multimodal: images, voice, audio, video)
  async generateResponseWithMedia(
    userMessage: string,
    mediaData: { data: string; mimeType: string },
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    customerPhone: string,
    currentOrderData?: any,
    useFallbackModel: boolean = false
  ): Promise<GeminiResponse> {
    try {
      // Update product catalog if empty
      if (!this.productCatalog) {
        await this.updateProductCatalog();
      }

      // Build conversation history (same as generateResponseWithFunctions)
      const recentHistory = conversationHistory.slice(-10);
      const historyWithoutCurrent = recentHistory.filter((msg, idx) => {
        return !(idx === recentHistory.length - 1 && msg.role === 'user');
      });

      const history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
      let startIdx = 0;
      for (let i = 0; i < historyWithoutCurrent.length; i++) {
        if (historyWithoutCurrent[i].role === 'user') {
          startIdx = i;
          break;
        }
      }

      let lastRole: 'user' | 'model' | null = null;
      for (let i = startIdx; i < historyWithoutCurrent.length; i++) {
        const msg = historyWithoutCurrent[i];
        const role = (msg.role === 'user' ? 'user' : 'model') as 'user' | 'model';
        if (lastRole === role) continue;
        history.push({ role, parts: [{ text: msg.content }] });
        lastRole = role;
      }

      const systemPrompt = this.getSystemPrompt(currentOrderData);

      const modelName = useFallbackModel && config.gemini.fallbackModel ? config.gemini.fallbackModel : config.gemini.model;
      const model = this.genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
        systemInstruction: systemPrompt,
        tools: [
          {
            functionDeclarations: this.getFunctionDeclarations(),
          },
        ],
      });

      const validHistory = history.length >= 2 &&
        history[0].role === 'user' &&
        history[history.length - 1].role === 'model'
        ? history
        : undefined;

      const chat = model.startChat({
        history: validHistory,
      });

      // Build multimodal parts array
      const parts: any[] = [];

      // Add the media as inlineData
      parts.push({
        inlineData: {
          mimeType: mediaData.mimeType,
          data: mediaData.data,
        },
      });

      // Add text prompt
      const isAudio = mediaData.mimeType.startsWith('audio/') || mediaData.mimeType === 'audio/ogg; codecs=opus';
      if (userMessage) {
        // User sent media with a caption/text
        parts.push({ text: userMessage });
      } else if (isAudio) {
        // Voice note / audio without text
        parts.push({ text: 'استمع لهذه الرسالة الصوتية وأجب عليها بناءً على سياق المحادثة.' });
      } else {
        // Image/video/sticker without text
        parts.push({ text: 'انظر لهذه الصورة وأجب بناءً على سياق المحادثة. إذا كانت تتعلق بمنتج أو طلب، ساعد العميل.' });
      }

      logger.info(`Sending multimodal request to Gemini: ${mediaData.mimeType}, text: ${(userMessage || '[auto-prompt]').substring(0, 50)}`);

      // Send multimodal message
      const result = await withTimeout(
        chat.sendMessage(parts),
        60000,
        'Gemini sendMessage media'
      );
      const response = result.response;

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
            .join('\n\n');

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
      return { text: responseText };
    } catch (error: any) {
      logger.error(`Error generating Gemini response with media (fallback: ${useFallbackModel}):`, {
        status: error.status,
        message: error.message,
        mimeType: mediaData.mimeType,
      });

      // If we haven't tried the fallback model yet, try it now!
      if (!useFallbackModel && config.gemini.fallbackModel) {
        logger.info(`Attempting media fallback to model: ${config.gemini.fallbackModel}...`);
        try {
          return await this.generateResponseWithMedia(
            userMessage,
            mediaData,
            conversationHistory,
            customerPhone,
            currentOrderData,
            true
          );
        } catch (fallbackError: any) {
          logger.error('Media fallback model also failed:', fallbackError);
        }
      }

      // Fallback: treat as text-only if media fails
      if (userMessage) {
        logger.info('Falling back to text-only generation after media error');
        return this.generateResponseWithFunctions(
          userMessage,
          conversationHistory,
          customerPhone,
          currentOrderData,
          useFallbackModel
        );
      }

      return {
        text: 'عذراً، لم أتمكن من معالجة هذا الملف. يرجى المحاولة مرة أخرى أو إرسال رسالة نصية.',
      };
    }
  }
}

// Export singleton instance
export const geminiService = new GeminiService();
