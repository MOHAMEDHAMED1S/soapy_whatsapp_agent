import dotenv from 'dotenv';

dotenv.config();

export const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash',
  },
  api: {
    baseUrl: process.env.API_BASE_URL || 'https://api.soapy-bubbles.com/api/v1',
  },
  database: {
    path: process.env.DATABASE_PATH || './data/conversations.db',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  customer: {
    ip: process.env.CUSTOMER_IP || '0.0.0.0',
  },
  admin: {
    // Admin phone numbers (comma-separated)
    // Format: 965XXXXXXXXX (without country code prefix like +)
    phones: (process.env.ADMIN_PHONES || '').split(',').map(p => p.trim()).filter(p => p.length > 0),
  },
};

// Validate required config
if (!config.gemini.apiKey) {
  throw new Error('GEMINI_API_KEY is required in .env file');
}

