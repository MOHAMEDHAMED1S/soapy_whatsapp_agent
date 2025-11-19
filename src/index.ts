import { config } from './config/config';
import { logger } from './utils/logger';
import { databaseManager } from './database/Database';
import { productService } from './services/ProductService';
import { geminiService } from './services/GeminiService';
import { whatsappBot } from './bot/WhatsAppBot';

// Graceful shutdown handler
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
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
  } catch (error) {
    logger.error('Error starting WhatsApp Agent:', error);
    process.exit(1);
  }
};

// Start the application
main();

