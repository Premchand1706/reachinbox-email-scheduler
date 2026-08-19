import { Request, Response } from 'express';
import { AuthService } from '../services/authService';

export class AuthController {
  /**
   * GET /api/auth/google
   * Redirect user to Google OAuth consent screen
   */
  static async loginWithGoogle(req: Request, res: Response) {
    try {
      const url = AuthService.getAuthUrl();
      return res.redirect(url);
    } catch (error: any) {
      console.error('Google OAuth URL generation failed:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to initiate Google Login',
        },
      });
    }
  }

  /**
   * GET /api/auth/google/callback
   * Google redirects back here after user consent
   */
  static async googleCallback(req: Request, res: Response) {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=invalid_auth_code`);
    }

    try {
      const { token } = await AuthService.authenticateCode(code);

      // Set cookie containing the JWT token
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      // Redirect user back to the frontend dashboard
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`);
    } catch (error: any) {
      console.error('OAuth callback processing failed:', error);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login?error=auth_failed`);
    }
  }

  /**
   * GET /api/auth/me
   * Return authenticated user details
   */
  static async getMe(req: Request, res: Response) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User is not logged in',
        },
      });
    }

    return res.json({
      success: true,
      data: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        avatar: req.user.avatar,
      },
    });
  }

  /**
   * POST /api/auth/logout
   * Clear session cookies
   */
  static async logout(req: Request, res: Response) {
    res.clearCookie('auth_token');
    return res.json({
      success: true,
      data: {
        message: 'Logged out successfully',
      },
    });
  }

  /**
   * GET /api/auth/dev-login
   * Developer login bypass for local test automation or preview
   */
  static async devLogin(req: Request, res: Response) {
    if (process.env.ENABLE_DEV_SANDBOX !== 'true') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Developer sandbox login is disabled in this environment',
        },
      });
    }

    const email = (req.query.email as string) || 'intern@reachinbox.ai';

    try {
      const { token } = await AuthService.generateDevToken(email);

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      });

      const redirectUrl = req.query.redirect as string;
      if (redirectUrl) {
        return res.redirect(redirectUrl);
      }

      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard`);
    } catch (error: any) {
      console.error('Developer login failed:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to authenticate in developer mode',
        },
      });
    }
  }
}
