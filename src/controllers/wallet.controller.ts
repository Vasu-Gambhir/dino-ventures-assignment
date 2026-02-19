import { Request, Response, NextFunction } from 'express';
import { getBalances, getTransactionHistory } from '../services/wallet.service';

export async function getUserBalances(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.params.userId as string;
    const balances = await getBalances(userId);
    res.json({ userId, balances });
  } catch (error) {
    next(error);
  }
}

export async function getUserTransactions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.params.userId as string;
    const transactions = await getTransactionHistory(userId);
    res.json({ userId, transactions });
  } catch (error) {
    next(error);
  }
}
