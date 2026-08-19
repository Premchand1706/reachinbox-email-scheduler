import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { redisClient } from './config/redis';
import authRoutes from './routes/authRoutes';
import senderRoutes from './routes/senderRoutes';
import emailRoutes from './routes/emailRoutes';

const prisma = new PrismaClient();
const app = express();

// Security and request parsing middlewares
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' })); // Request payload limit safety
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check API
app.get('/api/health', async (req, res) => {
  let dbConnected = false;
  let redisConnected = false;

  try {
    // Check PostgreSQL
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch (err) {
    console.error('[Health Check] PostgreSQL connection failed:', err);
  }

  try {
    // Check Redis
    const pong = await redisClient.ping();
    redisConnected = pong === 'PONG';
  } catch (err) {
    console.error('[Health Check] Redis connection failed:', err);
  }

  const overallSuccess = dbConnected && redisConnected;

  return res.status(overallSuccess ? 200 : 503).json({
    success: overallSuccess,
    data: {
      status: overallSuccess ? 'healthy' : 'unhealthy',
      database: dbConnected ? 'connected' : 'disconnected',
      redis: redisConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    },
  });
});

// App API routes
app.use('/api/auth', authRoutes);
app.use('/api/senders', senderRoutes);
app.use('/api/emails', emailRoutes);

// 404 Route handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Resource not found for ${req.method} ${req.path}`,
    },
  });
});

// Generic 500 error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Error] Server error:', err);
  return res.status(err.status || 500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected server error occurred',
    },
  });
});

export default app;
