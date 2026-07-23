import { config } from './config/config';
import { logger } from './utils/logger';
import { databaseManager } from './database/Database';
import { productService } from './services/ProductService';
import { geminiService } from './services/GeminiService';
import { whatsappBot } from './bot/WhatsAppBot';
import { messageHandler } from './bot/MessageHandler';
import { statusApiService } from './services/StatusApiService';

let restartTimer: NodeJS.Timeout | null = null;
let isRestarting = false;

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  let exitCode = 0;
  
  try {
    if (restartTimer) {
      clearInterval(restartTimer);
      restartTimer = null;
    }
    // Stop automatic product catalog updates
    geminiService.stopAutoUpdate();
    
    await whatsappBot.destroy();
    logger.info('WhatsApp bot destroyed');
    await statusApiService.stop();
  } catch (error) {
    logger.error('Error during shutdown:', error);
    exitCode = 1;
  } finally {
    try {
      databaseManager.close();
      logger.info('Database closed');
    } catch (dbError) {
      logger.error('Error closing database:', dbError);
      exitCode = 1;
    }
    process.exit(exitCode);
  }
};

const restartProcess = async (reason: string) => {
  if (isRestarting) {
    return;
  }
  isRestarting = true;
  if (restartTimer) {
    clearInterval(restartTimer);
    restartTimer = null;
  }
  logger.info(`Restarting process (${reason})...`);
  let exitCode = 0;
  try {
    const drainTimeoutRaw = process.env.RESTART_DRAIN_TIMEOUT_MS || '20000';
    const drainTimeoutMs = Number(drainTimeoutRaw);
    if (Number.isFinite(drainTimeoutMs) && drainTimeoutMs > 0) {
      const drained = await messageHandler.waitForIdle(drainTimeoutMs);
      if (!drained) {
        logger.warn('Restart drain timeout reached, continuing with shutdown');
      }
    }
    geminiService.stopAutoUpdate();
    await whatsappBot.destroy();
    await statusApiService.stop();
  } catch (error) {
    logger.error('Error during restart cleanup:', error);
    exitCode = 1;
  } finally {
    try {
      databaseManager.close();
    } catch (dbError) {
      logger.error('Error closing database during restart:', dbError);
      exitCode = 1;
    }

    // Brief delay to ensure all OS-level file handles are released
    // before PM2 starts a new instance.
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.exit(exitCode);
  }
};

const scheduleAutoRestart = () => {
  const intervalMinutesRaw = process.env.AUTO_RESTART_INTERVAL_MINUTES || '30';
  const intervalMinutes = Number(intervalMinutesRaw);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return;
  }
  const intervalMs = intervalMinutes * 60 * 1000;
  restartTimer = setInterval(() => {
    restartProcess('scheduled');
  }, intervalMs);
  logger.info(`Auto-restart scheduled every ${intervalMinutes} minutes`);
};

// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  try {
    process.stderr.write(`UNCAUGHT EXCEPTION: ${error.stack || error}\n`);
  } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  try {
    process.stderr.write(`UNHANDLED REJECTION: ${reason}\n`);
  } catch {}
  process.exit(1);
});

// Main function
const main = async () => {
  try {
    logger.info('Starting WhatsApp Agent...');
    logger.info(`API Base URL: ${config.api.baseUrl}`);
    logger.info(`Database Path: ${config.database.path}`);

    statusApiService.setComponentStatusProvider(() => ({
      database: databaseManager.getStatusSnapshot(),
      whatsappRuntime: whatsappBot.getStatusSnapshot(),
      messageProcessing: messageHandler.getStatusSnapshot(),
      productCatalog: productService.getStatusSnapshot(),
      gemini: geminiService.getStatusSnapshot(),
    }));
    const statusApiPort = Number(process.env.STATUS_API_PORT || '3002');
    await statusApiService.start(statusApiPort);

    // Initialize database
    logger.info('Initializing database...');
    // Database is already initialized in DatabaseManager constructor

    // Initialize product service (non-blocking)
    logger.info('Initializing product service...');
    productService.initialize().catch((error) => {
      logger.warn('Product service initialization failed, continuing anyway:', error.message);
    });

    // Update product catalog in Gemini service (non-blocking)
    logger.info('Updating product catalog in Gemini service...');
    await geminiService.updateProductCatalog().catch((error) => {
      logger.warn('Failed to update product catalog, continuing anyway:', error.message);
    });

    // Start automatic product catalog updates every 30 minutes
    logger.info('Starting automatic product catalog updates (every 30 minutes)...');
    geminiService.startAutoUpdate();

    // MED-5: Dependency Injection to resolve circular dependency
    whatsappBot.setMessageHandler((msg) => messageHandler.handleMessage(msg));
    messageHandler.setWhatsAppBotInterface({
      sendMessage: (phone, text, chatId) => whatsappBot.sendMessage(phone, text, 0, chatId),
      sendTypingIndicator: (phone, chatId) => whatsappBot.sendTypingIndicator(phone, chatId),
      clearTypingIndicator: (phone, chatId) => whatsappBot.clearTypingIndicator(phone, chatId),
    });

    // Initialize WhatsApp bot (this is blocking and required)
    await whatsappBot.initialize();

    logger.info('WhatsApp Agent is ready!');
    logger.info('Waiting for messages...');
    scheduleAutoRestart();
  } catch (error) {
    logger.error('Error starting WhatsApp Agent:', error);
    process.exit(1);
  }
};

// Start the application
main();
