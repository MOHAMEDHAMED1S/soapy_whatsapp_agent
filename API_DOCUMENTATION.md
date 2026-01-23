# API Documentation - Shipping & Orders

## 📦 Calculate Shipping Cost

### Endpoint
```
POST /api/v1/shipping/calculate
```

### Description
يحسب تكلفة الشحن بناءً على المنتجات والكميات وكود الدولة

### Request Body

```json
{
  "product_ids": [1, 2, 3],
  "quantities": [2, 1, 3],
  "country_code": "KW"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `product_ids` | array | ✅ Yes | قائمة بـ IDs المنتجات |
| `quantities` | array | ✅ Yes | قائمة بالكميات (نفس ترتيب المنتجات) |
| `country_code` | string | ✅ Yes | كود الدولة (2 أحرف، مثل: KW, SA, AE) |

#### Supported Countries

| Code | Country | العربية |
|------|---------|---------|
| `KW` | Kuwait | الكويت |
| `SA` | Saudi Arabia | السعودية |
| `AE` | UAE | الإمارات |
| `BH` | Bahrain | البحرين |
| `OM` | Oman | عُمان |
| `QA` | Qatar | قطر |


### Response

#### Success Response (200)

```json
{
  "success": true,
  "data": {
    "total_weight_grams": 200,
    "total_weight_kg": 0.2,
    "shipping_cost": 4.048,
    "breakdown": {
      "matched_tier": {
        "max_weight_kg": 0.5,
        "base_price": 3.52,
        "additional_percentage": 0.15
      },
      "actual_weight_kg": 0.2,
      "rounded_to_tier_kg": 0.5,
      "base_price": 3.52,
      "additional_fee": 0.528,
      "final_price": 4.048
    },
    "country_code": "KW",
    "currency": "KWD"
  },
  "message": "Shipping cost calculated successfully"
}
```

#### Error Response (404)

```json
{
  "success": false,
  "message": "Shipping rate not found for this country",
  "country_code": "XX"
}
```

### Example Usage

#### JavaScript/Axios
```javascript
const response = await axios.post('/api/v1/shipping/calculate', {
  product_ids: [1, 2],
  quantities: [2, 1],
  country_code: 'KW'
});

const shippingCost = response.data.data.shipping_cost; // 4.048
```

#### cURL
```bash
curl -X POST http://127.0.0.1:8000/api/v1/shipping/calculate \
  -H "Content-Type: application/json" \
  -d '{
    "product_ids": [1, 2],
    "quantities": [2, 1],
    "country_code": "KW"
  }'
```

---

## 🛒 Create Order

### Endpoint
```
POST /api/v1/checkout/create-order
```

### Description
يقوم بإنشاء طلب جديد ويحسب تكلفة الشحن **تلقائياً** بناءً على كود الدولة والوزن الإجمالي

> ⚠️ **Important**: لا تحتاج لإرسال `shipping_amount` - سيتم حسابه تلقائياً!

### Request Body

```json
{
  "customer_name": "محمد أحمد",
  "customer_phone": "+96512345678",
  "customer_email": "mohamed@example.com",
  "country_code": "KW",
  "shipping_address": {
    "street": "شارع الخليج العربي، بنية 15",
    "city": "مدينة الكويت",
    "governorate": "العاصمة",
    "postal_code": "12345",
    "notes": "بجانب مسجد الفاطمية"
  },
  "items": [
    {
      "product_id": 1,
      "quantity": 2
    },
    {
      "product_id": 3,
      "quantity": 1
    }
  ],
  "discount_code": "SUMMER2024",
  "notes": "يرجى التسليم صباحاً"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer_name` | string | ✅ Yes | اسم العميل |
| `customer_phone` | string | ✅ Yes | رقم الهاتف (مع كود الدولة +965...) |
| `customer_email` | string | ❌ No | البريد الإلكتروني |
| `country_code` | string | ✅ Yes | كود الدولة (KW, SA, AE, ...) |
| `shipping_address` | object | ✅ Yes | عنوان التوصيل |
| `shipping_address.street` | string | ✅ Yes | اسم الشارع والبناية |
| `shipping_address.city` | string | ✅ Yes | المدينة |
| `shipping_address.governorate` | string | ✅ Yes | المحافظة/المنطقة |
| `shipping_address.postal_code` | string | ❌ No | الرمز البريدي |
| `shipping_address.notes` | string | ❌ No | ملاحظات العنوان |
| `items` | array | ✅ Yes | قائمة المنتجات (على الأقل منتج واحد) |
| `items[].product_id` | integer | ✅ Yes | ID المنتج |
| `items[].quantity` | integer | ✅ Yes | الكمية (على الأقل 1) |
| `discount_code` | string | ❌ No | كود الخصم |
| `notes` | string | ❌ No | ملاحظات الطلب |

### Response

#### Success Response (201)

```json
{
  "success": true,
  "data": {
    "order": {
      "id": 15,
      "order_number": "7654321",
      "customer_id": 5,
      "customer_name": "محمد أحمد",
      "customer_phone": "+96512345678",
      "customer_email": "mohamed@example.com",
      "country_code": "KW",
      "shipping_address": {
        "street": "شارع الخليج العربي، بنية 15",
        "city": "مدينة الكويت",
        "governorate": "العاصمة",
        "postal_code": "12345",
        "notes": "بجانب مسجد الفاطمية"
      },
      "total_amount": 24.548,
      "currency": "KWD",
      "status": "pending",
      "created_at": "2025-12-02T18:15:30.000000Z"
    },
    "subtotal_amount": 20.500,
    "discount_amount": 0,
    "shipping_amount": 4.048,
    "total_amount": 24.548,
    "currency": "KWD",
    "discount_code": null,
    "free_shipping": false,
    "tracking_number": "TRK-A3F5B2D1",
    "shipping_details": {
      "total_weight_grams": 200,
      "total_weight_kg": 0.2,
      "country_code": "KW",
      "shipping_cost": 4.048,
      "breakdown": {
        "matched_tier": {
          "max_weight_kg": 0.5,
          "base_price": 3.52,
          "additional_percentage": 0.15
        },
        "actual_weight_kg": 0.2,
        "base_price": 3.52,
        "additional_fee": 0.528,
        "final_price": 4.048
      }
    },
    "next_step": "payment_required"
  },
  "message": "Order created successfully. Proceed to payment."
}
```

#### Error Responses

**Validation Error (422)**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "country_code": ["The country code field is required."],
    "items": ["The items field must have at least 1 items."]
  }
}
```

**Product Not Available (400)**
```json
{
  "success": false,
  "message": "Product ID 5 is not available"
}
```

**Shipping Not Available (400)**
```json
{
  "success": false,
  "message": "Shipping not available for country: XX",
  "error_code": "SHIPPING_NOT_AVAILABLE"
}
```

**Discount Code Error (400)**
```json
{
  "success": false,
  "message": "كود الخصم غير صالح أو منتهي الصلاحية",
  "error_code": "DISCOUNT_ERROR"
}
```

### Example Usage

#### JavaScript/Axios
```javascript
const orderData = {
  customer_name: 'محمد أحمد',
  customer_phone: '+96512345678',
  customer_email: 'mohamed@example.com',
  country_code: 'KW',
  shipping_address: {
    street: 'شارع الخليج العربي، بنية 15',
    city: 'مدينة الكويت',
    governorate: 'العاصمة'
  },
  items: [
    { product_id: 1, quantity: 2 },
    { product_id: 3, quantity: 1 }
  ],
  discount_code: 'SUMMER2024'
};

try {
  const response = await axios.post('/api/v1/checkout/create-order', orderData);
  
  console.log('Order created:', response.data.data.order.order_number);
  console.log('Total amount:', response.data.data.total_amount, 'KWD');
  console.log('Shipping cost:', response.data.data.shipping_amount, 'KWD');
  
  // Navigate to payment page
  window.location.href = `/payment?order=${response.data.data.order.order_number}`;
  
} catch (error) {
  if (error.response?.data?.errors) {
    console.error('Validation errors:', error.response.data.errors);
  } else {
    console.error('Error:', error.response?.data?.message);
  }
}
```

#### cURL
```bash
curl -X POST http://127.0.0.1:8000/api/v1/checkout/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name": "محمد أحمد",
    "customer_phone": "+96512345678",
    "customer_email": "mohamed@example.com",
    "country_code": "KW",
    "shipping_address": {
      "street": "شارع الخليج العربي، بنية 15",
      "city": "مدينة الكويت",
      "governorate": "العاصمة"
    },
    "items": [
      { "product_id": 1, "quantity": 2 },
      { "product_id": 3, "quantity": 1 }
    ]
  }'
```

---

## 🔍 Important Notes

### Shipping Calculation
- ✅ يتم حساب الشحن **تلقائياً** بناءً على:
  - الوزن الإجمالي للمنتجات
  - كود الدولة
  - نظام الشرائح (tiers) المحدد في admin panel

- ⚠️ إذا لم يكن للمنتج وزن محدد، يتم استخدام **100 جرام** كقيمة افتراضية

- 🎁 إذا كان هناك كود خصم من نوع "free shipping"، تكون تكلفة الشحن = 0

### Country Codes
- يجب أن يكون `country_code` **2 أحرف** بالأحرف الكبيرة (uppercase)
- الدول المدعومة: KW, SA, AE, BH, OM, QA, EG

### Product Availability
- يتم التحقق من توفر جميع المنتجات قبل إنشاء الطلب
- إذا كان أي منتج غير متوفر، سيفشل الطلب

### Discount Codes
- يتم التحقق من صلاحية كود الخصم
- أنواع الخصم:
  - `percentage`: نسبة مئوية من الإجمالي
  - `fixed`: مبلغ ثابت
  - `free_shipping`: شحن مجاني

---

## 📊 Response Flow

```
Request
    ↓
Validate Request
    ↓
Calculate Total Weight
    ↓
Calculate Shipping (automatic)
    ↓
Apply Discount (if any)
    ↓
Create Order
    ↓
Return Response with shipping_details
```

---

## 🛠️ Testing

### Test Calculate Shipping
```bash
# Kuwait - 200g (0.2kg)
curl -X POST http://127.0.0.1:8000/api/v1/shipping/calculate \
  -H "Content-Type: application/json" \
  -d '{"product_ids":[1],"quantities":[2],"country_code":"KW"}'

# Expected: ~4.048 KWD (for 0.5kg tier)
```

### Test Create Order
```bash
curl -X POST http://127.0.0.1:8000/api/v1/checkout/create-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_name":"Test User",
    "customer_phone":"+96512345678",
    "country_code":"KW",
    "shipping_address":{
      "street":"Test St",
      "city":"Kuwait",
      "governorate":"Capital"
    },
    "items":[{"product_id":1,"quantity":1}]
  }'
```

---

## 💡 Tips

1. **Always send country_code**: الآن مطلوب لحساب الشحن
2. **Don't send shipping_amount**: سيتم حسابه تلقائياً
3. **Use shipping/calculate first**: لعرض التكلفة للمستخدم قبل إنشاء الطلب
4. **Handle errors properly**: تحقق من جميع حالات الخطأ المحتملة
5. **Save shipping_details**: مفيدة لعرض تفاصيل الحساب للمستخدم
