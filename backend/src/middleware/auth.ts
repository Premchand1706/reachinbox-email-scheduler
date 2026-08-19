import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';
import { User } from '@prisma/client';

// Extend Express Request type to include authenticated user details
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies.auth_token;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication token is missing. Please log in.',
      },
    });
  }

  const user = await AuthService.verifySessionToken(token);

  if (!user) {
    // Clear invalid token cookie
    res.clearCookie('auth_token');
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Session has expired or is invalid. Please log in again.',
      },
    });
  }

  // Attach user to request
  req.user = user;
  next();
}
