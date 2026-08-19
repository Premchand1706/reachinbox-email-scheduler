import { Worker, Job } from 'bullmq';
import { PrismaClient, EmailStatus } from '@prisma/client';
import nodemailer from 'nodemailer';
import { redisOptions, redisClient } from '../config/redis';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// In-memory cache for dynamic Ethereal SMTP test account
let cachedEtherealTransporter: nodemailer.Transporter | null = null;

// Helper to get or create SMTP Transporter
async function getTransporter(): Promise<nodemailer.Transporter> {
  const host = process.env.ETHEREAL_HOST;
  const port = parseInt(process.env.ETHEREAL_PORT || '587', 10);
  const user = process.env.ETHEREAL_USER;
  const pass = process.env.ETHEREAL_PASSWORD;

  if (host && user && pass) {
    // Return configured Ethereal transporter
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  // Fallback: Dynamically generate a transient test account on first run
  if (cachedEtherealTransporter) {
    return cachedEtherealTransporter;
  }

  console.log('Generating dynamic Ethereal SMTP test account...');
  const testAccount = await nodemailer.createTestAccount();
  console.log(`Dynamic Ethereal account created: User=${testAccount.user}`);

  cachedEtherealTransporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  return cachedEtherealTransporter;
}

// Atomic Lua script definition
const THROTTLE_LIMIT_LUA = `
  local lastSendKey = KEYS[1]
  local rateLimitKey = KEYS[2]
  
  local now = tonumber(ARGV[1])
  local minDelay = tonumber(ARGV[2])
  local hourlyLimit = tonumber(ARGV[3])
  local nextHourStart = tonumber(ARGV[4])
  
  -- 1. Check minimum delay throttle
  local lastSend = redis.call('get', lastSendKey)
  local lastSendTime = tonumber(lastSend or '0')
  if now < lastSendTime + minDelay then
    return {0, lastSendTime + minDelay} -- throttled by min delay, returns next allowed time
  end
  
  -- 2. Check hourly limit
  local count = tonumber(redis.call('get', rateLimitKey) or '0')
  if count >= hourlyLimit then
    return {1, nextHourStart} -- rate limited, returns start of next hour
  end
  
  -- 3. Both checks passed: reserve slot
  redis.call('set', lastSendKey, tostring(now))
  redis.call('incr', rateLimitKey)
  redis.call('expire', rateLimitKey, 7200) -- expire hourly rate key after 2 hours
  
  return {2, 0} -- allowed
`;

// Helper to calculate the next hour window start time (in millisecond timestamp)
function getNextHourStart(now: Date): number {
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1);
  nextHour.setMinutes(0, 0, 0);
  return nextHour.getTime();
}

// Initialize the worker
export function startEmailWorker() {
  const workerConcurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
  const minDelayMs = parseInt(process.env.MIN_EMAIL_DELAY_MS || '2000', 10);
  const maxEmailsPerHour = parseInt(process.env.MAX_EMAILS_PER_HOUR || '200', 10);

  console.log(`Starting BullMQ worker (Concurrency = ${workerConcurrency})`);

  const worker = new Worker(
    'email-queue',
    async (job: Job) => {
      const { emailMessageId } = job.data;
      if (!emailMessageId) return;

      console.log(`[Worker] Received job ${job.id} for email message ${emailMessageId}`);

      // 1. Database-level claiming: Transition SCHEDULED -> PROCESSING atomically
      const claimResult = await prisma.emailMessage.updateMany({
        where: {
          id: emailMessageId,
          status: { in: [EmailStatus.SCHEDULED, EmailStatus.RETRYING] },
        },
        data: {
          status: EmailStatus.PROCESSING,
        },
      });

      if (claimResult.count === 0) {
        // Email message has already been sent or is currently being processed by another worker
        const currentMessage = await prisma.emailMessage.findUnique({
          where: { id: emailMessageId },
        });

        if (currentMessage?.status === EmailStatus.SENT) {
          console.log(`[Worker] Job ${job.id} skipped, email ${emailMessageId} is already SENT.`);
          return;
        }

        console.log(`[Worker] Job ${job.id} skipped, email ${emailMessageId} is in status ${currentMessage?.status}.`);
        return;
      }

      // Fetch the claimed record
      const emailMessage = await prisma.emailMessage.findUnique({
        where: { id: emailMessageId },
        include: { sender: true },
      });

      if (!emailMessage) {
        console.error(`[Worker] claimed record ${emailMessageId} not found in database.`);
        return;
      }

      const senderId = emailMessage.senderId;
      const now = new Date();
      const nowMs = now.getTime();
      const hourWindow = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}`;
      const nextHourStartMs = getNextHourStart(now);

      const lastSendKey = `sender:${senderId}:last-send-time`;
      const rateLimitKey = `email-rate:${senderId}:${hourWindow}`;

      // 2. Perform atomic Redis throttle and rate limit check
      // Define types for response to ensure safety
      const redisResult = (await redisClient.eval(
        THROTTLE_LIMIT_LUA,
        2,
        lastSendKey,
        rateLimitKey,
        nowMs,
        minDelayMs,
        maxEmailsPerHour,
        nextHourStartMs
      )) as [number, number];

      const [status, nextAvailableTime] = redisResult;

      if (status === 0) {
        // Throttled by min delay
        const delay = nextAvailableTime - nowMs;
        console.log(`[Worker] Sender ${senderId} throttled. Rescheduling email ${emailMessageId} in ${delay}ms`);
        
        await prisma.emailMessage.update({
          where: { id: emailMessageId },
          data: { status: EmailStatus.SCHEDULED },
        });

        // Requeue delayed job
        const { emailQueue } = await import('../queues/emailQueue');
        await emailQueue.add(
          'send-email',
          { emailMessageId },
          { delay, jobId: `email-${emailMessageId}` }
        );
        return;
      }

      if (status === 1) {
        // Rate limited
        const delay = nextAvailableTime - nowMs;
        console.log(`[Worker] Sender ${senderId} hourly rate limit reached. Rescheduling email ${emailMessageId} in ${delay}ms`);

        await prisma.emailMessage.update({
          where: { id: emailMessageId },
          data: { status: EmailStatus.SCHEDULED },
        });

        // Requeue for next hour
        const { emailQueue } = await import('../queues/emailQueue');
        await emailQueue.add(
          'send-email',
          { emailMessageId },
          { delay, jobId: `email-${emailMessageId}` }
        );
        return;
      }

      // status === 2: Slot reserved, send email!
      console.log(`[Worker] Slot reserved. Sending email ${emailMessageId} via SMTP...`);

      try {
        const transporter = await getTransporter();
        const fromAddress = process.env.ETHEREAL_FROM || `"${emailMessage.sender.name}" <${emailMessage.sender.email}>`;
        
        const mailOptions = {
          from: fromAddress,
          to: emailMessage.recipient,
          subject: emailMessage.subject,
          text: emailMessage.body,
        };

        const info = await transporter.sendMail(mailOptions);
        const previewUrl = nodemailer.getTestMessageUrl(info);

        console.log(`[Worker] Email ${emailMessageId} sent successfully! MsgId: ${info.messageId}`);
        if (previewUrl) {
          console.log(`[Worker] Ethereal Preview URL: ${previewUrl}`);
        }

        // 3. Mark SENT after successful SMTP
        await prisma.emailMessage.update({
          where: { id: emailMessageId },
          data: {
            status: EmailStatus.SENT,
            sentAt: new Date(),
            attempts: emailMessage.attempts + 1,
            failureReason: previewUrl ? `Preview URL: ${previewUrl}` : null, // Store preview url in failureReason for easy display!
          },
        });
      } catch (error: any) {
        console.error(`[Worker] SMTP execution failed for email ${emailMessageId}:`, error);

        const currentAttempts = emailMessage.attempts + 1;
        const maxAttempts = 3;

        if (currentAttempts < maxAttempts) {
          // Retry
          await prisma.emailMessage.update({
            where: { id: emailMessageId },
            data: {
              status: EmailStatus.RETRYING,
              attempts: currentAttempts,
              failedAt: new Date(),
              failureReason: error.message || 'Transient SMTP error',
            },
          });
          throw error; // Throw error to trigger BullMQ retry backoff
        } else {
          // Permanent failure
          await prisma.emailMessage.update({
            where: { id: emailMessageId },
            data: {
              status: EmailStatus.FAILED,
              attempts: currentAttempts,
              failedAt: new Date(),
              failureReason: error.message || 'Maximum SMTP attempts reached',
            },
          });
        }
      }
    },
    {
      connection: redisOptions,
      concurrency: workerConcurrency,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Fatal error:', err);
  });
}
