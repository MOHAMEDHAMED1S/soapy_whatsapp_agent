import { Message } from 'whatsapp-web.js';
import { logger } from '../utils/logger';
import { conversationManager } from './ConversationManager';
import { geminiService } from '../services/GeminiService';
import { blockedNumbersService } from '../services/BlockedNumbersService';
import { rateLimiterService } from '../services/RateLimiterService';
import { withTimeout } from '../utils/timeout';

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
  // Token system: every phone number has a token representing the current valid processing
  private processingTokens: Map<string, symbol> = new Map();
  private sendMessageHandler?: (phone: string, text: string, chatId?: string) => Promise<any>;
  private sendTypingIndicatorHandler?: (phone: string, chatId?: string) => Promise<any>;
  private clearTypingIndicatorHandler?: (phone: string, chatId?: string) => Promise<any>;

  setWhatsAppBotInterface(handlers: {
    sendMessage: (phone: string, text: string, chatId?: string) => Promise<any>;
    sendTypingIndicator: (phone: string, chatId?: string) => Promise<any>;
    clearTypingIndicator: (phone: string, chatId?: string) => Promise<any>;
  }) {
    this.sendMessageHandler = handlers.sendMessage;
    this.sendTypingIndicatorHandler = handlers.sendTypingIndicator;
    this.clearTypingIndicatorHandler = handlers.clearTypingIndicator;
  }
  private activeProcessingCount: number = 0;
  private readonly MAX_QUEUE_SIZE = 100; // DoS protection limit

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
        if (this.sendMessageHandler) {
          await this.sendMessageHandler(chatId, rateLimitCheck.reason || 'تم تجاوز الحد المسموح من الرسائل.', chatId);
        }
        return;
      }

      // DoS protection: max queue size
      if (this.processingQueue.size >= this.MAX_QUEUE_SIZE) {
        logger.warn(`Queue full (${this.MAX_QUEUE_SIZE}), message from ${phone} dropped`);
        return;
      }

      // Create unique token for this processing
      const currentToken = Symbol(phone);

      // Check if there's already a message being processed for this phone
      // If so, wait for it to complete before processing the new message
      const existingPromise = this.processingQueue.get(phone);
      if (existingPromise) {
        logger.debug(`Message from ${phone} is queued - waiting for previous message to complete`);
        try {
          await withTimeout(existingPromise, 30000, 'Waiting for previous message');
        } catch (error) {
          logger.error(`Error waiting for previous message from ${phone}:`, error);
        }
      }

      this.activeProcessingCount++;
      const processPromise = this.processMessage(phone, userMessage, chatId, msg)
        .finally(() => {
          // Check if this processing is still valid
          if (this.processingTokens.get(phone) === currentToken) {
            this.processingQueue.delete(phone);
            this.processingTokens.delete(phone);
            this.activeProcessingCount = Math.max(0, this.activeProcessingCount - 1);
          }
        });

      // Register token as "currently valid"
      this.processingTokens.set(phone, currentToken);
      this.processingQueue.set(phone, processPromise);

      // Timeout to prevent hanging forever (increased to 5 minutes to support up to 15 chained functions)
      const TIMEOUT_MS = 300000;
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT: Message processing for ${phone} exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      );

      try {
        await Promise.race([processPromise, timeoutPromise]);
      } catch (error: any) {
        // Invalidate token - this processing is no longer valid
        // If it completes later, finally block will see token is different and won't clean up
        if (this.processingTokens.get(phone) === currentToken) {
            this.processingTokens.delete(phone);
            this.processingQueue.delete(phone);
            this.activeProcessingCount = Math.max(0, this.activeProcessingCount - 1);
        }
        logger.error(`Timeout or error processing message from ${phone}:`, error);
      }
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  async waitForIdle(timeoutMs: number = 20000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.activeProcessingCount === 0 && this.processingQueue.size === 0) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return this.activeProcessingCount === 0 && this.processingQueue.size === 0;
  }

  getStatusSnapshot(): Record<string, unknown> {
    return {
      activeProcessingCount: this.activeProcessingCount,
      queuedConversationCount: this.processingQueue.size,
      maxQueueSize: this.MAX_QUEUE_SIZE,
      utilizationPercent: Math.round((this.processingQueue.size / this.MAX_QUEUE_SIZE) * 100),
      botInterfaceConfigured: Boolean(
        this.sendMessageHandler &&
        this.sendTypingIndicatorHandler &&
        this.clearTypingIndicatorHandler
      ),
    };
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
              if (this.sendMessageHandler) {
                await this.sendMessageHandler(replyTo, 'عذراً، حجم الملف كبير جداً. يرجى إرسال ملف أصغر (الحد الأقصى 10 ميجابايت).', chatId);
              }
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

      // 1. Send typing indicator
      if (this.sendTypingIndicatorHandler) {
        await this.sendTypingIndicatorHandler(replyTo, chatId);
      }

      // 2. Get conversation history before adding current message
      const conversationHistory = conversationManager.getFullConversationHistory(phone);

      // 3. Add user message to conversation
      conversationManager.addMessage(phone, 'user', messageForHistory || '[وسائط]');

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
        if (this.clearTypingIndicatorHandler) {
          await this.clearTypingIndicatorHandler(replyTo, chatId);
        }

        // Handle empty text response (MED-1)
        const replyText = response.text?.trim() || 'يبدو أنني واجهت مشكلة في صياغة الرد المناسب. هل يمكنك توضيح ما تحتاجه بالضبط لكي أساعدك بأفضل شكل؟';

        // Send response to user
        if (this.sendMessageHandler) {
          await this.sendMessageHandler(replyTo, replyText, chatId);
        }

        // Add assistant message to conversation
        conversationManager.addMessage(phone, 'assistant', replyText);

        // If function was called (like create_order), handle additional tasks
        // Note: The actual function execution is done in GeminiService
        // This is for additional handling like saving order data to database
        if (response.functionCall && response.functionCall.name === 'create_order') {
          await this.handleOrderCreated(response.functionCall, phone);
        }
      } catch (error: any) {
        logger.error('Error generating response:', error);

        // Clear typing indicator in case of error
        if (this.clearTypingIndicatorHandler) {
          await this.clearTypingIndicatorHandler(replyTo, chatId);
        }

        // Send error message to user (only if not blocked) - MED-2 separate try/catch
        if (!blockedNumbersService.isBlocked(phone)) {
          const errorMessage = 'أعتذر منك، واجهت مشكلة تقنية بسيطة أثناء معالجة طلبك للتو. هل يمكنك إعادة إرسال رسالتك وسأقوم بمساعدتك فوراً؟ شكراً لتفهمك.';
          try {
            if (this.sendMessageHandler) {
              await this.sendMessageHandler(replyTo, errorMessage, chatId);
            }
          } catch (sendError) {
            logger.error('Failed to send error message to user:', sendError);
          }
          try {
            conversationManager.addMessage(phone, 'assistant', errorMessage);
          } catch (addError) {
            logger.error('Failed to add error message to conversation:', addError);
          }
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
