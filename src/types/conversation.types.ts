// Conversation Types
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ConversationContext {
  phone: string;
  messages: ConversationMessage[];
  orderData?: any;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationState {
  phone: string;
  messages: ConversationMessage[];
  currentIntent?: string;
  collectedData?: Record<string, any>;
  lastMessageTime: Date;
}

export interface SavedConversation {
  id?: number;
  phone: string;
  messages: string; // JSON string
  order_data?: string; // JSON string
  metadata?: string; // JSON string
  created_at: Date;
  updated_at: Date;
}

export interface SavedOrder {
  id?: number;
  order_id: number;
  phone: string;
  order_data: string; // JSON string
  payment_url?: string;
  status: string;
  created_at: Date;
}

