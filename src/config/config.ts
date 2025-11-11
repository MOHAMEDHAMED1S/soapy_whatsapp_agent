import dotenv from 'dotenv';

dotenv.config();

export const config = {
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
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
};

// Validate required config
if (!config.gemini.apiKey) {
  throw new Error('GEMINI_API_KEY is required in .env file');
}

