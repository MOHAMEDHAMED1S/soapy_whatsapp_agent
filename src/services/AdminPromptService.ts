import { databaseManager } from '../database/Database';
import { logger } from '../utils/logger';

export interface AdminPrompt {
  id?: number;
  prompt_text: string;
  added_by: string;
  created_at: Date;
  updated_at: Date;
}

export class AdminPromptService {
  private db = databaseManager.getDatabase();

  // Get current admin prompt
  getAdminPrompt(): string {
    try {
      const row = this.db
        .prepare('SELECT prompt_text FROM admin_prompts ORDER BY updated_at DESC LIMIT 1')
        .get() as { prompt_text: string } | undefined;

      if (row && row.prompt_text) {
        return row.prompt_text;
      }

      return ''; // Return empty string if no prompt exists
    } catch (error) {
      logger.error('Error getting admin prompt:', error);
      return '';
    }
  }

  // Add or update admin prompt
  addAdminPrompt(promptText: string, addedBy: string): void {
    try {
      // Check if prompt exists
      const existing = this.db
        .prepare('SELECT id FROM admin_prompts ORDER BY updated_at DESC LIMIT 1')
        .get() as { id: number } | undefined;

      if (existing) {
        // Update existing prompt
        this.db
          .prepare(
            `UPDATE admin_prompts 
             SET prompt_text = ?, added_by = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`
          )
          .run(promptText, addedBy, existing.id);
        logger.info(`Updated admin prompt by ${addedBy}`);
      } else {
        // Insert new prompt
        this.db
          .prepare(
            `INSERT INTO admin_prompts (prompt_text, added_by) 
             VALUES (?, ?)`
          )
          .run(promptText, addedBy);
        logger.info(`Added new admin prompt by ${addedBy}`);
      }
    } catch (error) {
      logger.error('Error adding admin prompt:', error);
      throw error;
    }
  }

  // Append to existing admin prompt
  appendToAdminPrompt(additionalText: string, addedBy: string): void {
    try {
      const currentPrompt = this.getAdminPrompt();
      const newPrompt = currentPrompt 
        ? `${currentPrompt}\n\n${additionalText}`
        : additionalText;
      
      this.addAdminPrompt(newPrompt, addedBy);
      logger.info(`Appended to admin prompt by ${addedBy}`);
    } catch (error) {
      logger.error('Error appending to admin prompt:', error);
      throw error;
    }
  }

  // Clear admin prompt
  clearAdminPrompt(): void {
    try {
      this.db.prepare('DELETE FROM admin_prompts').run();
      logger.info('Cleared admin prompt');
    } catch (error) {
      logger.error('Error clearing admin prompt:', error);
      throw error;
    }
  }

  // Get admin prompt with metadata
  getAdminPromptWithMetadata(): AdminPrompt | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM admin_prompts ORDER BY updated_at DESC LIMIT 1')
        .get() as AdminPrompt | undefined;

      if (row) {
        return {
          ...row,
          created_at: new Date(row.created_at),
          updated_at: new Date(row.updated_at),
        };
      }

      return null;
    } catch (error) {
      logger.error('Error getting admin prompt with metadata:', error);
      return null;
    }
  }
}

// Export singleton instance
export const adminPromptService = new AdminPromptService();



