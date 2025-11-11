import { CartItem, ShippingAddress } from './api.types';

// Order Types
export interface OrderData {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  shipping_address: ShippingAddress;
  items: CartItem[];
  shipping_amount: number;
}

export interface OrderInfo {
  order_id: number;
  order_number: string;
  tracking_number: string;
  total_amount: number;
  subtotal_amount: number;
  discount_amount: number;
  shipping_amount: number;
  currency: string;
  status: string;
  payment_status: string;
  payment_url?: string;
  created_at: string;
}

export interface OrderState {
  step: OrderStep;
  orderData?: Partial<OrderData>;
  collectedFields: Set<OrderField>;
}

export enum OrderStep {
  IDLE = 'idle',
  COLLECTING_INFO = 'collecting_info',
  REVIEWING = 'reviewing',
  CREATING = 'creating',
  PAYMENT = 'payment',
  COMPLETED = 'completed'
}

export enum OrderField {
  CUSTOMER_NAME = 'customer_name',
  CUSTOMER_PHONE = 'customer_phone',
  CUSTOMER_EMAIL = 'customer_email',
  STREET = 'street',
  CITY = 'city',
  GOVERNORATE = 'governorate',
  POSTAL_CODE = 'postal_code',
  ITEMS = 'items'
}

export interface OrderContext {
  phone: string;
  orderState: OrderState;
  cart: CartItem[];
  lastActivity: Date;
}

