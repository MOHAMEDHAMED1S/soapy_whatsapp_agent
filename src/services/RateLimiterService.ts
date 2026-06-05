import { databaseManager } from '../database/Database';
import { logger } from '../utils/logger';
import { blockedNumbersService } from './BlockedNumbersService';

export interface RateLimitConfig {
  maxMessagesPerMinute: number;
  maxMessagesPerWindow: number;
  windowSizeMinutes: number;
  autoBlockThreshold: number; // Number of violations before auto-block
}

export class RateLimiterService {
  private db = databaseManager.getDatabase();

  // In-memory fallback rate limiter
  private inMemoryCounts: Map<string, { count: number; windowStart: number }> = new Map();
  private lastCleanup: number = Date.now();
  private readonly CLEANUP_INTERVAL_MS = 60000;

  // Default configuration
  private config: RateLimitConfig = {
    maxMessagesPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) || 20,
    maxMessagesPerWindow: Number(process.env.RATE_LIMIT_PER_WINDOW) || 100,
    windowSizeMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 5,
    autoBlockThreshold: 3, // Auto-block after 3 violations
  };

  // Check if a message should be allowed
  async checkRateLimit(phone: string): Promise<{ allowed: boolean; reason?: string }> {
    try {
      return await this.checkRateLimitDb(phone);
    } catch (error) {
      logger.error('Rate limit DB failed, using in-memory fallback:', error);
      this.periodicCleanup();
      return this.checkRateLimitMemory(phone);
    }
  }

  private periodicCleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;
    const threshold = now - 120000; // Keep only last 2 minutes
    for (const [phone, record] of this.inMemoryCounts.entries()) {
      if (record.windowStart < threshold) {
        this.inMemoryCounts.delete(phone);
      }
    }
  }

  private checkRateLimitMemory(phone: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const record = this.inMemoryCounts.get(phone);

    if (!record || (now - record.windowStart) > 60000) {
      this.inMemoryCounts.set(phone, { count: 1, windowStart: now });
      return { allowed: true };
    }

    record.count++;
    if (record.count > this.config.maxMessagesPerMinute) {
      logger.warn(`In-memory rate limit exceeded for ${phone}: ${record.count} msgs/min`);
      return {
        allowed: false,
        reason: 'تم تجاوز الحد المسموح من الرسائل. يرجى الانتظار.',
      };
    }

    return { allowed: true };
  }

  private async checkRateLimitDb(phone: string): Promise<{ allowed: boolean; reason?: string }> {
      const now = new Date();
      const windowStart = new Date(now.getTime() - this.config.windowSizeMinutes * 60 * 1000);

      // Get or create rate tracking record
      let tracking = this.db
        .prepare('SELECT * FROM message_rate_tracking WHERE phone = ?')
        .get(phone) as any;

      if (!tracking) {
        // Create new tracking record
        this.db
          .prepare(
            `INSERT INTO message_rate_tracking (phone, message_count, window_start, last_message_time) 
             VALUES (?, 1, ?, ?)`
          )
          .run(phone, now.toISOString(), now.toISOString());

        logger.debug(`Created rate tracking for phone: ${phone}`);
        return { allowed: true };
      }

      // Check if window has expired
      const windowStartDate = new Date(tracking.window_start);
      if (windowStartDate < windowStart) {
        // Reset window
        this.db
          .prepare(
            `UPDATE message_rate_tracking 
             SET message_count = 1, window_start = ?, last_message_time = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE phone = ?`
          )
          .run(now.toISOString(), now.toISOString(), phone);

        logger.debug(`Reset rate tracking window for phone: ${phone}`);
        return { allowed: true };
      }

      // Check messages in last minute
      const lastMessageTime = new Date(tracking.last_message_time);
      const timeSinceLastMessage = (now.getTime() - lastMessageTime.getTime()) / 1000; // seconds

      // If last message was less than a minute ago, check rate limit
      if (timeSinceLastMessage < 60) {
        // Count messages in the last minute (approximate)
        // Since we're tracking per message, we'll use a sliding window approach
        const messagesInLastMinute = tracking.message_count;

        if (messagesInLastMinute >= this.config.maxMessagesPerMinute) {
          logger.warn(`Rate limit exceeded for phone: ${phone} - ${messagesInLastMinute} messages in last minute`);

          // Check for spam pattern (very rapid messages)
          this.recordViolation(phone, timeSinceLastMessage, tracking.message_count);

          return {
            allowed: false,
            reason: `تم تجاوز الحد المسموح من الرسائل (${this.config.maxMessagesPerMinute} رسالة في الدقيقة). يرجى الانتظار قبل إرسال رسالة أخرى.`,
          };
        }
      }

      // Check messages in current window (5 minutes)
      if (tracking.message_count >= this.config.maxMessagesPerWindow) {
        logger.warn(`Rate limit exceeded for phone: ${phone} - ${tracking.message_count} messages in ${this.config.windowSizeMinutes} minute window`);

        // Check for spam pattern
        this.recordViolation(phone, timeSinceLastMessage, tracking.message_count);

        return {
          allowed: false,
          reason: `تم تجاوز الحد المسموح من الرسائل (${this.config.maxMessagesPerWindow} رسالة في ${this.config.windowSizeMinutes} دقائق). يرجى الانتظار قبل إرسال رسالة أخرى.`,
        };
      }

      // Update tracking
      this.db
        .prepare(
          `UPDATE message_rate_tracking 
           SET message_count = message_count + 1, last_message_time = ?, updated_at = CURRENT_TIMESTAMP 
           WHERE phone = ?`
        )
        .run(now.toISOString(), phone);

      logger.debug(`Rate limit check passed for phone: ${phone}, count: ${tracking.message_count + 1}`);
      return { allowed: true };
  }

  // Record a rate limit violation
  private recordViolation(phone: string, timeSinceLastMessage: number, messageCount: number): void {
    try {
      // If messages are coming too fast (less than 2 seconds apart) and we have many messages
      // This is a strong indicator of spam - auto-block immediately
      if (timeSinceLastMessage < 2 && messageCount >= this.config.maxMessagesPerMinute) {
        logger.warn(`Spam detected for phone: ${phone} - ${messageCount} messages in rapid succession (${timeSinceLastMessage.toFixed(2)}s apart) - blocking automatically`);
        blockedNumbersService.blockNumber(
          phone,
          `Spam detected: ${messageCount} messages sent rapidly (less than 2 seconds apart)`,
          'rate_limiter'
        );
        return;
      }

      // If messages are coming fast (less than 5 seconds apart) and rate limit is exceeded
      // This is also suspicious - but we'll give one more chance
      if (timeSinceLastMessage < 5 && messageCount >= this.config.maxMessagesPerMinute) {
        logger.warn(`Suspicious activity for phone: ${phone} - ${messageCount} messages sent quickly`);
        // Don't block yet, but log for monitoring
      }
    } catch (error) {
      logger.error('Error recording violation:', error);
    }
  }

  // Reset rate limit for a phone number
  resetRateLimit(phone: string): void {
    try {
      this.db.prepare('DELETE FROM message_rate_tracking WHERE phone = ?').run(phone);
      logger.info(`Reset rate limit for phone: ${phone}`);
    } catch (error) {
      logger.error('Error resetting rate limit:', error);
    }
  }

  // Get rate limit configuration
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  // Update rate limit configuration
  updateConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Rate limit configuration updated:', this.config);
  }
}

// Export singleton instance
export const rateLimiterService = new RateLimiterService();

