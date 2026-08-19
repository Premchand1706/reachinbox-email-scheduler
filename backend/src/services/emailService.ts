import { PrismaClient, EmailStatus, EmailMessage } from '@prisma/client';
import { emailQueue } from '../queues/emailQueue';
import { cryptoRandomString } from '../utils/crypto'; // We will define a simple UUID helper

const prisma = new PrismaClient();

interface ScheduleEmailInput {
  userId: string;
  senderId: string;
  recipients: string[];
  subject: string;
  body: string;
  scheduledAt: string; // ISO String (start time)
  delayBetweenMs: number;
  hourlyLimit: number;
}

export class EmailService {
  /**
   * Schedule a batch of emails with scheduling-time load spreading (optimization)
   */
  static async scheduleEmails(input: ScheduleEmailInput): Promise<EmailMessage[]> {
    const {
      userId,
      senderId,
      recipients,
      subject,
      body,
      scheduledAt,
      delayBetweenMs,
      hourlyLimit,
    } = input;

    // Verify sender exists and belongs to the user
    const sender = await prisma.sender.findFirst({
      where: { id: senderId, userId },
    });
    if (!sender) {
      throw new Error('Sender not found or access denied');
    }

    const startTime = new Date(scheduledAt);
    let lastScheduledTime = startTime.getTime();

    // Fetch the most recently scheduled email for this sender to append to it
    const lastEmail = await prisma.emailMessage.findFirst({
      where: { senderId, status: EmailStatus.SCHEDULED },
      orderBy: { scheduledAt: 'desc' },
    });

    if (lastEmail) {
      const dbLastTime = new Date(lastEmail.scheduledAt).getTime();
      if (dbLastTime > lastScheduledTime) {
        lastScheduledTime = dbLastTime;
      }
    }

    const createdEmails: EmailMessage[] = [];

    // Temporary hourly rate limit tracking for pre-distribution optimization
    const hourlyCounts: Record<string, number> = {};

    // Helper to calculate hour window string YYYYMMDDHH
    const getHourWindowString = (date: Date) => {
      return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}${String(date.getHours()).padStart(2, '0')}`;
    };

    // Pre-populate hourly counts from DB to optimize distribution
    const emailsInFuture = await prisma.emailMessage.findMany({
      where: {
        senderId,
        status: EmailStatus.SCHEDULED,
        scheduledAt: { gte: startTime },
      },
      select: { scheduledAt: true },
    });

    for (const e of emailsInFuture) {
      const window = getHourWindowString(new Date(e.scheduledAt));
      hourlyCounts[window] = (hourlyCounts[window] || 0) + 1;
    }

    // Generate database records inside a single transaction
    const emailDataList = [];
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];

      // Calculate tentative time respecting minimum delay
      let tentativeTimeMs = i === 0 && lastScheduledTime === startTime.getTime()
        ? startTime.getTime()
        : lastScheduledTime + delayBetweenMs;

      let tentativeDate = new Date(tentativeTimeMs);
      let window = getHourWindowString(tentativeDate);

      // Distribute to future hours if rate limit window is exceeded in this pre-calculation
      while ((hourlyCounts[window] || 0) >= hourlyLimit) {
        // Move to start of next hour
        const nextHour = new Date(tentativeDate);
        nextHour.setHours(tentativeDate.getHours() + 1);
        nextHour.setMinutes(0, 0, 0);
        tentativeTimeMs = nextHour.getTime();
        tentativeDate = new Date(tentativeTimeMs);
        window = getHourWindowString(tentativeDate);
      }

      hourlyCounts[window] = (hourlyCounts[window] || 0) + 1;
      lastScheduledTime = tentativeTimeMs;

      const emailId = cryptoRandomString();
      const idempotencyKey = `idemp-${emailId}`; // Unique per email

      emailDataList.push({
        id: emailId,
        userId,
        senderId,
        recipient,
        subject,
        body,
        scheduledAt: tentativeDate,
        status: EmailStatus.SCHEDULED,
        idempotencyKey,
      });
    }

    // Execute batch insert in DB
    await prisma.$transaction(
      emailDataList.map((data) =>
        prisma.emailMessage.create({
          data,
        })
      )
    );

    // Fetch created records to return
    const ids = emailDataList.map((d) => d.id);
    const emails = await prisma.emailMessage.findMany({
      where: { id: { in: ids } },
      orderBy: { scheduledAt: 'asc' },
    });

    // Queue the jobs in BullMQ (out-of-transaction).
    // If any fail, the startup recovery service will pick them up.
    for (const email of emails) {
      const delay = new Date(email.scheduledAt).getTime() - Date.now();
      const safeDelay = delay < 0 ? 0 : delay;

      try {
        await emailQueue.add(
          'send-email',
          { emailMessageId: email.id },
          {
            delay: safeDelay,
            jobId: `email-${email.id}`, // Deterministic Job ID to prevent duplicates
          }
        );
      } catch (err) {
        console.error(`[EmailService] Failed to queue job for email ${email.id}:`, err);
      }
    }

    return emails;
  }

  /**
   * Get all scheduled emails for a user
   */
  static async getScheduledEmails(userId: string): Promise<EmailMessage[]> {
    return prisma.emailMessage.findMany({
      where: {
        userId,
        status: { in: [EmailStatus.SCHEDULED, EmailStatus.PROCESSING, EmailStatus.RETRYING] },
      },
      include: { sender: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /**
   * Get all sent/failed emails for a user
   */
  static async getSentEmails(userId: string): Promise<EmailMessage[]> {
    return prisma.emailMessage.findMany({
      where: {
        userId,
        status: { in: [EmailStatus.SENT, EmailStatus.FAILED] },
      },
      include: { sender: true },
      orderBy: { sentAt: 'desc' }, // Latest sent first
    });
  }

  /**
   * Get email message by ID with user isolation check
   */
  static async getEmailById(id: string, userId: string): Promise<EmailMessage | null> {
    return prisma.emailMessage.findFirst({
      where: { id, userId },
      include: { sender: true },
    });
  }
}
