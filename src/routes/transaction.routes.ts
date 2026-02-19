import { Router } from 'express';
import { topup, bonus, spend, getTransaction } from '../controllers/transaction.controller';

const router = Router();

router.post('/topup', topup);
router.post('/bonus', bonus);
router.post('/spend', spend);
router.get('/:id', getTransaction);

export default router;
