import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SenderController {
  /**
   * GET /api/senders
   * List all sender aliases for the authenticated user
   */
  static async getSenders(req: Request, res: Response) {
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
      const senders = await prisma.sender.findMany({
        where: { userId: req.user.id },
        orderBy: { email: 'asc' },
      });

      return res.json({
        success: true,
        data: senders.map((s) => ({
          id: s.id,
          email: s.email,
          name: s.name,
        })),
      });
    } catch (error: any) {
      console.error('Failed to retrieve senders:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to retrieve senders list',
        },
      });
    }
  }
}
