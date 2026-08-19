import { Router } from 'express';
import { SenderController } from '../controllers/senderController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.get('/', requireAuth, SenderController.getSenders);

export default router;
