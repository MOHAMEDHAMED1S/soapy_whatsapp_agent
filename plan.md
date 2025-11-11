# WhatsApp Agent للمتجر الإلكتروني

## البنية العامة

### 1. هيكل المشروع

```
soapy_whatsapp_agent/
├── src/
│   ├── bot/
│   │   ├── WhatsAppBot.ts          # البوت الرئيسي
│   │   ├── MessageHandler.ts       # معالج الرسائل
│   │   └── ConversationManager.ts  # إدارة المحادثات
│   ├── services/
│   │   ├── ApiService.ts           # خدمة API للمتجر
│   │   ├── GeminiService.ts        # خدمة Gemini AI
│   │   └── ProductService.ts       # خدمة إدارة المنتجات
│   ├── database/
│   │   ├── Database.ts             # إعداد SQLite
│   │   ├── ConversationRepository.ts # حفظ المحادثات
│   │   └── models/
│   │       └── Conversation.ts     # نموذج المحادثة
│   ├── types/
│   │   ├── api.types.ts            # أنواع API
│   │   ├── product.types.ts        # أنواع المنتجات
│   │   ├── order.types.ts          # أنواع الطلبات
│   │   └── conversation.types.ts   # أنواع المحادثات
│   ├── utils/
│   │   ├── logger.ts               # التسجيل
│   │   └── validators.ts           # التحقق من البيانات
│   └── config/
│       └── config.ts               # الإعدادات
├── .env.example                    # مثال ملف البيئة
├── package.json
├── tsconfig.json
└── README.md
```

### 2. المكونات الرئيسية

#### 2.1 API Service (`src/services/ApiService.ts`)

- `getProducts()` - جلب جميع المنتجات
- `getProductById()` - جلب منتج بواسطة ID
- `getProductBySlug()` - جلب منتج بواسطة slug
- `getFeaturedProducts()` - جلب المنتجات المميزة
- `getShippingCost()` - جلب تكلفة الشحن
- `calculateTotal()` - حساب الإجمالي
- `createOrder()` - إنشاء طلب
- `getPaymentMethods()` - جلب طرق الدفع
- `initiatePayment()` - تهيئة الدفع
- `getPaymentStatus()` - جلب حالة الدفع

#### 2.2 Gemini Service (`src/services/GeminiService.ts`)

- تكامل مع Gemini 2.5 Pro API
- System prompt يحتوي على:
  - قائمة المنتجات والأسعار
  - Functions للبوت (product search, order creation, etc.)
  - تعليمات الرد بالعربية
- Function calling للتفاعل مع APIs

#### 2.3 Product Service (`src/services/ProductService.ts`)

- تحديث قائمة المنتجات من API
- تخزين مؤقت للمنتجات
- البحث في المنتجات

#### 2.4 Conversation Manager (`src/bot/ConversationManager.ts`)

- إدارة حالة المحادثة لكل مستخدم
- تتبع المعلومات المطلوبة للطلب (الاسم، العنوان، إلخ)
- حفظ السياق في SQLite

#### 2.5 Database (`src/database/`)

- SQLite لحفظ المحادثات
- جدول conversations: phone, messages (JSON), order_data (JSON), created_at, updated_at
- جدول orders: order_id, phone, order_data (JSON), payment_url, status, created_at

### 3. سير عمل إنشاء الطلب

1. المستخدم يطلب منتجًا أو يريد عمل طلب
2. البوت يجمع المعلومات المطلوبة:

   - الاسم (customer_name)
   - رقم الهاتف (customer_phone) - من رقم WhatsApp
   - البريد الإلكتروني (customer_email)
   - العنوان (shipping_address): street, city, governorate, postal_code
   - المنتجات والكميات (items)

3. البوت يحسب الإجمالي (calculateTotal)
4. البوت ينشئ الطلب (createOrder)
5. البوت يجلب طرق الدفع (getPaymentMethods)
6. البوت يختار أول طريقة دفع متاحة (أو يطلب من المستخدم)
7. البوت يهيئ الدفع (initiatePayment)
8. البوت يرسل رابط الدفع تلقائيًا

### 4. Functions للبوت (Gemini Function Calling)

```typescript
{
  name: "search_products",
  description: "البحث عن المنتجات",
  parameters: { query: string, category?: string }
}

{
  name: "get_product_details",
  description: "الحصول على تفاصيل منتج",
  parameters: { product_id: number }
}

{
  name: "calculate_order_total",
  description: "حساب إجمالي الطلب",
  parameters: { items: CartItem[], shipping_amount: number }
}

{
  name: "create_order",
  description: "إنشاء طلب جديد",
  parameters: { order_data: OrderData }
}

{
  name: "get_payment_methods",
  description: "جلب طرق الدفع المتاحة",
  parameters: {}
}

{
  name: "initiate_payment",
  description: "تهيئة الدفع وإرسال رابط الدفع",
  parameters: { order_id: number, payment_method: string }
}
```

### 5. System Prompt للبوت

البوت سيكون:

- مساعدًا ودودًا ومهنيًا
- يرد بالعربية
- يقترح منتجات بناءً على طلبات المستخدم
- يجمع معلومات الطلب بشكل منظم
- يرسل روابط الدفع تلقائيًا
- يتعامل مع الأخطاء بشكل مهني

### 6. الإعدادات المطلوبة (.env)

```
GEMINI_API_KEY=AIzaSyB6-rXI4gnzqfCWEOPLjw6yNoANDlSNChk
API_BASE_URL=https://api.soapy-bubbles.com/api/v1
DATABASE_PATH=./data/conversations.db
LOG_LEVEL=info
CUSTOMER_IP=0.0.0.0
```

**ملاحظات:**

- APIs عامة (لا تحتاج API key)
- customer_ip = 0.0.0.0 (كما طلبت)
- اللغة: العربية فقط

### 7. المهام التنفيذية

1. إعداد المشروع (TypeScript, dependencies)
2. إنشاء أنواع البيانات (Types)
3. إنشاء API Service
4. إنشاء Database Layer
5. إنشاء Gemini Service مع Function Calling
6. إنشاء Conversation Manager
7. إنشاء WhatsApp Bot
8. إنشاء Message Handler
9. إنشاء Product Service
10. إضافة System Prompt والـ Functions
11. اختبار التكامل
12. إضافة معالجة الأخطاء والتسجيل

### 8. ملاحظات مهمة

- لا دعم لأكواد الخصم في البوت (كما طلبت)
- customer_ip سيستخدم '0.0.0.0' كقيمة افتراضية
- البوت سيجمع معلومات الطلب تدريجيًا
- حفظ السياق في SQLite لكل محادثة
- تحديث قائمة المنتجات دوريًا أو عند الطلب