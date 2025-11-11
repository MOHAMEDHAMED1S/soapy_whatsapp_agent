import { Message } from 'whatsapp-web.js';
import { logger } from '../utils/logger';
import { conversationManager } from './ConversationManager';
import { geminiService } from '../services/GeminiService';
import { whatsappBot } from './WhatsAppBot';

export class MessageHandler {
  // Extract phone number from WhatsApp message
  private extractPhoneNumber(from: string): string {
    // WhatsApp format: 965XXXXXXXXX@c.us
    return from.replace('@c.us', '');
  }

  // Handle incoming message
  async handleMessage(msg: Message): Promise<void> {
    try {
      const phone = this.extractPhoneNumber(msg.from);
      const userMessage = msg.body.trim();

      logger.info(`Message from ${phone}: ${userMessage.substring(0, 50)}...`);

      // Ignore empty messages
      if (!userMessage) {
        return;
      }

      // Add user message to conversation
      conversationManager.addMessage(phone, 'user', userMessage);

      // Send typing indicator
      await whatsappBot.sendTypingIndicator(phone);

      // Get conversation history
      const conversationHistory = conversationManager.getFullConversationHistory(phone);

      // Generate response using Gemini
      try {
        const response = await geminiService.generateResponseWithFunctions(
          userMessage,
          conversationHistory,
          phone
        );

        // Clear typing indicator before sending message
        await whatsappBot.clearTypingIndicator(phone);

        // Send response to user
        await whatsappBot.sendMessage(phone, response.text);

        // Add assistant message to conversation
        conversationManager.addMessage(phone, 'assistant', response.text);

        // If function was called (like create_order), handle additional tasks
        // Note: The actual function execution is done in GeminiService
        // This is for additional handling like saving order data to database
        if (response.functionCall && response.functionCall.name === 'create_order') {
          await this.handleOrderCreated(response.functionCall, phone);
        }
      } catch (error: any) {
        logger.error('Error generating response:', error);
        
        // Clear typing indicator in case of error
        await whatsappBot.clearTypingIndicator(phone);
        
        // Send error message to user
        const errorMessage = 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.';
        await whatsappBot.sendMessage(phone, errorMessage);
        conversationManager.addMessage(phone, 'assistant', errorMessage);
      }
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  // Handle order creation (additional tasks after order is created)
  // Note: The order is already created in GeminiService.executeFunction
  // This method handles saving to database and other post-creation tasks
  private async handleOrderCreated(functionCall: any, _phone: string): Promise<void> {
    try {
      const { args } = functionCall;

      logger.info('Order created, handling post-creation tasks', args);

      // The order creation and payment initiation are already handled in GeminiService
      // This method can be used for additional tasks like:
      // - Sending confirmation emails
      // - Updating analytics
      // - Notifying administrators
      
      // For now, we'll just log that the order was created
      // The actual order data and payment URL are already sent to the user by GeminiService
    } catch (error) {
      logger.error('Error handling order creation:', error);
    }
  }
}

// Export singleton instance
export const messageHandler = new MessageHandler();

