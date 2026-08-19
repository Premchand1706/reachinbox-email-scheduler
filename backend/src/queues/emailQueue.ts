import { Queue } from 'bullmq';
import { redisOptions } from '../config/redis';

// Initialize the main email queue
export const emailQueue = new Queue('email-queue', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3, // Default retry attempts
    backoff: {
      type: 'exponential',
      delay: 5000, // Start with 5 seconds backoff
    },
    removeOnComplete: { count: 1000 }, // Clean up completed jobs to save memory
    removeOnFail: { count: 5000 },
  },
});

console.log('BullMQ Email Queue initialized');
