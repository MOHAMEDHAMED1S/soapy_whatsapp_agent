import Database from 'better-sqlite3';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export class DatabaseManager {
  private db: Database.Database;

  constructor() {
    // Ensure data directory exists
    const dbPath = config.database.path;
    const dbDir = path.dirname(dbPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`Created database directory: ${dbDir}`);
    }

    // Initialize database
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    
    logger.info(`Database initialized: ${dbPath}`);
    this.initializeTables();
  }

  private initializeTables(): void {
    // Conversations table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        messages TEXT NOT NULL DEFAULT '[]',
        order_data TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Orders table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        phone TEXT NOT NULL,
        order_data TEXT NOT NULL,
        payment_url TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Blocked numbers table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL UNIQUE,
        reason TEXT,
        blocked_by TEXT DEFAULT 'system',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Message rate tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS message_rate_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        message_count INTEGER DEFAULT 1,
        window_start DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_message_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone);
      CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
      CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
      CREATE INDEX IF NOT EXISTS idx_blocked_numbers_phone ON blocked_numbers(phone);
      CREATE INDEX IF NOT EXISTS idx_message_rate_phone ON message_rate_tracking(phone);
      CREATE INDEX IF NOT EXISTS idx_message_rate_window ON message_rate_tracking(window_start);
    `);

    logger.info('Database tables initialized');
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }
}

// Export singleton instance
export const databaseManager = new DatabaseManager();

