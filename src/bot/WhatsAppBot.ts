import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { logger } from '../utils/logger';
import { messageHandler } from './MessageHandler';

export class WhatsAppBot {
  private client: Client;
  private isReady: boolean = false;

  // Reconnection properties
  private isReconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_BASE_DELAY = 5000; // 5 seconds
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute

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
        ignoreHTTPSErrors: true,
      },
      restartOnAuthFail: true,
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

    // Disconnected event - trigger auto-reconnect
    this.client.on('disconnected', async (reason) => {
      this.isReady = false;
      logger.warn('WhatsApp client disconnected:', reason);

      // Stop health check during reconnection
      this.stopHealthCheck();

      // Trigger auto-reconnect
      await this.reconnect();
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

        // Log message source for debugging
        logger.info(`Message from: ${msg.from}, type: ${typeof msg.from}`);

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
        logger.info(`Message sent to ${msg.to}: ${msg.body.substring(0, 50)}...`);
      }
    });
  }

  // Initialize the bot
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing WhatsApp bot...');
      logger.info('Please wait while connecting to WhatsApp Web...');
      await this.client.initialize();

      // Start health check after successful initialization
      this.startHealthCheck();
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

  // Auto-reconnect with exponential backoff
  private async reconnect(): Promise<void> {
    if (this.isReconnecting) {
      logger.info('Already attempting to reconnect...');
      return;
    }

    this.isReconnecting = true;
    this.isReady = false;

    while (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      try {
        const delay = this.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts);
        logger.info(`Attempting to reconnect in ${delay / 1000}s... (attempt ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);

        await new Promise(resolve => setTimeout(resolve, delay));

        // Destroy old client and create new one
        try {
          await this.client.destroy();
        } catch (destroyError) {
          logger.warn('Error destroying client during reconnect:', destroyError);
        }

        // Reinitialize
        await this.client.initialize();

        // Success!
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.startHealthCheck();
        logger.info('Successfully reconnected to WhatsApp!');
        return;
      } catch (error: any) {
        this.reconnectAttempts++;
        logger.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error.message || error);
      }
    }

    // All attempts failed
    logger.error(`Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Please restart the bot manually.`);
    this.isReconnecting = false;
  }

  // Start periodic health check
  private startHealthCheck(): void {
    this.stopHealthCheck(); // Clear any existing interval

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (!this.isReady || this.isReconnecting) return;

        // Try to get state - if this fails, client may be disconnected
        const state = await this.client.getState();
        if (!state) {
          logger.warn('Health check: No state returned, client may be disconnected');
          await this.reconnect();
        }
      } catch (error: any) {
        logger.error('Health check failed:', error.message);

        // Check if it's a critical puppeteer error
        if (this.isCriticalPuppeteerError(error)) {
          logger.warn('Critical Puppeteer error detected, triggering reconnection...');
          await this.reconnect();
        }
      }
    }, this.HEALTH_CHECK_INTERVAL);

    logger.info('Health check started');
  }

  // Stop health check
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Health check stopped');
    }
  }

  // Check if error is a critical Puppeteer/DOM error
  private isCriticalPuppeteerError(error: any): boolean {
    const errorMessage = error?.message || error?.toString() || '';
    const msg = errorMessage.toLowerCase();

    return msg.includes('detached frame') ||
      msg.includes('markedunread') ||
      msg.includes('execution context was destroyed') ||
      msg.includes('target closed') ||
      msg.includes('session closed') ||
      msg.includes('protocol error') ||
      msg.includes('browser has been closed') ||
      msg.includes('navigation failed') ||
      msg.includes('evaluation failed') ||
      msg.includes('page crashed') ||
      msg.includes('context mismatch');
  }


  private typingIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Send typing indicator and keep it alive
  async sendTypingIndicator(phone: string): Promise<void> {
    try {
      if (!this.isReady) {
        logger.warn(`Cannot send typing indicator - WhatsApp client not ready`);
        return;
      }

      let chatId: string | null = null;
      const normalizedPhone = phone.split('@')[0];

      if (phone.includes('@')) {
        // If phone contains @, assume it's a full chat ID and try it first
        try {
          // Check if chat exists
          // Note: getChatById usually expects a serialized ID. If it's passed directly, it should work.
          await this.client.getChatById(phone);
          chatId = phone;
        } catch (error) {
          logger.warn(`Provided chat ID ${phone} failed to retrieve chat, falling back to heuristics`);
          // Fallback to heuristics below if specific ID fails
        }
      }

      if (!chatId) {
        // Try multiple chat ID formats approach
        const chatIdFormats = [
          `${normalizedPhone}@c.us`,  // Standard format
          `${normalizedPhone}@lid`,   // LID format (for business accounts)
        ];

        // Find working chat ID format
        for (const format of chatIdFormats) {
          try {
            await this.client.getChatById(format);
            chatId = format;
            break; // Found working format
          } catch (error) {
            // Try next format
            continue;
          }
        }
      }

      if (!chatId) {
        logger.info(`Could not find chat for ${normalizedPhone} - skipping typing indicator`);
        return; // Don't throw - typing indicator is optional
      }

      try {
        const chat = await this.client.getChatById(chatId);

        // Send initial typing indicator
        await chat.sendStateTyping();
        logger.info(`Typing indicator sent to ${normalizedPhone} using ${chatId}`);

        // Clear any existing interval for this phone
        if (this.typingIntervals.has(normalizedPhone)) {
          clearInterval(this.typingIntervals.get(normalizedPhone)!);
        }

        // Keep typing indicator alive by refreshing it every 10 seconds
        // WhatsApp automatically clears typing indicator after ~15 seconds
        const interval = setInterval(async () => {
          try {
            if (this.isReady && chatId) {
              const currentChat = await this.client.getChatById(chatId);
              await currentChat.sendStateTyping();
              logger.info(`Typing indicator refreshed for ${normalizedPhone}`);
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

        // Check if it's a critical puppeteer error and trigger reconnect if needed
        if (this.isCriticalPuppeteerError(chatError)) {
          logger.warn('Critical Puppeteer error detected in sendTypingIndicator, triggering reconnection...');
          this.reconnect().catch(e => logger.error('Reconnection failed:', e));
        }
        // Don't throw - typing indicator is optional
      }
      // Try to clear typing state (optional - WhatsApp clears it automatically)
    } catch (error) {
      // Ignore all errors in typing indicator to prevent blocking the flow
      logger.warn(`Failed to send typing indicator to ${phone} (ignored):`, error);
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
      // Try multiple formats
      const chatIdFormats = [
        `${normalizedPhone}@c.us`,
        `${normalizedPhone}@lid`,
      ];

      for (const chatId of chatIdFormats) {
        try {
          const chat = await this.client.getChatById(chatId);
          await chat.clearState();
          logger.info(`Typing indicator cleared for ${normalizedPhone} using ${chatId}`);
          return; // Success, exit
        } catch (error) {
          // Try next format
          continue;
        }
      }

      // If all formats failed, it's okay - clearing state is optional
      logger.info(`Could not clear typing state for ${normalizedPhone} (this is normal)`);
    } catch (error) {
      logger.error(`Error clearing typing indicator for ${phone}:`, error);
      // Don't throw error - clearing typing indicator is optional
    }
  }

  // Send message with retry logic
  async sendMessage(phone: string, message: string, retryCount: number = 0): Promise<Message> {
    const MAX_RETRIES = 2;

    try {
      if (!this.isReady) {
        // If not ready but reconnecting, wait a bit
        if (this.isReconnecting && retryCount < MAX_RETRIES) {
          logger.info(`Client not ready, waiting for reconnection... (attempt ${retryCount + 1})`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          return this.sendMessage(phone, message, retryCount + 1);
        }
        logger.error(`Cannot send message - WhatsApp client not ready`);
        throw new Error('WhatsApp client is not ready');
      }

      const normalizedPhone = phone.split('@')[0];

      // Determine which formats to try
      let chatIdFormats: string[] = [];

      if (phone.includes('@')) {
        // If phone contains @, assume it's a full chat ID and try it first
        chatIdFormats.push(phone);

        // Also add the other formats as fallback, in case the provided ID was wrong or changed
        // But avoid adding duplicates
        if (!phone.endsWith('@c.us')) chatIdFormats.push(`${normalizedPhone}@c.us`);
        if (!phone.endsWith('@lid')) chatIdFormats.push(`${normalizedPhone}@lid`);
      } else {
        // If no suffix, try standard formats
        chatIdFormats = [
          `${normalizedPhone}@c.us`,  // Standard format
          `${normalizedPhone}@lid`,    // LID format (for business accounts)
        ];
      }

      let lastError: any = null;

      for (const chatId of chatIdFormats) {
        try {
          // First, try to get the chat to check if it exists
          await this.client.getChatById(chatId);

          // If chat exists, try to send message
          const sentMessage = await this.client.sendMessage(chatId, message);
          logger.info(`Message sent to ${normalizedPhone} using ${chatId}`);
          return sentMessage;
        } catch (error: any) {
          // Check if it's a critical puppeteer error
          if (this.isCriticalPuppeteerError(error)) {
            logger.warn(`Critical Puppeteer error detected while sending message, attempting reconnection...`);

            // Trigger reconnection
            this.reconnect().catch(e => logger.error('Reconnection failed:', e));

            // If we have retries left, wait and retry
            if (retryCount < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, 10000));
              return this.sendMessage(phone, message, retryCount + 1);
            }

            throw new Error('Message failed due to connection issues. Please try again.');
          }

          // Check if error is "No LID for user" - try next format
          if (error.message && error.message.includes('No LID for user')) {
            logger.info(`No LID for ${normalizedPhone}, trying next format...`);
            lastError = error;
            continue; // Try next format
          }

          // If it's a different error, log and try next format
          if (chatIdFormats.indexOf(chatId) < chatIdFormats.length - 1) {
            logger.info(`Error with ${chatId}, trying next format:`, error.message);
            lastError = error;
            continue;
          }

          // Last format failed, throw error
          logger.error(`Error sending message to ${normalizedPhone} with ${chatId}:`, {
            error: error.message,
            stack: error.stack,
            chatId,
          });
          throw error;
        }
      }

      // All formats failed
      logger.error(`Failed to send message to ${normalizedPhone} with all formats`);
      throw lastError || new Error(`Failed to send message to ${normalizedPhone}`);
    } catch (error: any) {
      logger.error(`Error in sendMessage for ${phone}:`, { message: error?.message, stack: error?.stack, error });
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
      // Stop health check
      this.stopHealthCheck();

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
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      logger.info('WhatsApp bot destroyed');
    } catch (error) {
      logger.error('Error destroying WhatsApp bot:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const whatsappBot = new WhatsAppBot();

