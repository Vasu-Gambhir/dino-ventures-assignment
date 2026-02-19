-- ============================================================
-- Wallet Service — Schema + Seed Data
-- Double-entry ledger for virtual credits management
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

-- Virtual currency definitions
CREATE TABLE IF NOT EXISTS asset_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(10) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One account per user per asset type
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(50) NOT NULL,
    asset_type_id UUID NOT NULL REFERENCES asset_types(id),
    account_type VARCHAR(10) NOT NULL CHECK (account_type IN ('user', 'system')),
    balance DECIMAL(18,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, asset_type_id)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);

-- Transaction records (groups a pair of ledger entries)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('topup', 'bonus', 'spend')),
    status VARCHAR(10) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
    amount DECIMAL(18,4) NOT NULL CHECK (amount > 0),
    asset_type_id UUID NOT NULL REFERENCES asset_types(id),
    source_account_id UUID NOT NULL REFERENCES accounts(id),
    destination_account_id UUID NOT NULL REFERENCES accounts(id),
    reference_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source_account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_destination ON transactions(destination_account_id);

-- Immutable double-entry ledger records
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    entry_type VARCHAR(6) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
    amount DECIMAL(18,4) NOT NULL CHECK (amount > 0),
    balance_after DECIMAL(18,4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);

-- ============================================================
-- SEED DATA
-- ============================================================

-- 1. Asset Types
INSERT INTO asset_types (id, symbol, name) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'GOLD', 'Gold Coins'),
    ('a0000000-0000-0000-0000-000000000002', 'DIAMOND', 'Diamonds'),
    ('a0000000-0000-0000-0000-000000000003', 'LOYALTY', 'Loyalty Points')
ON CONFLICT (symbol) DO NOTHING;

-- 2. Treasury (system) accounts — one per asset type with large initial balance
INSERT INTO accounts (id, user_id, asset_type_id, account_type, balance) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'treasury', 'a0000000-0000-0000-0000-000000000001', 'system', 1000000),
    ('b0000000-0000-0000-0000-000000000002', 'treasury', 'a0000000-0000-0000-0000-000000000002', 'system', 1000000),
    ('b0000000-0000-0000-0000-000000000003', 'treasury', 'a0000000-0000-0000-0000-000000000003', 'system', 1000000)
ON CONFLICT (user_id, asset_type_id) DO NOTHING;

-- 3. User accounts
-- user_1 accounts
INSERT INTO accounts (id, user_id, asset_type_id, account_type, balance) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'user_1', 'a0000000-0000-0000-0000-000000000001', 'user', 1000),
    ('c0000000-0000-0000-0000-000000000002', 'user_1', 'a0000000-0000-0000-0000-000000000002', 'user', 500),
    ('c0000000-0000-0000-0000-000000000003', 'user_1', 'a0000000-0000-0000-0000-000000000003', 'user', 200)
ON CONFLICT (user_id, asset_type_id) DO NOTHING;

-- user_2 accounts
INSERT INTO accounts (id, user_id, asset_type_id, account_type, balance) VALUES
    ('c0000000-0000-0000-0000-000000000004', 'user_2', 'a0000000-0000-0000-0000-000000000001', 'user', 1000),
    ('c0000000-0000-0000-0000-000000000005', 'user_2', 'a0000000-0000-0000-0000-000000000002', 'user', 500),
    ('c0000000-0000-0000-0000-000000000006', 'user_2', 'a0000000-0000-0000-0000-000000000003', 'user', 200)
ON CONFLICT (user_id, asset_type_id) DO NOTHING;

-- 4. Seed initial balances via ledger entries (for ledger consistency)
-- Each user's initial balance is a "topup" from treasury

-- Seed transactions for user_1
INSERT INTO transactions (id, idempotency_key, type, status, amount, asset_type_id, source_account_id, destination_account_id, reference_id, metadata) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'seed-user1-gold',    'topup', 'completed', 1000, 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'seed', '{"note":"initial seed"}'),
    ('d0000000-0000-0000-0000-000000000002', 'seed-user1-diamond', 'topup', 'completed', 500,  'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'seed', '{"note":"initial seed"}'),
    ('d0000000-0000-0000-0000-000000000003', 'seed-user1-loyalty', 'topup', 'completed', 200,  'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'seed', '{"note":"initial seed"}')
ON CONFLICT (idempotency_key) DO NOTHING;

-- Seed transactions for user_2
INSERT INTO transactions (id, idempotency_key, type, status, amount, asset_type_id, source_account_id, destination_account_id, reference_id, metadata) VALUES
    ('d0000000-0000-0000-0000-000000000004', 'seed-user2-gold',    'topup', 'completed', 1000, 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'seed', '{"note":"initial seed"}'),
    ('d0000000-0000-0000-0000-000000000005', 'seed-user2-diamond', 'topup', 'completed', 500,  'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000005', 'seed', '{"note":"initial seed"}'),
    ('d0000000-0000-0000-0000-000000000006', 'seed-user2-loyalty', 'topup', 'completed', 200,  'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000006', 'seed', '{"note":"initial seed"}')
ON CONFLICT (idempotency_key) DO NOTHING;

-- Ledger entries for user_1 seed transactions
-- Gold: treasury debited 1000, user_1 credited 1000
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'debit',  1000, 999000),
    ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'credit', 1000, 1000)
ON CONFLICT DO NOTHING;

-- Diamond: treasury debited 500, user_1 credited 500
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES
    ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'debit',  500, 999500),
    ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'credit', 500, 500)
ON CONFLICT DO NOTHING;

-- Loyalty: treasury debited 200, user_1 credited 200
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES
    ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'debit',  200, 999800),
    ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'credit', 200, 200)
ON CONFLICT DO NOTHING;

-- Ledger entries for user_2 seed transactions
-- Gold: treasury debited 1000, user_2 credited 1000
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES
    ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'debit',  1000, 998000),
    ('e0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'credit', 1000, 1000)
ON CONFLICT DO NOTHING;

-- Diamond: treasury debited 500, user_2 credited 500
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES
    ('e0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'debit',  500, 999000),
    ('e0000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'credit', 500, 500)
ON CONFLICT DO NOTHING;

-- Loyalty: treasury debited 200, user_2 credited 200
INSERT INTO ledger_entries (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES
    ('e0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000003', 'debit',  200, 999600),
    ('e0000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000006', 'credit', 200, 200)
ON CONFLICT DO NOTHING;
