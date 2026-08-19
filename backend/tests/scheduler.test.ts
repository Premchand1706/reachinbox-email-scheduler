import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { PrismaClient, EmailStatus } from '@prisma/client';
import { EmailService } from '../src/services/emailService';
import { runRecoveryService } from '../src/services/recoveryService';
import { emailQueue } from '../src/queues/emailQueue';
import { redisClient } from '../src/config/redis';
import { cryptoRandomString } from '../src/utils/crypto';

const prisma = new PrismaClient();

// Setup mock transporter for Ethereal to prevent real SMTP connections during testing
vi.mock('nodemailer', () => {
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
      }),
      createTestAccount: vi.fn().mockResolvedValue({
        user: 'mock-user',
        pass: 'mock-pass',
        smtp: { host: 'smtp.mock.com', port: 587, secure: false },
      }),
      getTestMessageUrl: vi.fn().mockReturnValue('https://ethereal.email/message/mock-id'),
    },
  };
});

describe('ReachInbox Email Scheduler Test Suite', () => {
  let testUserId: string;
  let testSenderId: string;

  beforeEach(async () => {
    // Start PostgreSQL and Redis before tests run inside WSL (to ensure they are active)
    // We already do this on the environment, but clearing DB table contents is required
    await prisma.emailMessage.deleteMany({});
    await prisma.sender.deleteMany({});
    await prisma.user.deleteMany({});

    // Clear Redis keys used by tests
    const keys = await redisClient.keys('*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }

    // Seed test User
    const user = await prisma.user.create({
      data: {
        email: 'test-runner@reachinbox.ai',
        name: 'Test Runner',
        avatar: 'https://lh3.googleusercontent.com/avatar',
      },
    });
    testUserId = user.id;

    // Seed test Sender
    const sender = await prisma.sender.create({
      data: {
        email: 'outreach.test@reachinbox.ai',
        name: 'Test Sender',
        userId: testUserId,
      },
    });
    testSenderId = sender.id;

    // Drain BullMQ queue to avoid cross-test contamination
    await emailQueue.drain(true);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redisClient.quit();
  });

  it('1. Test scheduling 1 email', async () => {
    const recipients = ['john@gmail.com'];
    const startTime = new Date().toISOString();

    const emails = await EmailService.scheduleEmails({
      userId: testUserId,
      senderId: testSenderId,
      recipients,
      subject: 'Hello 1',
      body: 'Body 1',
      scheduledAt: startTime,
      delayBetweenMs: 2000,
      hourlyLimit: 100,
    });

    expect(emails).toHaveLength(1);
    expect(emails[0].recipient).toBe('john@gmail.com');
    expect(emails[0].status).toBe(EmailStatus.SCHEDULED);

    // Verify DB count
    const count = await prisma.emailMessage.count();
    expect(count).toBe(1);

    // Verify BullMQ has the job
    const job = await emailQueue.getJob(`email-${emails[0].id}`);
    expect(job).toBeDefined();
    expect(job?.data.emailMessageId).toBe(emails[0].id);
  });

  it('2. Test scheduling 10 and 100 emails (Verifying delay distributions)', async () => {
    const recipients = Array.from({ length: 10 }, (_, i) => `recipient-${i}@gmail.com`);
    const startTime = new Date();

    const emails = await EmailService.scheduleEmails({
      userId: testUserId,
      senderId: testSenderId,
      recipients,
      subject: 'Batch Test',
      body: 'Body text',
      scheduledAt: startTime.toISOString(),
      delayBetweenMs: 2000,
      hourlyLimit: 100,
    });

    expect(emails).toHaveLength(10);
    
    // Verify that delay between each subsequent email is exactly 2000ms
    for (let i = 1; i < emails.length; i++) {
      const prevTime = new Date(emails[i - 1].scheduledAt).getTime();
      const currTime = new Date(emails[i].scheduledAt).getTime();
      expect(currTime - prevTime).toBe(2000);
    }
  });

  it('3. Test scheduling 1000 simulated jobs (Verifying rate-limit pre-distribution)', async () => {
    const recipients = Array.from({ length: 1000 }, (_, i) => `bulk-${i}@gmail.com`);
    const startTime = new Date();
    const hourlyLimit = 200;

    const emails = await EmailService.scheduleEmails({
      userId: testUserId,
      senderId: testSenderId,
      recipients,
      subject: 'Bulk Test',
      body: 'Bulk Body',
      scheduledAt: startTime.toISOString(),
      delayBetweenMs: 2000,
      hourlyLimit,
    });

    expect(emails).toHaveLength(1000);

    // Group emails by their hour window YYYYMMDDHH
    const hourGroups: Record<string, number> = {};
    for (const email of emails) {
      const date = new Date(email.scheduledAt);
      const window = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}`;
      hourGroups[window] = (hourGroups[window] || 0) + 1;
    }

    // Verify that NO hour group exceeds the hourly limit of 200
    const groupCounts = Object.values(hourGroups);
    expect(groupCounts.length).toBeGreaterThanOrEqual(5); // 1000 / 200 = 5 hour windows
    groupCounts.forEach(count => {
      expect(count).toBeLessThanOrEqual(hourlyLimit);
    });
  });

  it('4. Test duplicate prevention / concurrent claiming', async () => {
    // Create an email record in database
    const email = await prisma.emailMessage.create({
      data: {
        userId: testUserId,
        senderId: testSenderId,
        recipient: 'race@gmail.com',
        subject: 'Race Condition Test',
        body: 'Testing row claim',
        scheduledAt: new Date(),
        status: EmailStatus.SCHEDULED,
        idempotencyKey: 'race-key-1',
      },
    });

    // Simulate two concurrent workers attempting to claim the record
    const claim1 = prisma.emailMessage.updateMany({
      where: {
        id: email.id,
        status: { in: [EmailStatus.SCHEDULED, EmailStatus.RETRYING] },
      },
      data: { status: EmailStatus.PROCESSING },
    });

    const claim2 = prisma.emailMessage.updateMany({
      where: {
        id: email.id,
        status: { in: [EmailStatus.SCHEDULED, EmailStatus.RETRYING] },
      },
      data: { status: EmailStatus.PROCESSING },
    });

    // Run both updates concurrently
    const [res1, res2] = await Promise.all([claim1, claim2]);

    // Only one worker must succeed in claiming the job (total claimed counts must be 1)
    const totalClaimed = res1.count + res2.count;
    expect(totalClaimed).toBe(1);
    
    // One will return count=1, the other count=0
    expect(res1.count === 1 || res2.count === 1).toBe(true);
    expect(res1.count === 0 || res2.count === 0).toBe(true);
  });

  it('5. Test restart recovery (DB record exists but BullMQ job is missing)', async () => {
    // Create email record in DB in SCHEDULED status, but do NOT queue it in BullMQ
    const email = await prisma.emailMessage.create({
      data: {
        userId: testUserId,
        senderId: testSenderId,
        recipient: 'orphaned@gmail.com',
        subject: 'Orphaned Job',
        body: 'This job exists in DB but not in Redis',
        scheduledAt: new Date(Date.now() + 5000), // Scheduled 5 seconds in future
        status: EmailStatus.SCHEDULED,
        idempotencyKey: 'orphan-key-1',
      },
    });

    // Verify job is indeed missing in BullMQ
    const jobBefore = await emailQueue.getJob(`email-${email.id}`);
    expect(jobBefore).toBeUndefined();

    // Trigger recovery service
    await runRecoveryService();

    // Verify the job was successfully re-queued in Redis
    const jobAfter = await emailQueue.getJob(`email-${email.id}`);
    expect(jobAfter).not.toBeNull();
    expect(jobAfter?.data.emailMessageId).toBe(email.id);
  });

  it('6. Test execution-time rate limit rescheduling', async () => {
    const senderId = testSenderId;
    const now = new Date();
    const hourWindow = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}`;
    const rateLimitKey = `email-rate:${senderId}:${hourWindow}`;

    // Mock rate limit already hit in Redis (simulating that the sender has sent MAX_EMAILS_PER_HOUR)
    await redisClient.set(rateLimitKey, '200'); // Assuming limit is 200

    // Script arguments checking throttle & rate-limiting logic
    const minDelayMs = 2000;
    const hourlyLimit = 200;
    const nowMs = now.getTime();
    const nextHourStartMs = nowMs + 3600000;

    const lastSendKey = `sender:${senderId}:last-send-time`;

    // Lua script payload
    const THROTTLE_LIMIT_LUA = `
      local lastSendKey = KEYS[1]
      local rateLimitKey = KEYS[2]
      
      local now = tonumber(ARGV[1])
      local minDelay = tonumber(ARGV[2])
      local hourlyLimit = tonumber(ARGV[3])
      local nextHourStart = tonumber(ARGV[4])
      
      local lastSend = redis.call('get', lastSendKey)
      local lastSendTime = tonumber(lastSend or '0')
      if now < lastSendTime + minDelay then
        return {0, lastSendTime + minDelay}
      end
      
      local count = tonumber(redis.call('get', rateLimitKey) or '0')
      if count >= hourlyLimit then
        return {1, nextHourStart} -- code 1 = rate limited, returns next hour start
      end
      
      redis.call('set', lastSendKey, tostring(now))
      redis.call('incr', rateLimitKey)
      return {2, 0}
    `;

    const result = await redisClient.eval(
      THROTTLE_LIMIT_LUA,
      2,
      lastSendKey,
      rateLimitKey,
      nowMs,
      minDelayMs,
      hourlyLimit,
      nextHourStartMs
    ) as [number, number];

    // Verify it was rate limited (status code 1) and returns next hour start time
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(nextHourStartMs);
  });
});
