import { databaseManager } from '../database/Database';
import { logger } from '../utils/logger';

export interface BlockedNumber {
  id: number;
  phone: string;
  reason: string | null;
  blocked_by: string;
  created_at: Date;
  updated_at: Date;
}

export class BlockedNumbersService {
  private db = databaseManager.getDatabase();

  // Check if a phone number is blocked
  isBlocked(phone: string): boolean {
    try {
      const row = this.db
        .prepare('SELECT id FROM blocked_numbers WHERE phone = ?')
        .get(phone) as { id: number } | undefined;
      
      return row !== undefined;
    } catch (error) {
      logger.error('Error checking if number is blocked:', error);
      return false;
    }
  }

  // Get blocked number details
  getBlockedNumber(phone: string): BlockedNumber | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM blocked_numbers WHERE phone = ?')
        .get(phone) as BlockedNumber | undefined;
      
      if (!row) {
        return null;
      }

      return {
        ...row,
        created_at: new Date(row.created_at as any),
        updated_at: new Date(row.updated_at as any),
      };
    } catch (error) {
      logger.error('Error getting blocked number:', error);
      return null;
    }
  }

  // Block a phone number
  blockNumber(phone: string, reason?: string, blockedBy: string = 'system'): void {
    try {
      const existing = this.db
        .prepare('SELECT id FROM blocked_numbers WHERE phone = ?')
        .get(phone) as { id: number } | undefined;

      if (existing) {
        // Update existing block
        this.db
          .prepare(
            `UPDATE blocked_numbers 
             SET reason = ?, blocked_by = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE phone = ?`
          )
          .run(reason || null, blockedBy, phone);
        logger.info(`Updated block for phone: ${phone}, reason: ${reason || 'No reason'}`);
      } else {
        // Insert new block
        this.db
          .prepare(
            `INSERT INTO blocked_numbers (phone, reason, blocked_by) 
             VALUES (?, ?, ?)`
          )
          .run(phone, reason || null, blockedBy);
        logger.info(`Blocked phone: ${phone}, reason: ${reason || 'No reason'}, by: ${blockedBy}`);
      }
    } catch (error) {
      logger.error('Error blocking number:', error);
      throw error;
    }
  }

  // Unblock a phone number
  unblockNumber(phone: string): void {
    try {
      const result = this.db.prepare('DELETE FROM blocked_numbers WHERE phone = ?').run(phone);
      
      if (result.changes > 0) {
        logger.info(`Unblocked phone: ${phone}`);
      } else {
        logger.warn(`Phone ${phone} was not blocked`);
      }
    } catch (error) {
      logger.error('Error unblocking number:', error);
      throw error;
    }
  }

  // Get all blocked numbers
  getAllBlockedNumbers(): BlockedNumber[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM blocked_numbers ORDER BY created_at DESC')
        .all() as BlockedNumber[];
      
      return rows.map(row => ({
        ...row,
        created_at: new Date(row.created_at as any),
        updated_at: new Date(row.updated_at as any),
      }));
    } catch (error) {
      logger.error('Error getting all blocked numbers:', error);
      return [];
    }
  }
}

// Export singleton instance
export const blockedNumbersService = new BlockedNumbersService();

