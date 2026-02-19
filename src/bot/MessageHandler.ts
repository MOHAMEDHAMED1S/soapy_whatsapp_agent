import { Message } from 'whatsapp-web.js';
import { logger } from '../utils/logger';
import { conversationManager } from './ConversationManager';
import { geminiService } from '../services/GeminiService';
import { whatsappBot } from './WhatsAppBot';
import { blockedNumbersService } from '../services/BlockedNumbersService';
import { rateLimiterService } from '../services/RateLimiterService';

// Media data interface for passing downloaded media to Gemini
export interface MediaData {
  data: string;      // base64-encoded media content
  mimeType: string;  // e.g. 'image/jpeg', 'audio/ogg'
}

// Supported media types for Gemini multimodal
const SUPPORTED_MEDIA_TYPES = new Set(['image', 'ptt', 'audio', 'video', 'sticker']);
const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit

export class MessageHandler {
  // Queue for processing messages (one at a time per phone number)
  private processingQueue: Map<string, Promise<void>> = new Map();

  // Extract phone number from WhatsApp message
  private extractPhoneNumber(from: string): string {
    // WhatsApp format: 965XXXXXXXXX@c.us or 271892921467012@lid
    // Remove all suffixes (@c.us, @lid, @g.us, etc.)
    return from.split('@')[0];
  }

  // Handle incoming message
  async handleMessage(msg: Message): Promise<void> {
    try {
      const phone = this.extractPhoneNumber(msg.from);
      const chatId = msg.from; // Keep original chat ID for replying
      const userMessage = msg.body?.trim() || '';
      const hasMedia = msg.hasMedia && SUPPORTED_MEDIA_TYPES.has(msg.type);

      logger.info(`Message from ${phone}: ${userMessage.substring(0, 50)}${hasMedia ? ` [media: ${msg.type}]` : ''}`);

      // Ignore empty messages without media
      if (!userMessage && !hasMedia) {
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

        // Send rate limit message using original chatId for direct @lid targeting
        await whatsappBot.sendMessage(chatId, rateLimitCheck.reason || 'تم تجاوز الحد المسموح من الرسائل.');
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
      const processPromise = this.processMessage(phone, userMessage, chatId, msg);
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
  private async processMessage(phone: string, userMessage: string, chatId?: string, msg?: Message): Promise<void> {
    // Default to phone if chatId not provided (backward compatibility)
    const replyTo = chatId || phone;
    try {
      // Double-check block status (in case it was blocked while in queue)
      if (blockedNumbersService.isBlocked(phone)) {
        logger.warn(`Message from blocked number ${phone} - ignoring (checked during processing)`);
        return;
      }

      // Try to download media if present
      let mediaData: MediaData | null = null;
      if (msg?.hasMedia && SUPPORTED_MEDIA_TYPES.has(msg.type)) {
        try {
          logger.info(`Downloading media from ${phone} (type: ${msg.type})...`);
          const media = await msg.downloadMedia();

          if (media && media.data) {
            // Check size limit (base64 is ~1.37x the original size)
            const estimatedSize = Math.ceil(media.data.length * 0.75);
            if (estimatedSize > MAX_MEDIA_SIZE_BYTES) {
              logger.warn(`Media from ${phone} too large (${(estimatedSize / 1024 / 1024).toFixed(1)}MB), skipping`);
              await whatsappBot.sendMessage(replyTo, 'عذراً، حجم الملف كبير جداً. يرجى إرسال ملف أصغر (الحد الأقصى 10 ميجابايت).');
              return;
            }

            mediaData = {
              data: media.data,
              mimeType: media.mimetype,
            };
            logger.info(`Media downloaded from ${phone}: ${media.mimetype} (${(estimatedSize / 1024).toFixed(0)}KB)`);
          } else {
            logger.warn(`Failed to download media from ${phone} - empty result`);
          }
        } catch (mediaError: any) {
          logger.error(`Error downloading media from ${phone}:`, mediaError?.message || mediaError);
          // Continue without media - treat as text-only message
        }
      }

      // Build the user message text for conversation history
      const messageForHistory = mediaData
        ? (userMessage ? `[وسائط: ${msg?.type}] ${userMessage}` : `[وسائط: ${msg?.type}]`)
        : userMessage;

      // Add user message to conversation
      conversationManager.addMessage(phone, 'user', messageForHistory || '[وسائط]');

      // Send typing indicator
      await whatsappBot.sendTypingIndicator(replyTo);

      // Get conversation history
      const conversationHistory = conversationManager.getFullConversationHistory(phone);

      // Get current order data from conversation
      const conversation = conversationManager.getConversationContext(phone);
      const currentOrderData = conversation?.orderData || null;

      // Generate response using Gemini
      try {
        let response;

        if (mediaData) {
          // Use multimodal generation with media
          response = await geminiService.generateResponseWithMedia(
            userMessage,
            mediaData,
            conversationHistory,
            phone,
            currentOrderData
          );
        } else {
          // Use standard text generation
          response = await geminiService.generateResponseWithFunctions(
            userMessage,
            conversationHistory,
            phone,
            currentOrderData
          );
        }

        // Clear typing indicator before sending message
        await whatsappBot.clearTypingIndicator(replyTo);

        // Send response to user
        await whatsappBot.sendMessage(replyTo, response.text);

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
        await whatsappBot.clearTypingIndicator(replyTo);

        // Send error message to user (only if not blocked)
        if (!blockedNumbersService.isBlocked(phone)) {
          const errorMessage = 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.';
          await whatsappBot.sendMessage(replyTo, errorMessage);
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

