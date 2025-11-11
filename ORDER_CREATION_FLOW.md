# Order Creation Flow Documentation
## سير عمل إنشاء الطلب

This document describes the complete flow of creating an order from fetching products to payment initiation.

---

## Overview | نظرة عامة

The order creation flow consists of the following steps:
1. **Fetch Products** - جلب المنتجات
2. **Calculate Total** - حساب الإجمالي
3. **Validate Discount Code** - التحقق من كود الخصم
4. **Create Order** - إنشاء الطلب
5. **Get Payment Methods** - جلب طرق الدفع
6. **Initiate Payment** - تهيئة الدفع
7. **Process Payment** - معالجة الدفع

---

## 1. Fetch Products | جلب المنتجات

### 1.1 Get All Products
Fetch a paginated list of products.

**API Function**: `getProducts()`

**Endpoint**: `GET /api/v1/products`

**Parameters**:
```typescript
{
  page?: number;        // Page number (default: 1)
  per_page?: number;    // Items per page (default: 10)
  category?: string;    // Category slug
  search?: string;      // Search query
  sort?: string;        // Sort field
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    products: Product[];
    hasMore: boolean;
    current_page: number;
    last_page: number;
    total: number;
  };
  message: string;
}
```

**Example**:
```typescript
import { getProducts } from '@/lib/api';

// Get all products
const response = await getProducts({
  page: 1,
  per_page: 20,
  sort: 'created_at'
});

// Get products by category
const categoryProducts = await getProducts({
  category: 'soap',
  page: 1,
  per_page: 10
});

// Search products
const searchResults = await getProducts({
  search: 'lavender',
  page: 1
});
```

---

### 1.2 Get Single Product
Fetch a single product by slug or ID.

**API Functions**: 
- `getProduct(slug: string)` - By slug
- `getProductById(id: string | number)` - By ID

**Endpoints**: 
- `GET /api/v1/products/{slug}`
- `GET /api/v1/products/{id}`

**Response**:
```typescript
{
  success: boolean;
  data: Product;
  message: string;
}
```

**Example**:
```typescript
import { getProduct, getProductById } from '@/lib/api';

// Get by slug
const product = await getProduct('lavender-soap-100g');

// Get by ID
const productById = await getProductById(123);
```

---

### 1.3 Get Featured Products
Fetch featured products.

**API Function**: `getFeaturedProducts()`

**Endpoint**: `GET /api/v1/products/featured`

**Response**:
```typescript
{
  success: boolean;
  data: Product[];
  message: string;
}
```

**Example**:
```typescript
import { getFeaturedProducts } from '@/lib/api';

const featuredProducts = await getFeaturedProducts();
```

---

## 2. Calculate Total | حساب الإجمالي

Calculate the order total including items, shipping, and discount.

**API Function**: `calculateTotal()`

**Endpoint**: `POST /api/v1/checkout/calculate-total`

**Request Body**:
```typescript
{
  items: CartItem[];           // Array of cart items
  discount_code?: string;      // Optional discount code
  shipping_amount: number;     // Shipping cost
}

interface CartItem {
  product_id: number;
  quantity: number;
}
```

**Response**:
```typescript
{
  success: boolean;
  data: OrderTotal;
  message: string;
}

interface OrderTotal {
  subtotal: number;        // Subtotal before discount
  shipping_amount: number; // Shipping cost
  discount_amount: number; // Discount amount
  total: number;           // Final total
  currency: string;        // Currency code (e.g., 'KWD')
}
```

**Example**:
```typescript
import { calculateTotal } from '@/lib/api';

const total = await calculateTotal({
  items: [
    { product_id: 1, quantity: 2 },
    { product_id: 2, quantity: 1 }
  ],
  discount_code: 'WELCOME10',
  shipping_amount: 2.5
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

## 3. Validate Discount Code | التحقق من كود الخصم

Validate a discount code before creating the order.

**API Function**: `validateDiscountCode()`

**Endpoint**: `POST /api/v1/checkout/validate-discount`

**Request Body**:
```typescript
{
  discount_code: string;      // Discount code to validate
  items: CartItem[];          // Cart items
  customer_phone: string;     // Customer phone number
  shipping_amount: number;    // Shipping cost
}
```

**Response**:
```typescript
{
  success: boolean;
  data?: {
    code: string;
    type: 'percentage' | 'fixed_amount';
    value: number;
    discount_amount: number;
    valid: boolean;
    message?: string;
  };
  message: string;
  errors?: {
    discount_code?: string[];
  };
}
```

**Example**:
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
  console.log('Discount applied:', validation.data.discount_amount);
} else {
  console.error('Invalid discount code:', validation.message);
}
```

---

## 4. Get Shipping Cost | جلب تكلفة الشحن

Get the current shipping cost.

**API Function**: `getShippingCost()`

**Endpoint**: `GET /api/v1/shipping/cost`

**Response**:
```typescript
{
  success: boolean;
  data: {
    shipping_cost: string;  // Shipping cost as string
  };
  message: string;
}
```

**Example**:
```typescript
import { getShippingCost } from '@/lib/api';

const shipping = await getShippingCost();
const shippingAmount = parseFloat(shipping.data.shipping_cost);
```

---

## 5. Create Order | إنشاء الطلب

Create a new order with customer information and items.

**API Function**: `createOrder()`

**Endpoint**: `POST /api/v1/checkout/create-order`

**Request Body**:
```typescript
{
  customer_name: string;           // Customer name
  customer_phone: string;          // Customer phone
  customer_email: string;          // Customer email
  shipping_address: {              // Shipping address
    street: string;
    city: string;
    governorate: string;
    postal_code: string;
  };
  items: CartItem[];               // Order items
  discount_code?: string;          // Optional discount code
  shipping_amount: number;         // Shipping cost
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    order: any;                    // Order object
    tracking_number: string;       // Order tracking number
    order_number: string;          // Order number
    total_amount: number;          // Total amount
    subtotal_amount: number;       // Subtotal
    discount_amount: number;       // Discount amount
    shipping_amount: number;       // Shipping amount
    currency: string;              // Currency code
    next_step: string;             // Next step (usually 'payment')
  };
  message: string;
}
```

**Example**:
```typescript
import { createOrder } from '@/lib/api';

const orderData = {
  customer_name: 'Ahmed Ali',
  customer_phone: '96512345678',
  customer_email: 'ahmed@example.com',
  shipping_address: {
    street: '123 Main Street',
    city: 'Kuwait City',
    governorate: 'Kuwait',
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
  console.log('Order created:', order.data.order_number);
  console.log('Next step:', order.data.next_step);
  // Proceed to payment
}
```

---

## 6. Get Payment Methods | جلب طرق الدفع

Get available payment methods.

**API Function**: `getPaymentMethods()`

**Endpoint**: `GET /api/v1/payments/methods`

**Response**:
```typescript
{
  success: boolean;
  data: {
    [key: string]: PaymentMethod;
  };
  message: string;
}

interface PaymentMethod {
  PaymentMethodId: number;
  PaymentMethodAr: string;         // Arabic name
  PaymentMethodEn: string;         // English name
  PaymentMethodCode: string;       // Payment method code
  IsDirectPayment: boolean;        // Is direct payment
  ServiceCharge: number;           // Service charge
  TotalAmount: number;             // Total amount
  CurrencyIso: string;             // Currency ISO code
  ImageUrl: string;                // Payment method image URL
  IsEmbeddedSupported: boolean;    // Is embedded payment supported
  PaymentCurrencyIso: string;      // Payment currency ISO
}
```

**Example**:
```typescript
import { getPaymentMethods } from '@/lib/api';

const paymentMethods = await getPaymentMethods();

if (paymentMethods.success) {
  const methods = paymentMethods.data;
  
  // Iterate through payment methods
  Object.keys(methods).forEach(key => {
    const method = methods[key];
    console.log(method.PaymentMethodEn, method.TotalAmount);
  });
}
```

---

## 7. Initiate Payment | تهيئة الدفع

Initiate payment for an order.

**API Function**: `initiatePayment()`

**Endpoint**: `POST /api/v1/payments/initiate`

**Request Body**:
```typescript
{
  order_id: number;          // Order ID
  payment_method: string;    // Payment method code
  customer_ip: string;       // Customer IP address
  user_agent?: string;       // Optional user agent
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    payment_id: number;      // Payment ID
    invoice_id: number;      // Invoice ID
    payment_url: string;     // Payment URL (redirect user here)
    order_id: number;        // Order ID
    order_number: string;    // Order number
    amount: string;          // Payment amount
    currency: string;        // Currency code
    redirect_url: string;    // Redirect URL after payment
  };
  message: string;
}
```

**Example**:
```typescript
import { initiatePayment } from '@/lib/api';

// Get customer IP (example)
const customerIP = '192.168.1.1'; // In real app, get from request

const payment = await initiatePayment({
  order_id: order.data.order.id,
  payment_method: 'VisaMaster',
  customer_ip: customerIP,
  user_agent: navigator.userAgent
});

if (payment.success) {
  // Redirect user to payment URL
  window.location.href = payment.data.payment_url;
  
  // Or open in new window
  window.open(payment.data.payment_url, '_blank');
}
```

---

## 8. Get Payment Status | جلب حالة الدفع

Check the payment status of an order.

**API Function**: `getPaymentStatus()`

**Endpoint**: `GET /api/v1/payments/status`

**Parameters**:
```typescript
{
  order_id: number;  // Order ID
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    order_id: number;
    order_number: string;
    status: string;              // Order status
    payment_status: string;      // Payment status
    amount: string;              // Payment amount
    currency: string;            // Currency code
    payment_method: string;      // Payment method
    invoice_id: string;          // Invoice ID
  };
  message: string;
}
```

**Example**:
```typescript
import { getPaymentStatus } from '@/lib/api';

const status = await getPaymentStatus(orderId);

if (status.success) {
  console.log('Payment Status:', status.data.payment_status);
  console.log('Order Status:', status.data.status);
  
  if (status.data.payment_status === 'paid') {
    // Payment successful
    // Redirect to success page
  } else if (status.data.payment_status === 'failed') {
    // Payment failed
    // Show error message
  }
}
```

---

## 9. Process Payment Callback | معالجة رد الدفع

Process payment callback after payment completion.

**API Function**: `processPaymentCallback()`

**Endpoint**: `POST /api/v1/payments/callback`

**Request Body**:
```typescript
{
  paymentId: string;    // Payment ID from payment gateway
  order_id: number;     // Order ID
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    order_id: number;
    order_number: string;
    status: string;              // Order status
    payment_status: string;      // Payment status
    amount: string;              // Payment amount
    currency: string;            // Currency code
  };
  message: string;
}
```

**Example**:
```typescript
import { processPaymentCallback } from '@/lib/api';

// Usually called by payment gateway callback
const callback = await processPaymentCallback({
  paymentId: 'payment-gateway-id',
  order_id: orderId
});

if (callback.success) {
  // Payment processed successfully
  // Update UI or redirect
}
```

---

## 10. Verify Payment | التحقق من الدفع

Verify payment status (alternative to getPaymentStatus).

**API Function**: `verifyPayment()`

**Endpoint**: `GET /api/v1/payments/status`

**Parameters**:
```typescript
{
  order_id: number;  // Order ID
}
```

**Response**:
```typescript
{
  success: boolean;
  data: {
    order_id: number;
    order_number: string;
    status: string;
    payment_status: string;
    amount: string;
    currency: string;
    payment_method: string;
    invoice_id: string;
  };
  message: string;
}
```

**Example**:
```typescript
import { verifyPayment } from '@/lib/api';

const verification = await verifyPayment(orderId);

if (verification.success) {
  // Handle payment verification
}
```

---

## Complete Flow Example | مثال كامل للسير

Here's a complete example of the order creation flow:

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

// Step 1: Fetch Products
const products = await getProducts({ page: 1, per_page: 20 });

// Step 2: User adds products to cart
const cartItems = [
  { product_id: 1, quantity: 2 },
  { product_id: 2, quantity: 1 }
];

// Step 3: Get Shipping Cost
const shipping = await getShippingCost();
const shippingAmount = parseFloat(shipping.data.shipping_cost);

// Step 4: Calculate Total
const total = await calculateTotal({
  items: cartItems,
  shipping_amount: shippingAmount
});

// Step 5: Validate Discount Code (optional)
let discountCode = 'WELCOME10';
const validation = await validateDiscountCode(
  discountCode,
  cartItems,
  '96512345678',
  shippingAmount
);

if (!validation.success || !validation.data?.valid) {
  discountCode = undefined; // Remove invalid discount code
}

// Step 6: Create Order
const orderData = {
  customer_name: 'Ahmed Ali',
  customer_phone: '96512345678',
  customer_email: 'ahmed@example.com',
  shipping_address: {
    street: '123 Main Street',
    city: 'Kuwait City',
    governorate: 'Kuwait',
    postal_code: '12345'
  },
  items: cartItems,
  discount_code: discountCode,
  shipping_amount: shippingAmount
};

const order = await createOrder(orderData);

if (!order.success) {
  console.error('Failed to create order:', order.message);
  return;
}

// Step 7: Get Payment Methods
const paymentMethods = await getPaymentMethods();

if (!paymentMethods.success) {
  console.error('Failed to get payment methods');
  return;
}

// Step 8: Select Payment Method (user selects)
const selectedPaymentMethod = 'VisaMaster'; // User's choice

// Step 9: Initiate Payment
const customerIP = await getClientIP(); // Get from request or use '0.0.0.0'
const payment = await initiatePayment({
  order_id: order.data.order.id,
  payment_method: selectedPaymentMethod,
  customer_ip: customerIP,
  user_agent: navigator.userAgent
});

if (payment.success) {
  // Step 10: Redirect to Payment URL
  window.location.href = payment.data.payment_url;
  
  // Or poll for payment status
  const checkPaymentStatus = setInterval(async () => {
    const status = await getPaymentStatus(order.data.order.id);
    
    if (status.data.payment_status === 'paid') {
      clearInterval(checkPaymentStatus);
      // Redirect to success page
      window.location.href = '/payment-success';
    } else if (status.data.payment_status === 'failed') {
      clearInterval(checkPaymentStatus);
      // Redirect to failure page
      window.location.href = '/payment-failure';
    }
  }, 5000); // Check every 5 seconds
}
```

---

## Error Handling | معالجة الأخطاء

Always handle errors appropriately:

```typescript
try {
  const order = await createOrder(orderData);
  
  if (!order.success) {
    // Handle API error
    console.error('Order creation failed:', order.message);
    // Show error message to user
    return;
  }
  
  // Proceed with payment
} catch (error) {
  // Handle network or other errors
  console.error('Error:', error);
  // Show generic error message to user
}
```

---

## Notes | ملاحظات

1. **Shipping Cost**: Always fetch shipping cost before calculating total.
2. **Discount Code**: Validate discount code before creating order.
3. **Payment Methods**: Fetch payment methods after order creation.
4. **Payment URL**: Redirect user to payment URL immediately after initiation.
5. **Payment Status**: Poll payment status if needed, or handle via callback.
6. **Error Handling**: Always handle errors and show appropriate messages to users.
7. **Currency**: All amounts are in KWD (Kuwaiti Dinar).
8. **Phone Number**: Customer phone number is required and should be in international format.

---

## API Base URL | رابط API الأساسي

```
https://api.soapy-bubbles.com/api/v1
```

---

## Support | الدعم

For more information or support, please contact the development team.

