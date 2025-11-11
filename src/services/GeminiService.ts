import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { productService } from './ProductService';
import { apiService } from './ApiService';
import { conversationRepository } from '../database/ConversationRepository';

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

  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }

  private getModel(systemInstruction?: string): any {
    // Using gemini-2.5-pro (latest model as of November 2025)
    const modelConfig: any = {
      model: 'gemini-2.5-pro',
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    };

    // Add system instruction if provided (gemini-2.5-pro supports systemInstruction as string)
    if (systemInstruction) {
      modelConfig.systemInstruction = systemInstruction;
    }

    return this.genAI.getGenerativeModel(modelConfig);
  }

  // Update product catalog for system prompt
  async updateProductCatalog(): Promise<void> {
    try {
      const products = await productService.getAllProducts();
      if (products.length > 0) {
        const catalogText = products
          .map((p) => {
            const name = p.title || p.name_ar || p.name_en || p.name || `منتج ${p.id}`;
            let price: number | string = 0;
            if (typeof p.price === 'string') {
              price = parseFloat(p.price) || 0;
            } else if (typeof p.price === 'number') {
              price = p.price;
            } else {
              price = p.sale_price || p.discounted_price || 0;
            }
            const currency = p.currency || 'د.ك';
            return `${name} (رقم المنتج: ${p.id}) - السعر: ${price} ${currency}`;
          })
          .join('\n');

        this.productCatalog = catalogText;
        // Update system prompt with new catalog
        this.systemPrompt = this.getSystemPrompt();
        logger.info(`Product catalog updated for Gemini with ${products.length} products`);
      } else {
        this.productCatalog = 'لا توجد منتجات متاحة حالياً. يرجى المحاولة لاحقاً.';
        this.systemPrompt = this.getSystemPrompt();
        logger.warn('Product catalog is empty. Bot will continue but product features may be limited.');
      }
    } catch (error: any) {
      logger.error('Error updating product catalog:', error.message || error);
      this.productCatalog = 'لا توجد منتجات متاحة حالياً. يرجى المحاولة لاحقاً.';
      this.systemPrompt = this.getSystemPrompt();
    }
  }

  // Get system prompt
  private getSystemPrompt(): string {
    return `أنت مساعد متجر إلكتروني متخصص في بيع منتجات الصابون والعناية الشخصية.

مهمتك:
1. الرد على استفسارات العملاء باللغة العربية فقط
2. مساعدة العملاء في البحث عن المنتجات
3. اقتراح منتجات مناسبة بناءً على احتياجات العميل
4. جمع معلومات الطلب عند رغبة العميل في الشراء
5. معالجة طلبات الشراء وإنشاء الطلبات

قائمة المنتجات المتاحة:
${this.productCatalog || 'جارٍ تحميل قائمة المنتجات...'}

المعلومات المطلوبة لإنشاء طلب:
- اسم العميل (إجباري)
- رقم الهاتف (سيتم الحصول عليه تلقائياً من رقم WhatsApp)
- البريد الإلكتروني (يجب أن تسأل عنه، لكنه اختياري - إذا لم يقدمه العميل أو رفض، يمكنك المتابعة)
- العنوان: الشارع، المحافظة، المدينة (لا حاجة للرمز البريدي)
- المنتجات والكميات (إجباري)
- كود الخصم (اختياري - إذا أراد العميل تطبيق كود خصم، اسأله عنه وطبق التحقق)

       الدوال المتاحة:
       - search_products: البحث عن المنتجات
       - get_product_details: الحصول على تفاصيل منتج
       - get_featured_products: الحصول على المنتجات المميزة
       - calculate_order_total: حساب إجمالي الطلب
       - get_shipping_cost: جلب رسوم التوصيل (استخدمها عندما يسأل العميل عن تكلفة الشحن أو رسوم التوصيل)
       - validate_discount_code: التحقق من صحة كود الخصم (استخدمها عندما يريد العميل تطبيق كود خصم)
       - create_order: إنشاء طلب جديد
       - track_order: متابعة حالة الطلب باستخدام رقم الطلب
       - get_payment_methods: جلب طرق الدفع المتاحة
       - initiate_payment: تهيئة الدفع
       - block_number: حظر رقم هاتف (دالة إدارية - استخدمها فقط عند اكتشاف spam أو إساءة استخدام واضحة)
       - unblock_number: إلغاء حظر رقم هاتف (دالة إدارية)
       - list_blocked_numbers: عرض قائمة الأرقام المحظورة (دالة إدارية)

تعليمات مهمة جداً:
1. أنت تستخدم Function Calling - استدعي الدوال مباشرة، لا تكتب أي كود
2. عندما تجمع جميع معلومات الطلب، استخدم دالة create_order مباشرة
3. عندما يطلب العميل متابعة طلبه أو معرفة حالة الطلب، استخدم دالة track_order مع رقم الطلب
4. ممنوع كتابة أي كود Python أو JavaScript أو أي لغة برمجة
5. ممنوع استخدام علامات خاصة أو رموز برمجية
6. فقط استدعي الدالة create_order عندما تكون جميع المعلومات جاهزة
7. بعد استدعاء create_order، ستحصل على رابط الدفع ورقم الطلب تلقائياً
8. احفظ رقم الطلب وأخبر العميل به حتى يمكنه متابعة طلبه لاحقاً

ملاحظات مهمة عن جمع معلومات الطلب:
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
        name: 'calculate_order_total',
        description: 'حساب إجمالي الطلب بناءً على المنتجات وكمياتها',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'number' },
                  quantity: { type: 'number' },
                },
                required: ['product_id', 'quantity'],
              },
            },
            shipping_amount: {
              type: 'number',
              description: 'تكلفة الشحن',
            },
            discount_code: {
              type: 'string',
              description: 'كود الخصم (اختياري - إذا كان متوفراً)',
            },
          },
          required: ['items', 'shipping_amount'],
        },
      },
      {
        name: 'create_order',
        description: 'استخدم هذه الدالة لإنشاء طلب جديد عندما تجمع جميع المعلومات المطلوبة من العميل. لا تكتب أي كود Python أو JavaScript. فقط استدعي هذه الدالة مباشرة من خلال Function Calling. رقم الهاتف سيتم إضافته تلقائياً من رقم WhatsApp للعميل. يجب أن تسأل عن البريد الإلكتروني ولكن وضح أنه اختياري - إذا لم يقدمه العميل أو رفض، لا تمرره في الدالة أو مرره كقيمة فارغة.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: { 
              type: 'string',
              description: 'اسم العميل الكامل (إجباري)'
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
          },
          required: [
            'customer_name',
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
        name: 'get_shipping_cost',
        description: 'جلب رسوم التوصيل. استخدم هذه الدالة عندما يسأل العميل عن تكلفة الشحن أو رسوم التوصيل أو مصاريف التوصيل.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
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
        description: 'حظر رقم هاتف. استخدم هذه الدالة عندما تريد حظر رقم هاتف (مثلاً عند اكتشاف spam أو إساءة استخدام). هذه دالة إدارية - استخدمها فقط عند الحاجة الماسة.',
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
        description: 'إلغاء حظر رقم هاتف. استخدم هذه الدالة لإلغاء حظر رقم هاتف محظور مسبقاً. هذه دالة إدارية.',
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
        description: 'عرض قائمة الأرقام المحظورة. استخدم هذه الدالة لعرض جميع الأرقام المحظورة. هذه دالة إدارية.',
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
            return productService.formatProductList(result.products);
          } catch (error: any) {
            logger.error('Error in search_products function:', error);
            return `حدث خطأ أثناء البحث عن المنتجات: ${error.message || 'خطأ غير معروف'}`;
          }
        }

        case 'get_product_details': {
          const product = await productService.getProductById(args.product_id);
          if (!product) {
            return 'لم أجد المنتج المطلوب.';
          }
          return productService.formatProduct(product);
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

            const validateResponse = await apiService.validateDiscountCode({
              discount_code: args.discount_code,
              items: args.items,
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

        case 'get_shipping_cost': {
          try {
            const shippingResponse = await apiService.getShippingCost();
            if (shippingResponse.success) {
              const shippingCost = shippingResponse.data.shipping_cost;
              return `رسوم التوصيل: ${shippingCost} د.ك\n\nهذه هي رسوم التوصيل القياسية لجميع الطلبات.`;
            }
            return 'حدث خطأ في جلب رسوم التوصيل. يرجى المحاولة مرة أخرى.';
          } catch (error: any) {
            logger.error('Error getting shipping cost:', error);
            return 'حدث خطأ في جلب رسوم التوصيل. يرجى المحاولة مرة أخرى.';
          }
        }

        case 'calculate_order_total': {
          const shippingResponse = await apiService.getShippingCost();
          const shippingAmount = parseFloat(shippingResponse.data.shipping_cost);
          
          const totalResponse = await apiService.calculateTotal({
            items: args.items,
            discount_code: args.discount_code, // Include discount code if provided
            shipping_amount: shippingAmount,
          });

          if (totalResponse.success) {
            const { subtotal, shipping_amount, total, currency, discount_amount } = totalResponse.data;
            let message = `إجمالي الطلب:\n\n`;
            message += `المجموع الفرعي: ${subtotal} ${currency}\n`;
            if (discount_amount && discount_amount > 0) {
              message += `الخصم: ${discount_amount} ${currency}\n`;
            }
            message += `تكلفة الشحن: ${shipping_amount} ${currency}\n`;
            message += `المبلغ الإجمالي: ${total} ${currency}`;
            return message;
          }
          return 'حدث خطأ في حساب الإجمالي. يرجى المحاولة مرة أخرى.';
        }

        case 'create_order': {
          // Get shipping cost first
          const shippingResponse = await apiService.getShippingCost();
          const shippingAmount = parseFloat(shippingResponse.data.shipping_cost);

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
              const validateResponse = await apiService.validateDiscountCode({
                discount_code: args.discount_code,
                items: args.items,
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

          const orderResponse = await apiService.createOrder({
            customer_name: args.customer_name,
            customer_phone: customerPhone, // Use WhatsApp phone number
            customer_email: customerEmail,
            shipping_address: shippingAddress,
            items: args.items,
            discount_code: discountCode, // Include discount code if validated
            shipping_amount: shippingAmount,
          });

          if (orderResponse.success) {
            const orderData = orderResponse.data;
            
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
                  // Save order to database
                  conversationRepository.saveOrder(
                    orderData.order.id,
                    customerPhone,
                    orderData,
                    paymentResponse.data.payment_url,
                    'payment_pending'
                  );

                  // Format order details based on actual API response
                  const order = orderData.order;
                  const orderNumber = order.order_number || orderData.tracking_number;
                  const totalAmount = orderData.total_amount || order.total_amount;
                  const currency = orderData.currency || order.currency || 'KWD';
                  const subtotal = orderData.subtotal_amount || order.subtotal_amount || 0;
                  const shipping = orderData.shipping_amount || order.shipping_amount || 0;
                  const discount = orderData.discount_amount || order.discount_amount || 0;
                  const trackingNumber = orderData.tracking_number || order.tracking_number;
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
                      const itemPrice = item.product_price || 
                                      item.product?.price || 
                                      item.product_snapshot?.price || 
                                      '0';
                      itemsText += `${index + 1}. ${productTitle}\n`;
                      itemsText += `   الكمية: ${quantity}\n`;
                      itemsText += `   السعر: ${itemPrice} ${currency}\n\n`;
                    });
                  }

                  // Build message in plain text format for WhatsApp (no markdown, no special formatting)
                  // WhatsApp doesn't support markdown well, so use plain text only
                  let message = `تم إنشاء طلبك بنجاح!\n\n`;
                  message += `رقم الطلب: ${orderNumber}\n`;
                  message += `رقم التتبع: ${trackingNumber || orderNumber}\n\n`;
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

            // Save order to database even if payment initiation fails
            conversationRepository.saveOrder(
              orderData.order.id,
              customerPhone,
              orderData,
              undefined,
              'pending'
            );

            // Format order details even if payment initiation fails
            const order = orderData.order;
            const orderNumber = order.order_number || orderData.tracking_number || 'غير متوفر';
            const trackingNumber = orderData.tracking_number || order.tracking_number || orderNumber;
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
                const itemPrice = item.product_price || 
                                item.product?.price || 
                                item.product_snapshot?.price || 
                                '0';
                itemsText += `${index + 1}. ${productTitle}\n`;
                itemsText += `   الكمية: ${quantity}\n`;
                itemsText += `   السعر: ${itemPrice} ${currency}\n\n`;
              });
            }

            let message = `تم إنشاء طلبك بنجاح!\n\n`;
            message += `رقم الطلب: ${orderNumber}\n`;
            message += `رقم التتبع: ${trackingNumber}\n\n`;
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
          const errorMsg = orderResponse.message || 'حدث خطأ في إنشاء الطلب';
          if (orderResponse.errors) {
            const errorDetails = Object.values(orderResponse.errors).flat().join(', ');
            return `حدث خطأ في إنشاء الطلب: ${errorMsg}\n${errorDetails}`;
          }
          return `حدث خطأ في إنشاء الطلب: ${errorMsg}`;
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
              message += `رقم التتبع: ${order.tracking_number}\n`;
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
                  const itemPrice = item.product_price || 
                                  item.product?.price || 
                                  item.product_snapshot?.price || 
                                  '0';
                  message += `${index + 1}. ${productTitle}\n`;
                  message += `   الكمية: ${quantity}\n`;
                  message += `   السعر: ${itemPrice} ${order.currency}\n\n`;
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
    _customerPhone: string
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
      const model = this.getModel(this.systemPrompt);

      // Generate content
      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();

      return {
        text,
      };
    } catch (error: any) {
      logger.error('Error generating Gemini response:', error);
      throw new Error(`Failed to generate response: ${error.message}`);
    }
  }

  // Generate response with function calling support
  async generateResponseWithFunctions(
    userMessage: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    customerPhone: string
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

      // Build conversation history for chat (gemini-2.5-pro supports chat history)
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

      // Get model with tools and system instruction (gemini-2.5-pro supports this)
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        systemInstruction: this.systemPrompt, // gemini-2.5-pro supports string systemInstruction
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

      // Send user message
      const result = await chat.sendMessage(userMessage);
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
      
      // Method 3: Check if response contains code blocks that look like function calls
      // This is a fallback if Gemini tries to write code instead of using function calling
      if (functionCalls.length === 0) {
        const responseText = response.text();
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
          const followUpResult = await chat.sendMessage(functionResponseParts);
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
      logger.error('Error generating Gemini response with functions:', {
        status: error.status,
        statusText: error.statusText,
        message: error.message,
        errorDetails: error.errorDetails,
      });
      
      // If it's a 404 error, the model might not be available or API key doesn't have access
      if (error.status === 404 || error.message?.includes('404') || error.statusText === 'Not Found') {
        logger.error('API endpoint returned 404. Possible reasons:');
        logger.error('1. Model gemini-2.5-pro is not available in your region/API key');
        logger.error('2. API key does not have access to gemini-2.5-pro');
        logger.error('3. API endpoint has changed');
        logger.error('Falling back to simple generation without function calling...');
        
        // Fallback: use simple generateContent without function calling
        return this.generateResponse(userMessage, conversationHistory, customerPhone);
      }
      
      // Fallback to simple generation
      return this.generateResponse(userMessage, conversationHistory, customerPhone);
    }
  }
}

// Export singleton instance
export const geminiService = new GeminiService();

