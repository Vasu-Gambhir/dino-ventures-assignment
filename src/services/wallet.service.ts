import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import {
  Account,
  AppError,
  BalanceResponse,
  ProcessTransactionInput,
  Transaction,
  TransactionHistoryItem,
  TransactionResponse,
  TransactionType,
} from '../types';

/**
 * Resolves source and destination accounts based on transaction type.
 * - topup/bonus: treasury (source/debit) → user (destination/credit)
 * - spend: user (source/debit) → treasury (destination/credit)
 */
function resolveAccountRoles(
  type: TransactionType,
  userAccount: Account,
  treasuryAccount: Account,
): { sourceAccount: Account; destinationAccount: Account } {
  if (type === 'topup' || type === 'bonus') {
    return { sourceAccount: treasuryAccount, destinationAccount: userAccount };
  }
  // spend
  return { sourceAccount: userAccount, destinationAccount: treasuryAccount };
}

export async function processTransaction(
  input: ProcessTransactionInput,
): Promise<TransactionResponse> {
  const { type, userId, asset, amount, idempotencyKey, referenceId, metadata } = input;

  if (amount <= 0) {
    throw new AppError(400, 'Amount must be greater than zero');
  }

  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Idempotency check
    const existingTxn = await client.query<Transaction>(
      'SELECT * FROM transactions WHERE idempotency_key = $1',
      [idempotencyKey],
    );

    if (existingTxn.rows.length > 0) {
      await client.query('ROLLBACK');
      const txn = existingTxn.rows[0];

      // Fetch the asset symbol and destination balance for the response
      const assetResult = await client.query(
        'SELECT symbol FROM asset_types WHERE id = $1',
        [txn.asset_type_id],
      );
      const destAccount = await client.query<Account>(
        'SELECT balance FROM accounts WHERE id = $1',
        [txn.destination_account_id],
      );

      return {
        id: txn.id,
        type: txn.type,
        status: txn.status,
        amount: parseFloat(txn.amount),
        asset: assetResult.rows[0].symbol,
        balanceAfter: parseFloat(destAccount.rows[0].balance),
        createdAt: txn.created_at,
      };
    }

    // 2. Resolve asset type
    const assetResult = await client.query(
      'SELECT id FROM asset_types WHERE symbol = $1',
      [asset.toUpperCase()],
    );

    if (assetResult.rows.length === 0) {
      throw new AppError(400, `Unknown asset type: ${asset}`);
    }
    const assetTypeId = assetResult.rows[0].id;

    // 3. Find or create user account
    let userAccountResult = await client.query<Account>(
      'SELECT * FROM accounts WHERE user_id = $1 AND asset_type_id = $2',
      [userId, assetTypeId],
    );

    if (userAccountResult.rows.length === 0) {
      // Auto-create user account with zero balance
      await client.query(
        `INSERT INTO accounts (id, user_id, asset_type_id, account_type, balance)
         VALUES ($1, $2, $3, 'user', 0)`,
        [uuidv4(), userId, assetTypeId],
      );
      userAccountResult = await client.query<Account>(
        'SELECT * FROM accounts WHERE user_id = $1 AND asset_type_id = $2',
        [userId, assetTypeId],
      );
    }

    // Find treasury account for this asset
    const treasuryResult = await client.query<Account>(
      "SELECT * FROM accounts WHERE user_id = 'treasury' AND asset_type_id = $1",
      [assetTypeId],
    );

    if (treasuryResult.rows.length === 0) {
      throw new AppError(500, `Treasury account not found for asset: ${asset}`);
    }

    const userAccount = userAccountResult.rows[0];
    const treasuryAccount = treasuryResult.rows[0];

    // 4. Resolve source and destination
    const { sourceAccount, destinationAccount } = resolveAccountRoles(
      type,
      userAccount,
      treasuryAccount,
    );

    // 5. Lock accounts in consistent order (ascending UUID) to prevent deadlocks
    const [firstLockId, secondLockId] =
      sourceAccount.id < destinationAccount.id
        ? [sourceAccount.id, destinationAccount.id]
        : [destinationAccount.id, sourceAccount.id];

    const lockedRows = await client.query<Account>(
      'SELECT * FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
      [firstLockId, secondLockId],
    );

    // Map locked rows back to source/destination
    const lockedMap = new Map(lockedRows.rows.map((r) => [r.id, r]));
    const lockedSource = lockedMap.get(sourceAccount.id)!;
    const lockedDest = lockedMap.get(destinationAccount.id)!;

    // 6. Balance check — source must have sufficient funds
    const sourceBalance = parseFloat(lockedSource.balance);
    if (sourceBalance < amount) {
      throw new AppError(400, 'Insufficient balance');
    }

    // 7. Calculate new balances
    const newSourceBalance = sourceBalance - amount;
    const newDestBalance = parseFloat(lockedDest.balance) + amount;

    // 8. Create transaction record
    const txnId = uuidv4();
    await client.query(
      `INSERT INTO transactions (id, idempotency_key, type, status, amount, asset_type_id, source_account_id, destination_account_id, reference_id, metadata)
       VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9)`,
      [
        txnId,
        idempotencyKey,
        type,
        amount,
        assetTypeId,
        sourceAccount.id,
        destinationAccount.id,
        referenceId || null,
        JSON.stringify(metadata || {}),
      ],
    );

    // 9. Create ledger entries (debit source, credit destination)
    const debitEntryId = uuidv4();
    const creditEntryId = uuidv4();

    await client.query(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after)
       VALUES ($1, $2, $3, 'debit', $4, $5)`,
      [debitEntryId, txnId, sourceAccount.id, amount, newSourceBalance],
    );

    await client.query(
      `INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after)
       VALUES ($1, $2, $3, 'credit', $4, $5)`,
      [creditEntryId, txnId, destinationAccount.id, amount, newDestBalance],
    );

    // 10. Update cached balances on both accounts
    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [
      newSourceBalance,
      sourceAccount.id,
    ]);
    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [
      newDestBalance,
      destinationAccount.id,
    ]);

    // 11. COMMIT
    await client.query('COMMIT');

    // Return response with the user's new balance
    const userNewBalance =
      type === 'spend' ? newSourceBalance : newDestBalance;

    return {
      id: txnId,
      type,
      status: 'completed',
      amount,
      asset: asset.toUpperCase(),
      balanceAfter: userNewBalance,
      createdAt: new Date(),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getBalances(userId: string): Promise<BalanceResponse[]> {
  const result = await pool.query(
    `SELECT a.balance, at.symbol AS asset, at.name AS asset_name
     FROM accounts a
     JOIN asset_types at ON a.asset_type_id = at.id
     WHERE a.user_id = $1 AND a.account_type = 'user'
     ORDER BY at.symbol`,
    [userId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, `No wallets found for user: ${userId}`);
  }

  return result.rows.map((row) => ({
    asset: row.asset,
    assetName: row.asset_name,
    balance: parseFloat(row.balance),
  }));
}

export async function getTransactionHistory(
  userId: string,
): Promise<TransactionHistoryItem[]> {
  const result = await pool.query(
    `SELECT
       t.id, t.type, t.status, t.amount, t.reference_id, t.metadata, t.created_at,
       at.symbol AS asset,
       CASE
         WHEN t.destination_account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND account_type = 'user')
         THEN 'in'
         ELSE 'out'
       END AS direction,
       le.balance_after
     FROM transactions t
     JOIN asset_types at ON t.asset_type_id = at.id
     JOIN ledger_entries le ON le.transaction_id = t.id
     JOIN accounts a ON le.account_id = a.id AND a.user_id = $1 AND a.account_type = 'user'
     WHERE t.source_account_id IN (SELECT id FROM accounts WHERE user_id = $1)
        OR t.destination_account_id IN (SELECT id FROM accounts WHERE user_id = $1)
     ORDER BY t.created_at DESC`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    amount: parseFloat(row.amount),
    asset: row.asset,
    direction: row.direction,
    balanceAfter: parseFloat(row.balance_after),
    referenceId: row.reference_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}

export async function getTransactionById(
  txnId: string,
): Promise<TransactionResponse> {
  const result = await pool.query(
    `SELECT t.*, at.symbol AS asset
     FROM transactions t
     JOIN asset_types at ON t.asset_type_id = at.id
     WHERE t.id = $1`,
    [txnId],
  );

  if (result.rows.length === 0) {
    throw new AppError(404, `Transaction not found: ${txnId}`);
  }

  const txn = result.rows[0];

  // Get the destination account balance after this transaction
  const ledgerResult = await pool.query(
    `SELECT balance_after FROM ledger_entries
     WHERE transaction_id = $1 AND entry_type = 'credit'`,
    [txnId],
  );

  return {
    id: txn.id,
    type: txn.type,
    status: txn.status,
    amount: parseFloat(txn.amount),
    asset: txn.asset,
    balanceAfter: ledgerResult.rows.length > 0
      ? parseFloat(ledgerResult.rows[0].balance_after)
      : 0,
    createdAt: txn.created_at,
  };
}
