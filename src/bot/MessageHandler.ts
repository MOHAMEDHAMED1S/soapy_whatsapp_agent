import { Message } from 'whatsapp-web.js';
import { logger } from '../utils/logger';
import { conversationManager } from './ConversationManager';
import { geminiService } from '../services/GeminiService';
import { whatsappBot } from './WhatsAppBot';
import { blockedNumbersService } from '../services/BlockedNumbersService';
import { rateLimiterService } from '../services/RateLimiterService';

export class MessageHandler {
  // Queue for processing messages (one at a time per phone number)
  private processingQueue: Map<string, Promise<void>> = new Map();

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

      // Check if number is blocked
      if (blockedNumbersService.isBlocked(phone)) {
        logger.warn(`Message from blocked number ${phone} - ignoring`);
        return; // Silently ignore messages from blocked numbers
      }

      // Check rate limit
      const rateLimitCheck = await rateLimiterService.checkRateLimit(phone);
      if (!rateLimitCheck.allowed) {
        logger.warn(`Rate limit exceeded for ${phone}: ${rateLimitCheck.reason}`);
        
        // Check if number was auto-blocked
        if (blockedNumbersService.isBlocked(phone)) {
          logger.info(`Number ${phone} was auto-blocked due to spam`);
          return; // Silently ignore
        }
        
        // Send rate limit message (only once to avoid spam)
        // We'll send a warning message, but not process the request
        await whatsappBot.sendMessage(phone, rateLimitCheck.reason || 'تم تجاوز الحد المسموح من الرسائل.');
        return;
      }

      // Check if there's already a message being processed for this phone
      // If so, wait for it to complete before processing the new message
      const existingPromise = this.processingQueue.get(phone);
      if (existingPromise) {
        logger.debug(`Message from ${phone} is queued - waiting for previous message to complete`);
        try {
          await existingPromise;
        } catch (error) {
          logger.error(`Error waiting for previous message from ${phone}:`, error);
        }
      }

      // Process message (one at a time per phone number)
      const processPromise = this.processMessage(phone, userMessage);
      this.processingQueue.set(phone, processPromise);

      try {
        await processPromise;
      } finally {
        // Remove from queue when done
        this.processingQueue.delete(phone);
      }
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  // Process a single message
  private async processMessage(phone: string, userMessage: string): Promise<void> {
    try {
      // Double-check block status (in case it was blocked while in queue)
      if (blockedNumbersService.isBlocked(phone)) {
        logger.warn(`Message from blocked number ${phone} - ignoring (checked during processing)`);
        return;
      }

      // Add user message to conversation
      conversationManager.addMessage(phone, 'user', userMessage);

      // Send typing indicator
      await whatsappBot.sendTypingIndicator(phone);

      // Get conversation history
      const conversationHistory = conversationManager.getFullConversationHistory(phone);
      
      // Get current order data from conversation
      const conversation = conversationManager.getConversationContext(phone);
      const currentOrderData = conversation?.orderData || null;

      // Generate response using Gemini
      try {
        const response = await geminiService.generateResponseWithFunctions(
          userMessage,
          conversationHistory,
          phone,
          currentOrderData
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
        
        // Send error message to user (only if not blocked)
        if (!blockedNumbersService.isBlocked(phone)) {
          const errorMessage = 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.';
          await whatsappBot.sendMessage(phone, errorMessage);
          conversationManager.addMessage(phone, 'assistant', errorMessage);
        }
      }
    } catch (error) {
      logger.error('Error processing message:', error);
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

