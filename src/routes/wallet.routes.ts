import { Router } from 'express';
import { getUserBalances, getUserTransactions } from '../controllers/wallet.controller';

const router = Router();

router.get('/:userId/balances', getUserBalances);
router.get('/:userId/transactions', getUserTransactions);

export default router;
