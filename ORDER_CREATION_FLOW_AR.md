# دليل إنشاء الطلب - Order Creation Flow

## نظرة عامة

هذا الدليل يشرح سير عمل إنشاء الطلب من البداية حتى إتمام الدفع.

---

## الخطوات الأساسية

### 1. جلب المنتجات

```typescript
import { getProducts, getProduct, getProductById } from '@/lib/api';

// جلب جميع المنتجات
const products = await getProducts({
  page: 1,
  per_page: 20,
  category: 'soap'
});

// جلب منتج واحد بالاسم
const product = await getProduct('lavender-soap');

// جلب منتج واحد بالرقم
const productById = await getProductById(123);
```

---

### 2. حساب الإجمالي

```typescript
import { calculateTotal, getShippingCost } from '@/lib/api';

// جلب تكلفة الشحن
const shipping = await getShippingCost();
const shippingAmount = parseFloat(shipping.data.shipping_cost);

// حساب الإجمالي
const total = await calculateTotal({
  items: [
    { product_id: 1, quantity: 2 },
    { product_id: 2, quantity: 1 }
  ],
  discount_code: 'WELCOME10',
  shipping_amount: shippingAmount
});

console.log(total.data);
// {
//   subtotal: 50.00,
//   shipping_amount: 2.5,
//   discount_amount: 5.00,
//   total: 47.50,
//   currency: 'KWD'
// }
```

---

### 3. التحقق من كود الخصم

```typescript
import { validateDiscountCode } from '@/lib/api';

const validation = await validateDiscountCode(
  'WELCOME10',
  [
    { product_id: 1, quantity: 2 },
    { product_id: 2, quantity: 1 }
  ],
  '96512345678',
  2.5
);

if (validation.success && validation.data?.valid) {
  console.log('كود الخصم صحيح:', validation.data.discount_amount);
} else {
  console.error('كود الخصم غير صحيح:', validation.message);
}
```

---

### 4. إنشاء الطلب

```typescript
import { createOrder } from '@/lib/api';

const orderData = {
  customer_name: 'أحمد علي',
  customer_phone: '96512345678',
  customer_email: 'ahmed@example.com',
  shipping_address: {
    street: 'شارع الرئيسي 123',
    city: 'الكويت',
    governorate: 'الكويت',
    postal_code: '12345'
  },
  items: [
    { product_id: 1, quantity: 2 },
    { product_id: 2, quantity: 1 }
  ],
  discount_code: 'WELCOME10',
  shipping_amount: 2.5
};

const order = await createOrder(orderData);

if (order.success) {
  console.log('تم إنشاء الطلب:', order.data.order_number);
  // رقم الطلب: order.data.order_number
  // معرف الطلب: order.data.order.id
}
```

---

### 5. جلب طرق الدفع

```typescript
import { getPaymentMethods } from '@/lib/api';

const paymentMethods = await getPaymentMethods();

if (paymentMethods.success) {
  const methods = paymentMethods.data;
  
  // عرض طرق الدفع للمستخدم
  Object.keys(methods).forEach(key => {
    const method = methods[key];
    console.log(method.PaymentMethodAr, method.TotalAmount);
  });
}
```

---

### 6. تهيئة الدفع

```typescript
import { initiatePayment } from '@/lib/api';

const payment = await initiatePayment({
  order_id: order.data.order.id,
  payment_method: 'VisaMaster', // طريقة الدفع المختارة
  customer_ip: '192.168.1.1', // IP العميل
  user_agent: navigator.userAgent
});

if (payment.success) {
  // إعادة توجيه المستخدم لصفحة الدفع
  window.location.href = payment.data.payment_url;
}
```

---

### 7. التحقق من حالة الدفع

```typescript
import { getPaymentStatus } from '@/lib/api';

const status = await getPaymentStatus(orderId);

if (status.success) {
  if (status.data.payment_status === 'paid') {
    // الدفع ناجح - إعادة التوجيه لصفحة النجاح
    window.location.href = '/payment-success';
  } else if (status.data.payment_status === 'failed') {
    // الدفع فشل - إعادة التوجيه لصفحة الفشل
    window.location.href = '/payment-failure';
  }
}
```

---

## مثال كامل

```typescript
import {
  getProducts,
  getShippingCost,
  calculateTotal,
  validateDiscountCode,
  createOrder,
  getPaymentMethods,
  initiatePayment,
  getPaymentStatus
} from '@/lib/api';

// 1. جلب المنتجات
const products = await getProducts({ page: 1, per_page: 20 });

// 2. إضافة المنتجات للسلة
const cartItems = [
  { product_id: 1, quantity: 2 },
  { product_id: 2, quantity: 1 }
];

// 3. جلب تكلفة الشحن
const shipping = await getShippingCost();
const shippingAmount = parseFloat(shipping.data.shipping_cost);

// 4. حساب الإجمالي
const total = await calculateTotal({
  items: cartItems,
  shipping_amount: shippingAmount
});

// 5. التحقق من كود الخصم (اختياري)
let discountCode = 'WELCOME10';
const validation = await validateDiscountCode(
  discountCode,
  cartItems,
  '96512345678',
  shippingAmount
);

if (!validation.success || !validation.data?.valid) {
  discountCode = undefined;
}

// 6. إنشاء الطلب
const orderData = {
  customer_name: 'أحمد علي',
  customer_phone: '96512345678',
  customer_email: 'ahmed@example.com',
  shipping_address: {
    street: 'شارع الرئيسي 123',
    city: 'الكويت',
    governorate: 'الكويت',
    postal_code: '12345'
  },
  items: cartItems,
  discount_code: discountCode,
  shipping_amount: shippingAmount
};

const order = await createOrder(orderData);

if (!order.success) {
  console.error('فشل إنشاء الطلب:', order.message);
  return;
}

// 7. جلب طرق الدفع
const paymentMethods = await getPaymentMethods();

if (!paymentMethods.success) {
  console.error('فشل جلب طرق الدفع');
  return;
}

// 8. اختيار طريقة الدفع (من قبل المستخدم)
const selectedPaymentMethod = 'VisaMaster';

// 9. تهيئة الدفع
const customerIP = '192.168.1.1'; // يجب الحصول عليها من الطلب
const payment = await initiatePayment({
  order_id: order.data.order.id,
  payment_method: selectedPaymentMethod,
  customer_ip: customerIP,
  user_agent: navigator.userAgent
});

if (payment.success) {
  // 10. إعادة التوجيه لصفحة الدفع
  window.location.href = payment.data.payment_url;
  
  // أو التحقق من حالة الدفع بشكل دوري
  const checkPaymentStatus = setInterval(async () => {
    const status = await getPaymentStatus(order.data.order.id);
    
    if (status.data.payment_status === 'paid') {
      clearInterval(checkPaymentStatus);
      window.location.href = '/payment-success';
    } else if (status.data.payment_status === 'failed') {
      clearInterval(checkPaymentStatus);
      window.location.href = '/payment-failure';
    }
  }, 5000); // التحقق كل 5 ثواني
}
```

---

## معالجة الأخطاء

```typescript
try {
  const order = await createOrder(orderData);
  
  if (!order.success) {
    console.error('فشل إنشاء الطلب:', order.message);
    // عرض رسالة خطأ للمستخدم
    return;
  }
  
  // متابعة عملية الدفع
} catch (error) {
  console.error('خطأ:', error);
  // عرض رسالة خطأ عامة للمستخدم
}
```

---

## ملاحظات مهمة

1. **تكلفة الشحن**: يجب جلب تكلفة الشحن قبل حساب الإجمالي
2. **كود الخصم**: يجب التحقق من كود الخصم قبل إنشاء الطلب
3. **طرق الدفع**: يجب جلب طرق الدفع بعد إنشاء الطلب
4. **رابط الدفع**: يجب إعادة توجيه المستخدم لرابط الدفع فوراً بعد التهيئة
5. **حالة الدفع**: يمكن التحقق من حالة الدفع بشكل دوري أو عبر callback
6. **معالجة الأخطاء**: يجب معالجة الأخطاء وعرض رسائل مناسبة للمستخدم
7. **العملة**: جميع المبالغ بالدينار الكويتي (KWD)
8. **رقم الهاتف**: رقم الهاتف مطلوب ويجب أن يكون بالتنسيق الدولي

---

## روابط API

**الرابط الأساسي**: `https://api.soapy-bubbles.com/api/v1`

**Endpoints المستخدمة**:
- `GET /products` - جلب المنتجات
- `GET /shipping/cost` - جلب تكلفة الشحن
- `POST /checkout/calculate-total` - حساب الإجمالي
- `POST /checkout/validate-discount` - التحقق من كود الخصم
- `POST /checkout/create-order` - إنشاء الطلب
- `GET /payments/methods` - جلب طرق الدفع
- `POST /payments/initiate` - تهيئة الدفع
- `GET /payments/status` - جلب حالة الدفع

---

## الدعم

للحصول على المزيد من المعلومات أو الدعم، يرجى التواصل مع فريق التطوير.

