export interface AssetType {
  id: string;
  symbol: string;
  name: string;
  created_at: Date;
}

export interface Account {
  id: string;
  user_id: string;
  asset_type_id: string;
  account_type: 'user' | 'system';
  balance: string; // DECIMAL comes back as string from pg
  created_at: Date;
}

export type TransactionType = 'topup' | 'bonus' | 'spend';
export type TransactionStatus = 'completed' | 'failed';
export type EntryType = 'debit' | 'credit';

export interface Transaction {
  id: string;
  idempotency_key: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  asset_type_id: string;
  source_account_id: string;
  destination_account_id: string;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  entry_type: EntryType;
  amount: string;
  balance_after: string;
  created_at: Date;
}

export interface ProcessTransactionInput {
  type: TransactionType;
  userId: string;
  asset: string;
  amount: number;
  idempotencyKey: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionResponse {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  asset: string;
  balanceAfter: number;
  createdAt: Date;
}

export interface BalanceResponse {
  asset: string;
  assetName: string;
  balance: number;
}

export interface TransactionHistoryItem {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  asset: string;
  direction: 'in' | 'out';
  balanceAfter: number;
  referenceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
