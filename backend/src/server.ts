import app from './app';
import { startEmailWorker } from './workers/emailWorker';
import { runRecoveryService } from './services/recoveryService';
import { redisClient } from './config/redis';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;

const startServer = process.env.START_SERVER !== 'false';
const startWorker = process.env.START_WORKER !== 'false';

let server: any = null;

if (startServer) {
  server = app.listen(PORT, async () => {
    console.log(`=========================================`);
    console.log(` ReachInbox Backend running on port ${PORT}`);
    console.log(`=========================================`);

    if (startWorker) {
      try {
        await runRecoveryService();
      } catch (err) {
        console.error('Failed to execute Recovery Service on startup:', err);
      }
    }
  });
}

if (startWorker) {
  try {
    startEmailWorker();
    console.log(`=========================================`);
    console.log(` ReachInbox Email Worker is running`);
    console.log(`=========================================`);

    if (!startServer) {
      runRecoveryService().catch((err) => {
        console.error('Failed to execute Recovery Service on worker startup:', err);
      });
    }
  } catch (err) {
    console.error('Failed to start BullMQ Email Worker:', err);
  }
}

// Graceful Shutdown helper
async function closeConnections() {
  try {
    await prisma.$disconnect();
    console.log('PostgreSQL database disconnected.');

    await redisClient.quit();
    console.log('Redis connection closed.');

    process.exit(0);
  } catch (err) {
    console.error('Error during database disconnection:', err);
    process.exit(1);
  }
}

// Graceful Shutdown implementation
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down gracefully...`);

  if (server) {
    server.close(async () => {
      console.log('HTTP server closed.');
      await closeConnections();
    });
  } else {
    await closeConnections();
  }

  // Force exit after 10s if graceful shutdown fails
  setTimeout(() => {
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
