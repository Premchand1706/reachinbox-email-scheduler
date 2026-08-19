import { Router } from 'express';
import { EmailController } from '../controllers/emailController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/schedule', requireAuth, EmailController.scheduleEmails);
router.get('/scheduled', requireAuth, EmailController.getScheduledEmails);
router.get('/sent', requireAuth, EmailController.getSentEmails);
router.get('/:id', requireAuth, EmailController.getEmailById);

export default router;
