import { config } from '../config/config';
import { logger } from '../utils/logger';

export class AdminService {
  // Check if a phone number is an admin
  isAdmin(phone: string): boolean {
    try {
      // Normalize phone number (remove any prefixes like + or country codes)
      const normalizedPhone = this.normalizePhone(phone);
      
      // Check if phone is in admin list
      const isAdmin = config.admin.phones.some(adminPhone => {
        const normalizedAdminPhone = this.normalizePhone(adminPhone);
        return normalizedPhone === normalizedAdminPhone;
      });

      if (isAdmin) {
        logger.debug(`Phone ${phone} is recognized as admin`);
      }

      return isAdmin;
    } catch (error) {
      logger.error('Error checking admin status:', error);
      return false;
    }
  }

  // Normalize phone number for comparison
  private normalizePhone(phone: string): string {
    // Remove common prefixes and whitespace
    return phone
      .replace(/^\+/, '') // Remove leading +
      .replace(/^00/, '') // Remove leading 00
      .replace(/\s/g, '') // Remove whitespace
      .trim();
  }

  // Get all admin phone numbers
  getAdminPhones(): string[] {
    return [...config.admin.phones];
  }

  // Check if admin phones are configured
  hasAdminPhones(): boolean {
    return config.admin.phones.length > 0;
  }
}

// Export singleton instance
export const adminService = new AdminService();



