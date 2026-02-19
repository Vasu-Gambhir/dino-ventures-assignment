import { Request, Response, NextFunction } from 'express';
import { AppError, TransactionType } from '../types';
import { processTransaction, getTransactionById } from '../services/wallet.service';

function createTransactionHandler(type: TransactionType) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId, asset, amount, idempotencyKey, referenceId, metadata } = req.body;

      if (!userId || !asset || amount === undefined || !idempotencyKey) {
        throw new AppError(400, 'Missing required fields: userId, asset, amount, idempotencyKey');
      }

      if (typeof amount !== 'number' || amount <= 0) {
        throw new AppError(400, 'Amount must be a positive number');
      }

      const result = await processTransaction({
        type,
        userId,
        asset,
        amount,
        idempotencyKey,
        referenceId,
        metadata,
      });

      // 200 if idempotent replay, 201 for new transaction
      const statusCode = result.createdAt.getTime() < Date.now() - 1000 ? 200 : 201;
      res.status(statusCode).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export const topup = createTransactionHandler('topup');
export const bonus = createTransactionHandler('bonus');
export const spend = createTransactionHandler('spend');

export async function getTransaction(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = req.params.id as string;
    const result = await getTransactionById(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
