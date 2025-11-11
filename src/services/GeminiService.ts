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
- اسم العميل
- رقم الهاتف (سيتم الحصول عليه تلقائياً من رقم WhatsApp)
- البريد الإلكتروني
- العنوان: الشارع، المدينة، المحافظة، الرمز البريدي
- المنتجات والكميات

تعليمات مهمة جداً:
1. أنت تستخدم Function Calling - استدعي الدوال مباشرة، لا تكتب أي كود
2. عندما تجمع جميع معلومات الطلب، استخدم دالة create_order مباشرة
3. ممنوع كتابة أي كود Python أو JavaScript أو أي لغة برمجة
4. ممنوع استخدام علامات خاصة أو رموز برمجية
5. فقط استدعي الدالة create_order عندما تكون جميع المعلومات جاهزة
6. بعد استدعاء create_order، ستحصل على رابط الدفع ورقم الطلب تلقائياً

تنسيق الرسائل:
- لا تستخدم Markdown مثل ** أو ## أو []()
- لا تستخدم تنسيق نصي معقد
- استخدم نص عادي فقط مع رموز تعبيرية بسيطة
- الروابط ترسل كنص عادي، لا تستخدم []()
- استخدم * للتركيز فقط (لا تستخدم **)

كن ودوداً ومهنياً ومفيداً دائماً.
أجب بالعربية فقط ولا تستخدم أي لغة أخرى.
لا تكتب أي كود. فقط استخدم Function Calling للدوال المتاحة.`;
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
          },
          required: ['items', 'shipping_amount'],
        },
      },
      {
        name: 'create_order',
        description: 'استخدم هذه الدالة لإنشاء طلب جديد عندما تجمع جميع المعلومات المطلوبة من العميل. لا تكتب أي كود Python أو JavaScript. فقط استدعي هذه الدالة مباشرة من خلال Function Calling. رقم الهاتف سيتم إضافته تلقائياً من رقم WhatsApp للعميل.',
        parameters: {
          type: 'object',
          properties: {
            customer_name: { 
              type: 'string',
              description: 'اسم العميل الكامل'
            },
            customer_email: { 
              type: 'string',
              description: 'البريد الإلكتروني للعميل'
            },
            shipping_address: {
              type: 'object',
              description: 'عنوان الشحن الكامل',
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
                  description: 'الرمز البريدي'
                },
              },
              required: ['street', 'city', 'governorate', 'postal_code'],
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
          },
          required: [
            'customer_name',
            'customer_email',
            'shipping_address',
            'items',
          ],
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
    ];
  }

  // Clean markdown formatting from text (WhatsApp doesn't support it well)
  private cleanMarkdown(text: string): string {
    if (!text) return text;
    
    return text
      .replace(/\*\*(.*?)\*\*/g, '*$1*') // Replace **text** with *text* (single asterisk works in WhatsApp)
      .replace(/##+\s*/g, '') // Remove ## headers
      .replace(/###+\s*/g, '') // Remove ### headers
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Remove markdown links [text](url) -> text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Remove inline code `code` -> code
      .replace(/\*\s+/g, '- ') // Replace * with - for lists (WhatsApp supports -)
      .replace(/^\s*[-*]\s+/gm, '- ') // Normalize list items
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .trim();
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

        case 'calculate_order_total': {
          const shippingResponse = await apiService.getShippingCost();
          const shippingAmount = parseFloat(shippingResponse.data.shipping_cost);
          
          const totalResponse = await apiService.calculateTotal({
            items: args.items,
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

          const orderResponse = await apiService.createOrder({
            customer_name: args.customer_name,
            customer_phone: customerPhone, // Use WhatsApp phone number
            customer_email: args.customer_email,
            shipping_address: args.shipping_address,
            items: args.items,
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

                  // Format order items
                  let itemsText = '';
                  if (order.order_items && order.order_items.length > 0) {
                    itemsText = '\n\nالمنتجات:\n';
                    order.order_items.forEach((item: any, index: number) => {
                      const productTitle = item.product?.title || item.product_snapshot?.title || `منتج ${item.product_id}`;
                      const quantity = item.quantity;
                      const price = item.product_price || item.product?.price || '0';
                      itemsText += `${index + 1}. ${productTitle} - الكمية: ${quantity} - السعر: ${price} ${currency}\n`;
                    });
                  }

                  // Build message without Markdown - plain text for WhatsApp
                  let message = `تم إنشاء طلبك بنجاح!\n\n`;
                  message += `رقم الطلب: ${orderNumber}\n`;
                  message += `رقم التتبع: ${trackingNumber || orderNumber}\n\n`;
                  message += `تفاصيل الطلب:\n`;
                  message += `المجموع الفرعي: ${subtotal} ${currency}\n`;
                  if (discount > 0) {
                    message += `الخصم: ${discount} ${currency}\n`;
                  }
                  message += `تكلفة الشحن: ${shipping} ${currency}\n`;
                  message += `المبلغ الإجمالي: ${totalAmount} ${currency}\n`;
                  message += itemsText;
                  message += `\nرابط الدفع:\n${paymentUrl}\n\n`;
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
          let finalText = followUpResult.response.text();
          
          // Clean markdown from response
          finalText = this.cleanMarkdown(finalText);

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
          let functionResultText = functionResults
            .map((fr: any) => {
              const response = fr.functionResponse.response;
              return typeof response === 'string' ? response : JSON.stringify(response);
            })
            .join('\n\n');
          
          // Clean markdown from function result text
          functionResultText = this.cleanMarkdown(functionResultText);
          
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
        logger.error('❌ CRITICAL ERROR: Gemini wrote code instead of using Function Calling!');
        logger.error('Response contains code. First 500 chars:', responseText.substring(0, 500));
        logger.error('This should not happen - Gemini should use Function Calling API, not write code');
        
        // Return error message to user
        return {
          text: 'عذراً، حدث خطأ فني في معالجة طلبك. يرجى المحاولة مرة أخرى. إذا استمرت المشكلة، يرجى التواصل مع الدعم الفني.',
        };
      }
      
      // Clean markdown from response (WhatsApp doesn't support markdown well)
      responseText = this.cleanMarkdown(responseText);
      
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

