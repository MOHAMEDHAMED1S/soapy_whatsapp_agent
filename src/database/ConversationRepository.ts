import { databaseManager } from './Database';
import { ConversationContext, SavedConversation, SavedOrder } from '../types/conversation.types';
import { logger } from '../utils/logger';

export class ConversationRepository {
  private db = databaseManager.getDatabase();

  // Save or update conversation
  saveConversation(phone: string, messages: any[], orderData?: any, metadata?: any): void {
    try {
      const messagesJson = JSON.stringify(messages);
      const orderDataJson = orderData ? JSON.stringify(orderData) : null;
      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      const existing = this.db.prepare('SELECT id FROM conversations WHERE phone = ?').get(phone) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare(
            `UPDATE conversations 
             SET messages = ?, order_data = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE phone = ?`
          )
          .run(messagesJson, orderDataJson, metadataJson, phone);
        logger.debug(`Updated conversation for phone: ${phone}`);
      } else {
        this.db
          .prepare(
            `INSERT INTO conversations (phone, messages, order_data, metadata) 
             VALUES (?, ?, ?, ?)`
          )
          .run(phone, messagesJson, orderDataJson, metadataJson);
        logger.debug(`Created new conversation for phone: ${phone}`);
      }
    } catch (error) {
      logger.error('Error saving conversation:', error);
      throw error;
    }
  }

  // Get conversation by phone
  getConversation(phone: string): ConversationContext | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM conversations WHERE phone = ?')
        .get(phone) as SavedConversation | undefined;

      if (!row) {
        return null;
      }

      return {
        phone: row.phone,
        messages: JSON.parse(row.messages as string),
        orderData: row.order_data ? JSON.parse(row.order_data as string) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    } catch (error) {
      logger.error('Error getting conversation:', error);
      return null;
    }
  }

  // Delete conversation
  deleteConversation(phone: string): void {
    try {
      this.db.prepare('DELETE FROM conversations WHERE phone = ?').run(phone);
      logger.debug(`Deleted conversation for phone: ${phone}`);
    } catch (error) {
      logger.error('Error deleting conversation:', error);
      throw error;
    }
  }

  // Save order
  saveOrder(orderId: number, phone: string, orderData: any, paymentUrl?: string, status: string = 'pending'): void {
    try {
      const orderDataJson = JSON.stringify(orderData);

      this.db
        .prepare(
          `INSERT INTO orders (order_id, phone, order_data, payment_url, status) 
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(orderId, phone, orderDataJson, paymentUrl || null, status);
      
      logger.info(`Saved order ${orderId} for phone: ${phone}`);
    } catch (error) {
      logger.error('Error saving order:', error);
      throw error;
    }
  }

  // Get order by order ID
  getOrder(orderId: number): SavedOrder | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM orders WHERE order_id = ?')
        .get(orderId) as SavedOrder | undefined;

      if (!row) {
        return null;
      }

      return row;
    } catch (error) {
      logger.error('Error getting order:', error);
      return null;
    }
  }

  // Get orders by phone
  getOrdersByPhone(phone: string): SavedOrder[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM orders WHERE phone = ? ORDER BY created_at DESC')
        .all(phone) as SavedOrder[];

      return rows;
    } catch (error) {
      logger.error('Error getting orders by phone:', error);
      return [];
    }
  }

  // Update order status
  updateOrderStatus(orderId: number, status: string, paymentUrl?: string): void {
    try {
      if (paymentUrl) {
        this.db
          .prepare(
            `UPDATE orders SET status = ?, payment_url = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE order_id = ?`
          )
          .run(status, paymentUrl, orderId);
      } else {
        this.db
          .prepare(
            `UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE order_id = ?`
          )
          .run(status, orderId);
      }
      
      logger.info(`Updated order ${orderId} status to ${status}`);
    } catch (error) {
      logger.error('Error updating order status:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const conversationRepository = new ConversationRepository();

