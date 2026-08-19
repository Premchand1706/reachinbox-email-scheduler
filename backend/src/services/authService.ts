import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { PrismaClient, User } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

export class AuthService {
  /**
   * Generate the Google OAuth authorization URL
   */
  static getAuthUrl(): string {
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      prompt: 'consent',
    });
  }

  /**
   * Exchange code for tokens and authenticate/register the user
   */
  static async authenticateCode(code: string): Promise<{ user: User; token: string }> {
    // Exchange auth code for tokens
    const { tokens } = await client.getToken(code);
    const idToken = tokens.id_token;

    if (!idToken) {
      throw new Error('No ID token returned by Google');
    }

    // Verify token identity
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new Error('Invalid ID token payload');
    }

    const { email, name, picture } = payload;

    // Find or create User
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Create user
      user = await prisma.user.create({
        data: {
          email,
          name: name || null,
          avatar: picture || null,
        },
      });

      // Automatically seed 3 default senders for this new user
      const defaultSenders = [
        { email: `${email.split('@')[0]}.outreach@reachinbox.ai`, name: `${name || 'User'} (Outreach)` },
        { email: `${email.split('@')[0]}.marketing@reachinbox.ai`, name: `${name || 'User'} (Marketing)` },
        { email: `${email.split('@')[0]}.support@reachinbox.ai`, name: `${name || 'User'} (Support)` },
      ];

      for (const s of defaultSenders) {
        // Enforce uniqueness on sender email across DB
        await prisma.sender.upsert({
          where: { email: s.email },
          update: { userId: user.id },
          create: {
            email: s.email,
            name: s.name,
            userId: user.id,
          },
        });
      }
    } else {
      // Update details if changed
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: name || user.name,
          avatar: picture || user.avatar,
        },
      });
    }

    // Sign JWT session token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev_secret_key',
      { expiresIn: '24h' }
    );

    return { user, token };
  }

  /**
   * Verify JWT session token and return user details
   */
  static async verifySessionToken(token: string): Promise<User | null> {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_key') as {
        userId: string;
        email: string;
      };

      return prisma.user.findUnique({
        where: { id: decoded.userId },
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Development login bypass (for automated testing or sandbox runs)
   */
  static async generateDevToken(email: string): Promise<{ user: User; token: string }> {
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: 'Developer Mode',
          avatar: 'https://lh3.googleusercontent.com/a/default-user',
        },
      });

      // Seed Senders
      const defaultSenders = [
        { email: `${email.split('@')[0]}.outreach@reachinbox.ai`, name: 'Dev Outreach' },
        { email: `${email.split('@')[0]}.support@reachinbox.ai`, name: 'Dev Support' },
      ];

      for (const s of defaultSenders) {
        await prisma.sender.upsert({
          where: { email: s.email },
          update: { userId: user.id },
          create: {
            email: s.email,
            name: s.name,
            userId: user.id,
          },
        });
      }
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev_secret_key',
      { expiresIn: '24h' }
    );

    return { user, token };
  }
}
