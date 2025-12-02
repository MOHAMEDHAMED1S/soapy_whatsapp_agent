import { Product } from './product.types';

// Country Code Types
export type CountryCode = 'KW' | 'SA' | 'AE' | 'BH' | 'OM' | 'QA';

export const SUPPORTED_COUNTRIES: Record<CountryCode, string> = {
  KW: 'الكويت',
  SA: 'السعودية',
  AE: 'الإمارات',
  BH: 'البحرين',
  OM: 'عُمان',
  QA: 'قطر'
};

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  products: T[];
  hasMore: boolean;
  current_page: number;
  last_page: number;
  total: number;
}

export interface ProductsResponse {
  data: Product[]; // API returns products in data.data array
  current_page: number;
  last_page: number;
  total: number;
  per_page: number;
  from: number;
  to: number;
  first_page_url: string;
  last_page_url: string;
  next_page_url: string | null;
  prev_page_url: string | null;
  path: string;
  links: Array<{
    url: string | null;
    label: string;
    active: boolean;
    page: number | null;
  }>;
  // Computed properties
  hasMore?: boolean;
  products?: Product[]; // Alias for data for backward compatibility
}

// Request Types
export interface GetProductsParams {
  page?: number;
  per_page?: number;
  category?: string;
  search?: string;
  sort?: string;
}

export interface CartItem {
  product_id: number;
  quantity: number;
}

export interface CalculateTotalRequest {
  items: CartItem[];
  discount_code?: string;
  shipping_amount: number;
}

export interface OrderTotal {
  subtotal?: number;           // Optional for backward compatibility
  subtotal_amount?: number;    // API returns this
  shipping_amount: number;
  discount_amount: number;
  total?: number;              // Optional for backward compatibility
  total_amount?: number;       // API returns this
  currency: string;
  items?: any[];               // Optional: items with product details
  discount_code?: string | null;
  free_shipping?: boolean;
}

export interface ValidateDiscountCodeRequest {
  discount_code: string;
  items: CartItem[];
  customer_phone: string;
  shipping_amount: number;
}

export interface DiscountCodeInfo {
  code: string;
  name: string;
  description: string | null;
  type: 'percentage' | 'fixed_amount';
  value: string;
  minimum_order_amount: string;
  maximum_discount_amount: string;
  expires_at: string | null;
  usage_count: number;
  usage_limit: number;
  remaining_usage: number;
}

export interface OrderSummary {
  subtotal_amount: number;
  discount_amount: number;
  shipping_amount: number;
  total_amount: number;
  currency: string;
  free_shipping: boolean;
}

export interface ValidateDiscountCodeItem {
  product: Product;
  quantity: number;
  item_total: number;
  price_used: number;
}

export interface ValidateDiscountCodeResponse {
  discount_code: DiscountCodeInfo;
  order_summary: OrderSummary;
  items: ValidateDiscountCodeItem[];
}

export interface ShippingAddress {
  street: string;
  city: string;
  governorate: string;
  postal_code?: string; // Optional
}

export interface CreateOrderRequest {
  customer_name: string;
  customer_phone: string;
  customer_email?: string; // Optional - Will default to guest@soapy.com if not provided
  country_code: CountryCode; // NEW - Required for shipping calculation
  shipping_address: ShippingAddress;
  items: CartItem[];
  discount_code?: string;
  notes?: string; // Optional order notes
  // shipping_amount removed - calculated automatically by API
}

export interface CreateOrderResponse {
  order: any;
  tracking_number: string;
  order_number: string;
  total_amount: number;
  subtotal_amount: number;
  discount_amount: number;
  shipping_amount: number;
  currency: string;
  next_step: string;
  shipping_details?: CalculateShippingResponse; // NEW - Detailed shipping calculation
  discount_code?: string | null;
  free_shipping?: boolean;
}

export interface PaymentMethod {
  PaymentMethodId: number;
  PaymentMethodAr: string;
  PaymentMethodEn: string;
  PaymentMethodCode: string;
  IsDirectPayment: boolean;
  ServiceCharge: number;
  TotalAmount: number;
  CurrencyIso: string;
  ImageUrl: string;
  IsEmbeddedSupported: boolean;
  PaymentCurrencyIso: string;
}

export interface PaymentMethodsResponse {
  [key: string]: PaymentMethod;
}

export interface InitiatePaymentRequest {
  order_id: number;
  payment_method: string;
  customer_ip: string;
  user_agent?: string;
}

export interface InitiatePaymentResponse {
  payment_id: number;
  invoice_id: number;
  payment_url: string;
  order_id: number;
  order_number: string;
  amount: string;
  currency: string;
  redirect_url: string;
}

export interface PaymentStatusResponse {
  order_id: number;
  order_number: string;
  status: string;
  payment_status: string;
  amount: string;
  currency: string;
  payment_method: string;
  invoice_id: string;
}

export interface ShippingCostResponse {
  shipping_cost: string;
}

// New Shipping Calculation Types
export interface CalculateShippingRequest {
  product_ids: number[];
  quantities: number[];
  country_code: CountryCode;
}

export interface ShippingBreakdown {
  matched_tier: {
    max_weight_kg: number;
    base_price: number;
    additional_percentage: number;
  };
  actual_weight_kg: number;
  rounded_to_tier_kg: number;
  base_price: number;
  additional_fee: number;
  final_price: number;
}

export interface CalculateShippingResponse {
  total_weight_grams: number;
  total_weight_kg: number;
  shipping_cost: number;
  breakdown: ShippingBreakdown;
  country_code: string;
  currency: string;
}

// Order Tracking Types
export interface OrderTrackingTimelineItem {
  status: string;
  title: string;
  description: string;
  date: string;
  completed: boolean;
}

export interface OrderTrackingStatusInfo {
  title: string;
  description: string;
  color: string;
  icon: string;
}

export interface OrderTrackingOrderItem {
  id: number;
  product_id: number;
  product_price: string;
  quantity: number;
  subtotal: number;
  product_snapshot?: {
    title: string;
    slug: string;
    price: string;
    currency: string;
    description?: string;
    images?: string[];
    category?: string;
    meta?: any;
    has_discount?: boolean;
    discounted_price?: number;
    short_description?: string | null;
    discount_percentage?: number | null;
  };
  product?: Product;
}

export interface OrderTrackingPayment {
  id: number;
  order_id: number;
  provider: string;
  payment_method: string;
  invoice_reference: string;
  payment_id: string | null;
  amount: string;
  currency: string;
  status: string;
  response_raw?: any;
  created_at: string;
  updated_at: string;
}

export interface OrderTrackingOrder {
  id: number;
  customer_id: number;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  shipping_address: ShippingAddress;
  total_amount: string;
  currency: string;
  status: string;
  tracking_number: string;
  shipping_date: string | null;
  delivery_date: string | null;
  payment_id: number | null;
  notes: string | null;
  discount_code: string | null;
  discount_amount: string;
  subtotal_amount: string;
  shipping_amount: string;
  free_shipping: boolean;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  payment?: OrderTrackingPayment;
  customer?: any;
  order_items: OrderTrackingOrderItem[];
}

export interface OrderTrackingResponse {
  order: OrderTrackingOrder;
  timeline: OrderTrackingTimelineItem[];
  status_info: OrderTrackingStatusInfo;
}

