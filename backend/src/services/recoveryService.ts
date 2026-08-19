import { PrismaClient, EmailStatus } from '@prisma/client';
import { emailQueue } from '../queues/emailQueue';

const prisma = new PrismaClient();

export async function runRecoveryService() {
  console.log('[Recovery Service] Starting integrity check between Database and BullMQ...');

  try {
    // Query for scheduled or retrying emails in the database
    const orphanedEmails = await prisma.emailMessage.findMany({
      where: {
        status: { in: [EmailStatus.SCHEDULED, EmailStatus.RETRYING] },
      },
    });

    console.log(`[Recovery Service] Found ${orphanedEmails.length} emails in SCHEDULED/RETRYING status.`);

    let recoveredCount = 0;

    for (const email of orphanedEmails) {
      const jobId = `email-${email.id}`;

      // Check if job exists in BullMQ (active, delayed, waiting, completed, failed, etc.)
      const job = await emailQueue.getJob(jobId);

      if (!job) {
        // Job is missing from Redis! We need to recover it.
        const now = new Date();
        const scheduledTime = new Date(email.scheduledAt);

        // Calculate appropriate delay
        let delay = scheduledTime.getTime() - now.getTime();
        if (delay < 0) {
          delay = 0; // Send immediately if the scheduled time is in the past
        }

        console.log(`[Recovery Service] Recovering missing job for email ${email.id}. Rescheduling in ${delay}ms`);

        // Re-queue the job with deterministic jobId
        await emailQueue.add(
          'send-email',
          { emailMessageId: email.id },
          { delay, jobId }
        );

        recoveredCount++;
      }
    }

    console.log(`[Recovery Service] Integrity check complete. Recovered ${recoveredCount} jobs.`);
  } catch (error) {
    console.error('[Recovery Service] Failed to execute recovery check:', error);
  }
}
