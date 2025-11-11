import { conversationRepository } from '../database/ConversationRepository';
import { ConversationContext, ConversationMessage } from '../types/conversation.types';
import { OrderState, OrderStep, OrderField, OrderData } from '../types/order.types';
import { logger } from '../utils/logger';

export class ConversationManager {
  // Get or create conversation context
  getConversationContext(phone: string): ConversationContext {
    const context = conversationRepository.getConversation(phone);
    
    if (context) {
      return context;
    }

    // Create new context
    const newContext: ConversationContext = {
      phone,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.saveConversationContext(newContext);
    return newContext;
  }

  // Save conversation context
  saveConversationContext(context: ConversationContext): void {
    conversationRepository.saveConversation(
      context.phone,
      context.messages,
      context.orderData,
      context.metadata
    );
  }

  // Add message to conversation
  addMessage(phone: string, role: 'user' | 'assistant', content: string): void {
    const context = this.getConversationContext(phone);
    
    const message: ConversationMessage = {
      role,
      content,
      timestamp: new Date(),
    };

    context.messages.push(message);
    context.updatedAt = new Date();
    
    // Keep only last 50 messages to avoid memory issues
    if (context.messages.length > 50) {
      context.messages = context.messages.slice(-50);
    }

    this.saveConversationContext(context);
  }

  // Get conversation history
  getConversationHistory(phone: string, limit: number = 10): ConversationMessage[] {
    const context = this.getConversationContext(phone);
    return context.messages.slice(-limit);
  }

  // Get full conversation history for AI
  getFullConversationHistory(phone: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    const context = this.getConversationContext(phone);
    return context.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  // Initialize order state
  initializeOrderState(phone: string): OrderState {
    const context = this.getConversationContext(phone);
    
    if (!context.metadata) {
      context.metadata = {};
    }

    if (!context.metadata.orderState) {
      context.metadata.orderState = {
        step: OrderStep.IDLE,
        collectedFields: new Set(),
      };
    }

    const orderState: OrderState = {
      step: context.metadata.orderState.step || OrderStep.IDLE,
      orderData: context.metadata.orderState.orderData || {},
      collectedFields: new Set(context.metadata.orderState.collectedFields || []),
    };

    this.saveConversationContext(context);
    return orderState;
  }

  // Update order state
  updateOrderState(phone: string, orderState: OrderState): void {
    const context = this.getConversationContext(phone);
    
    if (!context.metadata) {
      context.metadata = {};
    }

    // Convert Set to Array for storage
    context.metadata.orderState = {
      step: orderState.step,
      orderData: orderState.orderData,
      collectedFields: Array.from(orderState.collectedFields).map(f => f.toString()),
    };

    this.saveConversationContext(context);
  }

  // Get order state
  getOrderState(phone: string): OrderState {
    const context = this.getConversationContext(phone);
    
    if (!context.metadata || !context.metadata.orderState) {
      return this.initializeOrderState(phone);
    }

    const storedFields = context.metadata.orderState.collectedFields || [];
    return {
      step: context.metadata.orderState.step,
      orderData: context.metadata.orderState.orderData || {},
      collectedFields: new Set(storedFields.map((f: string) => f as OrderField)),
    };
  }

  // Check if order data is complete
  isOrderDataComplete(orderData: Partial<OrderData>): boolean {
    return !!(
      orderData.customer_name &&
      orderData.customer_phone &&
      orderData.customer_email &&
      orderData.shipping_address?.street &&
      orderData.shipping_address?.city &&
      orderData.shipping_address?.governorate &&
      orderData.shipping_address?.postal_code &&
      orderData.items &&
      orderData.items.length > 0
    );
  }

  // Extract order data from conversation
  extractOrderDataFromMessage(message: string, currentOrderData: Partial<OrderData>): Partial<OrderData> {
    const updated: Partial<OrderData> = { ...currentOrderData };

    // Simple pattern matching for order information
    // In a real implementation, you might use NLP or more sophisticated parsing
    
    // Email pattern
    const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    if (emailMatch) {
      updated.customer_email = emailMatch[0];
    }

    // Phone number pattern (if not already set)
    if (!updated.customer_phone) {
      const phoneMatch = message.match(/(?:\+?965|0)?\d{8}/);
      if (phoneMatch) {
        updated.customer_phone = phoneMatch[0];
      }
    }

    return updated;
  }

  // Clear order state
  clearOrderState(phone: string): void {
    const context = this.getConversationContext(phone);
    
    if (context.metadata) {
      context.metadata.orderState = {
        step: OrderStep.IDLE,
        collectedFields: [],
      };
      context.metadata.orderData = undefined;
    }

    this.saveConversationContext(context);
  }

  // Save order data to context
  saveOrderData(phone: string, orderData: any): void {
    const context = this.getConversationContext(phone);
    context.orderData = orderData;
    this.saveConversationContext(context);
  }

  // Get order data from context
  getOrderData(phone: string): any {
    const context = this.getConversationContext(phone);
    return context.orderData;
  }

  // Clear conversation
  clearConversation(phone: string): void {
    conversationRepository.deleteConversation(phone);
    logger.info(`Cleared conversation for phone: ${phone}`);
  }
}

// Export singleton instance
export const conversationManager = new ConversationManager();

