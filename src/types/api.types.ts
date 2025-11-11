import { Product } from './product.types';

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
  subtotal: number;
  shipping_amount: number;
  discount_amount: number;
  total: number;
  currency: string;
}

export interface ShippingAddress {
  street: string;
  city: string;
  governorate: string;
  postal_code: string;
}

export interface CreateOrderRequest {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  shipping_address: ShippingAddress;
  items: CartItem[];
  discount_code?: string;
  shipping_amount: number;
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

