import { Request, Response } from 'express';
import { EmailService } from '../services/emailService';
import { ScheduleEmailsSchema } from '../validators/emailValidator';
import { ZodError } from 'zod';

export class EmailController {
  /**
   * POST /api/emails/schedule
   * Validate parameters and queue a list of emails for scheduling
   */
  static async scheduleEmails(req: Request, res: Response) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required',
        },
      });
    }

    try {
      // Validate inputs using Zod
      const parsedBody = ScheduleEmailsSchema.parse(req.body);

      // Call EmailService
      const emails = await EmailService.scheduleEmails({
        userId: req.user.id,
        senderId: parsedBody.senderId,
        recipients: parsedBody.recipients,
        subject: parsedBody.subject,
        body: parsedBody.body,
        scheduledAt: parsedBody.scheduledAt,
        delayBetweenMs: parsedBody.delayBetweenMs,
        hourlyLimit: parsedBody.hourlyLimit,
      });

      return res.status(201).json({
        success: true,
        data: {
          message: `Successfully scheduled ${emails.length} emails.`,
          emails: emails.map((e) => ({
            id: e.id,
            recipient: e.recipient,
            scheduledAt: e.scheduledAt,
            status: e.status,
          })),
        },
      });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid schedule parameters provided',
            details: error.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
        });
      }

      console.error('Email scheduling failed:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to schedule emails',
        },
      });
    }
  }

  /**
   * GET /api/emails/scheduled
   * Fetch all active scheduled/processing emails for the current user
   */
  static async getScheduledEmails(req: Request, res: Response) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required',
        },
      });
    }

    try {
      const emails = await EmailService.getScheduledEmails(req.user.id);
      return res.json({
        success: true,
        data: emails,
      });
    } catch (error: any) {
      console.error('Failed to fetch scheduled emails:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve scheduled emails',
        },
      });
    }
  }

  /**
   * GET /api/emails/sent
   * Fetch all finished sent/failed emails for the current user
   */
  static async getSentEmails(req: Request, res: Response) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required',
        },
      });
    }

    try {
      const emails = await EmailService.getSentEmails(req.user.id);
      return res.json({
        success: true,
        data: emails,
      });
    } catch (error: any) {
      console.error('Failed to fetch sent emails:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve sent emails',
        },
      });
    }
  }

  /**
   * GET /api/emails/:id
   * Fetch a specific email record by ID (enforces user isolation)
   */
  static async getEmailById(req: Request, res: Response) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User authentication required',
        },
      });
    }

    const { id } = req.params;

    try {
      const email = await EmailService.getEmailById(id, req.user.id);

      if (!email) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Email message with ID ${id} not found`,
          },
        });
      }

      return res.json({
        success: true,
        data: email,
      });
    } catch (error: any) {
      console.error(`Failed to fetch email ${id}:`, error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve email details',
        },
      });
    }
  }
}
