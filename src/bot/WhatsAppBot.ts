import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { logger } from '../utils/logger';
import { messageHandler } from './MessageHandler';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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
  private healthCheckInProgress: boolean = false;
  private readonly TYPING_REFRESH_INTERVAL = 15000;
  private readonly MAX_TYPING_DURATION_MS = 60000;
  private typingSessions: Map<string, { interval: NodeJS.Timeout; chatId: string; chat: any; startedAt: number }> = new Map();

  constructor() {
    // Client is created lazily in initialize() to avoid
    // creating a browser instance at module-import time,
    // which would race with cleanupStaleBrowser().
    this.client = null as unknown as Client;
  }

  private getPuppeteerOptions() {
    return {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=TranslateUI,site-per-process,AudioServiceOutOfProcess,IsolateOrigins',
        '--disable-ipc-flooding-protection',
        '--disable-gl-drawing-for-tests',
        '--mute-audio',
        '--no-default-browser-check',
        '--disable-sync',
        '--metrics-recording-only',
      ],
      timeout: 60000,
      ignoreHTTPSErrors: true,
    };
  }

  private createClient(): Client {
    return new Client({
      authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth',
      }),
      puppeteer: this.getPuppeteerOptions(),
      restartOnAuthFail: true,
    });
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

      // Debounce: ignore rapid duplicate disconnected events (e.g., post-auth navigation)
      const now = Date.now();
      if (now - this.lastDisconnectedTime < this.DISCONNECT_DEBOUNCE_MS) {
        logger.debug(`Ignoring disconnected event (debounced): ${reason}`);
        return;
      }
      this.lastDisconnectedTime = now;

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
        logger.debug(`Message from: ${msg.from}, type: ${typeof msg.from}`);

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

  // Remove SingletonLock and related lock files from the session directory
  private removeBrowserLockFiles(): void {
    const sessionDir = path.resolve('./.wwebjs_auth/session');
    const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

    for (const lockName of lockFiles) {
      const lockFile = path.join(sessionDir, lockName);
      try {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          logger.info(`Removed browser lock file: ${lockName}`);
        }
      } catch (err: any) {
        logger.warn(`Could not remove ${lockName}:`, err.message);
      }
    }
  }

  // Clean up stale browser locks and processes from previous crashes
  private async cleanupStaleBrowser(): Promise<void> {
    // Remove lock files first
    this.removeBrowserLockFiles();

    try {
      // Kill any orphaned chromium/chrome processes related to our session
      // This is safe because we haven't started our own browser yet
      execSync('pkill -f "chromium.*wwebjs_auth" || true', { stdio: 'ignore' });
      execSync('pkill -f "chrome.*wwebjs_auth" || true', { stdio: 'ignore' });
      execSync('pkill -f "Google Chrome.*wwebjs_auth" || true', { stdio: 'ignore' });
      execSync('pkill -f "Chromium.*wwebjs_auth" || true', { stdio: 'ignore' });
      logger.info('Cleaned up orphaned browser processes');
    } catch (err: any) {
      // pkill may fail on some systems or if no processes found - that's fine
      logger.debug('Browser process cleanup (non-critical):', err.message);
    }

    // Wait for processes to fully terminate and release file locks
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Remove lock files again in case the dying process recreated them
    this.removeBrowserLockFiles();
  }

  // Initialize the bot
  async initialize(): Promise<void> {
    let initAttempts = 0;
    const maxInitAttempts = 3;

    while (initAttempts < maxInitAttempts) {
      try {
        // Clean up any stale browser processes/locks from previous crashes
        await this.cleanupStaleBrowser();

        // Create the client *after* cleanup so the browser isn't started
        // while old lock files or processes are still around.
        this.client = this.createClient();
        this.setupEventHandlers();

        logger.info(`Initializing WhatsApp bot... (Attempt ${initAttempts + 1}/${maxInitAttempts})`);
        logger.info('Please wait while connecting to WhatsApp Web...');
        await this.client.initialize();

        // Start health check after successful initialization
        this.startHealthCheck();
        return; // Success, exit the retry loop
      } catch (error: any) {
        initAttempts++;
        if (error.name === 'TimeoutError') {
          logger.error('Timeout while initializing WhatsApp bot. This may happen if:');
          logger.error('1. No internet connection');
          logger.error('2. WhatsApp Web is blocked');
          logger.error('3. Firewall is blocking the connection');
        } else {
          logger.error(`Error initializing WhatsApp bot (Attempt ${initAttempts}):`, error.message || error);
        }

        // If we have reached the max attempts, throw the error
        if (initAttempts >= maxInitAttempts) {
          logger.error('Max initialization attempts reached. Failing...');
          throw error;
        }

        // Otherwise, destroy the client, wait, and try again
        try {
          if (this.client) {
            // Explicitly close browser process if it exists
            const clientAny = this.client as any;
            if (clientAny.pupBrowser) {
              const pages = await clientAny.pupBrowser.pages();
              await Promise.all(pages.map((page: any) => page.close()));
              await clientAny.pupBrowser.close();
            }
            await this.client.destroy();
          }
        } catch (destroyError: any) {
          logger.warn('Error destroying client during initialization retry:', destroyError.message);
        }
        
        logger.info('Waiting 3 seconds before retrying initialization...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  // Track last disconnected time to debounce rapid re-triggers
  private lastDisconnectedTime: number = 0;
  private readonly DISCONNECT_DEBOUNCE_MS = 10000; // ignore if fired within 10s of last

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
          await this.destroy(); // Use our robust destroy method
        } catch (destroyError) {
          logger.warn('Error destroying client during reconnect:', destroyError);
        }

        // Kill any orphaned browser processes before starting a new one
        await this.cleanupStaleBrowser();

        // Reinitialize
        this.client = this.createClient();

        this.setupEventHandlers();

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
        if (!this.isReady || this.isReconnecting || this.healthCheckInProgress) return;
        this.healthCheckInProgress = true;

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
      } finally {
        this.healthCheckInProgress = false;
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


  private async resolveChatId(phone: string, normalizedPhone: string): Promise<string | null> {
    if (phone.includes('@')) {
      try {
        await this.client.getChatById(phone);
        return phone;
      } catch (error) {
        logger.debug(`Provided chat ID ${phone} failed to retrieve chat`);
      }
    }

    const chatIdFormats = [
      `${normalizedPhone}@c.us`,
      `${normalizedPhone}@lid`,
    ];

    for (const format of chatIdFormats) {
      try {
        await this.client.getChatById(format);
        return format;
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  // Send typing indicator and keep it alive
  async sendTypingIndicator(phone: string): Promise<void> {
    try {
      if (!this.isReady) {
        logger.warn(`Cannot send typing indicator - WhatsApp client not ready`);
        return;
      }

      const normalizedPhone = phone.split('@')[0];
      const existingSession = this.typingSessions.get(normalizedPhone);
      if (existingSession) {
        try {
          await existingSession.chat.sendStateTyping();
          existingSession.startedAt = Date.now();
          return;
        } catch (error) {
          clearInterval(existingSession.interval);
          this.typingSessions.delete(normalizedPhone);
        }
      }

      const chatId = await this.resolveChatId(phone, normalizedPhone);
      if (!chatId) {
        logger.debug(`Could not find chat for ${normalizedPhone} - skipping typing indicator`);
        return;
      }

      const chat = await this.client.getChatById(chatId);
      await chat.sendStateTyping();
      const startedAt = Date.now();

      if (this.typingSessions.has(normalizedPhone)) {
        clearInterval(this.typingSessions.get(normalizedPhone)!.interval);
      }

      const interval = setInterval(async () => {
        const session = this.typingSessions.get(normalizedPhone);
        if (!session) return;
        if (!this.isReady || this.isReconnecting) return;
        if (Date.now() - session.startedAt > this.MAX_TYPING_DURATION_MS) {
          clearInterval(session.interval);
          this.typingSessions.delete(normalizedPhone);
          return;
        }
        try {
          await session.chat.sendStateTyping();
        } catch (error) {
          logger.error(`Error refreshing typing indicator for ${normalizedPhone}:`, error);
          clearInterval(session.interval);
          this.typingSessions.delete(normalizedPhone);
        }
      }, this.TYPING_REFRESH_INTERVAL);

      this.typingSessions.set(normalizedPhone, { interval, chatId, chat, startedAt });
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

      const session = this.typingSessions.get(normalizedPhone);
      if (session) {
        clearInterval(session.interval);
        this.typingSessions.delete(normalizedPhone);
        try {
          await session.chat.clearState();
          logger.debug(`Typing indicator cleared for ${normalizedPhone} using ${session.chatId}`);
          return;
        } catch (error) {
          logger.debug(`Failed to clear typing state for ${normalizedPhone} using cached chat`);
        }
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
          logger.debug(`Typing indicator cleared for ${normalizedPhone} using ${chatId}`);
          return; // Success, exit
        } catch (error) {
          // Try next format
          continue;
        }
      }

      // If all formats failed, it's okay - clearing state is optional
      logger.debug(`Could not clear typing state for ${normalizedPhone}`);
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
      this.typingSessions.forEach((session) => {
        clearInterval(session.interval);
      });
      this.typingSessions.clear();

      if (!this.client) {
        this.isReady = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        logger.info('WhatsApp bot destroyed (no client was active)');
        return;
      }

      // Explicitly close browser process if it exists (fix for zombie processes)
      try {
        const clientAny = this.client as any;
        if (clientAny.pupBrowser) {
          logger.info('Found active browser instance, forcing close...');
          const pages = await clientAny.pupBrowser.pages();
          await Promise.all(pages.map((page: any) => page.close()));
          await clientAny.pupBrowser.close();
          logger.info('Browser instance closed successfully');
        }
      } catch (browserError: any) {
        logger.warn('Error cleaning up browser instance:', browserError.message);
      }

      try {
        await this.client.destroy();
      } catch (clientDestroyError: any) {
        logger.warn('Error in client.destroy():', clientDestroyError.message);
      }

      // Remove lock files *after* the browser is closed so the next
      // startup doesn't see a stale lock from this session.
      this.removeBrowserLockFiles();

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
