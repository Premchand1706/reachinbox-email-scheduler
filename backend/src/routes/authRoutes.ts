import { Router } from 'express';
import { AuthController } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/google', AuthController.loginWithGoogle);
router.get('/google/callback', AuthController.googleCallback);
router.get('/me', requireAuth, AuthController.getMe);
router.post('/logout', AuthController.logout);

// Development backdoor for testing (only available locally)
if (process.env.NODE_ENV !== 'production' || !process.env.GOOGLE_CLIENT_ID) {
  router.get('/dev-login', AuthController.devLogin);
}

export default router;
