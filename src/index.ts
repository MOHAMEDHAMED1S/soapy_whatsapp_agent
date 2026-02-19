import { config } from './config/config';
import { logger } from './utils/logger';
import { databaseManager } from './database/Database';
import { productService } from './services/ProductService';
import { geminiService } from './services/GeminiService';
import { whatsappBot } from './bot/WhatsAppBot';
import { messageHandler } from './bot/MessageHandler';
import { spawn } from 'child_process';

let restartTimer: NodeJS.Timeout | null = null;
let isRestarting = false;

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    if (restartTimer) {
      clearInterval(restartTimer);
      restartTimer = null;
    }
    // Stop automatic product catalog updates
    geminiService.stopAutoUpdate();
    
    await whatsappBot.destroy();
    databaseManager.close();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
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
    databaseManager.close();
  } catch (error) {
    logger.error('Error during restart cleanup:', error);
  }

  try {
    const child = spawn(process.argv[0], process.argv.slice(1), {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', (error) => {
      logger.error('Failed to spawn restart process:', error);
      process.exit(1);
    });
    child.on('spawn', () => {
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to restart process:', error);
    process.exit(1);
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
  logger.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Main function
const main = async () => {
  try {
    logger.info('Starting WhatsApp Agent...');
    logger.info(`API Base URL: ${config.api.baseUrl}`);
    logger.info(`Database Path: ${config.database.path}`);

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

    // Initialize WhatsApp bot (this is blocking and required)
    logger.info('Initializing WhatsApp bot...');
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
