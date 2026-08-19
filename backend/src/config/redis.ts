import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Connection options for BullMQ (reuses URL properties)
export const redisOptions = {
  host: new URL(redisUrl).hostname || 'localhost',
  port: parseInt(new URL(redisUrl).port || '6379', 10),
  username: new URL(redisUrl).username || undefined,
  password: new URL(redisUrl).password || undefined,
  maxRetriesPerRequest: null, // Critical requirement for BullMQ
};

// Singleton Redis Client for general cache/rate limit queries
export const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

redisClient.on('connect', () => {
  console.log('Successfully connected to Redis');
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err);
});
