import { z } from 'zod';

export const ScheduleEmailsSchema = z.object({
  senderId: z.string({
    required_error: 'senderId is required',
  }).uuid('Invalid senderId format (must be UUID)'),
  
  recipients: z.array(
    z.string().email('Invalid email address format')
  ).min(1, 'At least one recipient must be specified'),

  subject: z.string().min(1, 'Subject cannot be empty'),

  body: z.string().min(1, 'Body cannot be empty'),

  scheduledAt: z.string().refine((val) => {
    const timestamp = Date.parse(val);
    return !isNaN(timestamp);
  }, {
    message: 'scheduledAt must be a valid ISO-8601 date string',
  }),

  delayBetweenMs: z.number().int().nonnegative().default(2000),

  hourlyLimit: z.number().int().positive().default(200),
});

export type ScheduleEmailsInput = z.infer<typeof ScheduleEmailsSchema>;
