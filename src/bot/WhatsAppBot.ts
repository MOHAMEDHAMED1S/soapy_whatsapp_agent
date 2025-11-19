import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { logger } from '../utils/logger';
import { messageHandler } from './MessageHandler';

export class WhatsAppBot {
  private client: Client;
  private isReady: boolean = false;

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth',
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
        ],
        timeout: 60000, // 60 seconds timeout for VPS
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // QR Code event
    this.client.on('qr', (qr) => {
      logger.info('QR Code received. Please scan with WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    // Ready event
    this.client.on('ready', () => {
      this.isReady = true;
      logger.info('WhatsApp client is ready!');
    });

    // Authenticated event
    this.client.on('authenticated', () => {
      logger.info('WhatsApp client authenticated');
    });

    // Authentication failure event
    this.client.on('auth_failure', (msg) => {
      logger.error('Authentication failure:', msg);
    });

    // Disconnected event
    this.client.on('disconnected', (reason) => {
      this.isReady = false;
      logger.warn('WhatsApp client disconnected:', reason);
    });

    // Message event
    this.client.on('message', async (msg: Message) => {
      try {
        // Ignore messages from groups
        const chat = await msg.getChat();
        if (chat.isGroup) {
          return;
        }

        // Ignore messages from status
        if (msg.from === 'status@broadcast') {
          return;
        }

        // Process message
        await messageHandler.handleMessage(msg);
      } catch (error) {
        logger.error('Error handling message:', error);
      }
    });

    // Message create event (for sent messages)
    this.client.on('message_create', async (msg: Message) => {
      // This event fires for all messages, including sent ones
      // We can use it for logging or other purposes
      if (msg.fromMe) {
        logger.debug(`Message sent to ${msg.to}: ${msg.body.substring(0, 50)}...`);
      }
    });
  }

  // Initialize the bot
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing WhatsApp bot...');
      logger.info('Please wait while connecting to WhatsApp Web...');
      await this.client.initialize();
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        logger.error('Timeout while initializing WhatsApp bot. This may happen if:');
        logger.error('1. No internet connection');
        logger.error('2. WhatsApp Web is blocked');
        logger.error('3. Firewall is blocking the connection');
        logger.error('Please check your connection and try again.');
      } else {
        logger.error('Error initializing WhatsApp bot:', error.message || error);
      }
      throw error;
    }
  }

  private typingIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Send typing indicator and keep it alive
  async sendTypingIndicator(phone: string): Promise<void> {
    try {
      if (!this.isReady) {
        logger.warn(`Cannot send typing indicator - WhatsApp client not ready`);
        return;
      }

      // Normalize phone number - remove any existing suffix and add @c.us
      const normalizedPhone = phone.split('@')[0];
      const chatId = `${normalizedPhone}@c.us`;
      
      try {
        const chat = await this.client.getChatById(chatId);
        
        // Send initial typing indicator
        await chat.sendStateTyping();
        logger.debug(`Typing indicator sent to ${normalizedPhone}`);

        // Clear any existing interval for this phone
        if (this.typingIntervals.has(normalizedPhone)) {
          clearInterval(this.typingIntervals.get(normalizedPhone)!);
        }

        // Keep typing indicator alive by refreshing it every 10 seconds
        // WhatsApp automatically clears typing indicator after ~15 seconds
        const interval = setInterval(async () => {
          try {
            if (this.isReady) {
              const currentChat = await this.client.getChatById(chatId);
              await currentChat.sendStateTyping();
              logger.debug(`Typing indicator refreshed for ${normalizedPhone}`);
            }
          } catch (error) {
            logger.error(`Error refreshing typing indicator for ${normalizedPhone}:`, error);
            // Clear interval on error
            if (this.typingIntervals.has(normalizedPhone)) {
              clearInterval(this.typingIntervals.get(normalizedPhone)!);
              this.typingIntervals.delete(normalizedPhone);
            }
          }
        }, 10000); // Refresh every 10 seconds

        this.typingIntervals.set(normalizedPhone, interval);
      } catch (chatError: any) {
        logger.error(`Error getting chat for ${normalizedPhone}:`, chatError);
        // Don't throw - typing indicator is optional
      }
    } catch (error) {
      logger.error(`Error sending typing indicator to ${phone}:`, error);
      // Don't throw error - typing indicator is optional
    }
  }

  // Clear typing indicator
  async clearTypingIndicator(phone: string): Promise<void> {
    try {
      if (!this.isReady) {
        return;
      }

      // Normalize phone number
      const normalizedPhone = phone.split('@')[0];

      // Clear the interval that keeps typing indicator alive
      if (this.typingIntervals.has(normalizedPhone)) {
        clearInterval(this.typingIntervals.get(normalizedPhone)!);
        this.typingIntervals.delete(normalizedPhone);
      }

      // Try to clear typing state (optional - WhatsApp clears it automatically)
      try {
        const chatId = `${normalizedPhone}@c.us`;
        const chat = await this.client.getChatById(chatId);
        await chat.clearState();
        logger.debug(`Typing indicator cleared for ${normalizedPhone}`);
      } catch (error) {
        // Ignore errors when clearing state - it's optional
        logger.debug(`Could not clear typing state for ${normalizedPhone} (this is normal)`);
      }
    } catch (error) {
      logger.error(`Error clearing typing indicator for ${phone}:`, error);
      // Don't throw error - clearing typing indicator is optional
    }
  }

  // Send message
  async sendMessage(phone: string, message: string): Promise<Message> {
    try {
      if (!this.isReady) {
        logger.error(`Cannot send message - WhatsApp client not ready`);
        throw new Error('WhatsApp client is not ready');
      }

      // Normalize phone number - remove any existing suffix and add @c.us
      const normalizedPhone = phone.split('@')[0];
      const chatId = `${normalizedPhone}@c.us`;
      
      try {
        const sentMessage = await this.client.sendMessage(chatId, message);
        logger.debug(`Message sent to ${normalizedPhone}`);
        return sentMessage;
      } catch (sendError: any) {
        logger.error(`Error sending message to ${normalizedPhone}:`, {
          error: sendError.message,
          stack: sendError.stack,
          chatId,
        });
        throw sendError;
      }
    } catch (error) {
      logger.error(`Error in sendMessage for ${phone}:`, error);
      throw error;
    }
  }

  // Check if bot is ready
  isBotReady(): boolean {
    return this.isReady;
  }

  // Get client instance
  getClient(): Client {
    return this.client;
  }

  // Destroy the bot
  async destroy(): Promise<void> {
    try {
      // Clear all typing intervals
      this.typingIntervals.forEach((interval, phone) => {
        clearInterval(interval);
        this.clearTypingIndicator(phone).catch(() => {
          // Ignore errors when clearing typing indicators during destroy
        });
      });
      this.typingIntervals.clear();

      await this.client.destroy();
      this.isReady = false;
      logger.info('WhatsApp bot destroyed');
    } catch (error) {
      logger.error('Error destroying WhatsApp bot:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const whatsappBot = new WhatsAppBot();

