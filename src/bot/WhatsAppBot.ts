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
        ],
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

  // Send message
  async sendMessage(phone: string, message: string): Promise<Message> {
    try {
      if (!this.isReady) {
        throw new Error('WhatsApp client is not ready');
      }

      const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
      const sentMessage = await this.client.sendMessage(chatId, message);
      logger.debug(`Message sent to ${phone}`);
      return sentMessage;
    } catch (error) {
      logger.error(`Error sending message to ${phone}:`, error);
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

