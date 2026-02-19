# Wallet Service

Internal closed-loop wallet service for managing virtual credits (Gold Coins, Diamonds, Loyalty Points) with strict data integrity guarantees.

## Tech Stack

| Technology | Purpose |
|---|---|
| **Node.js + TypeScript** | Runtime & type safety |
| **Express** | HTTP framework |
| **PostgreSQL 16** | Primary data store |
| **Docker + Docker Compose** | Containerization |
| **Render** | Cloud deployment |

### Why these choices?

- **PostgreSQL** — ACID transactions, row-level locking (`SELECT ... FOR UPDATE`), and JSONB support make it ideal for financial-grade data integrity.
- **Double-entry ledger** — Every transaction creates exactly two immutable ledger entries (debit + credit), ensuring the books always balance.
- **TypeScript** — Catches type errors at compile time, critical for a service handling monetary values.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Express App                       │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐                 │
│  │  /wallets    │  │ /transactions│   Routes        │
│  └──────┬──────┘  └──────┬───────┘                 │
│         │                │                          │
│  ┌──────┴──────┐  ┌──────┴───────┐                 │
│  │   Wallet    │  │ Transaction  │   Controllers   │
│  │ Controller  │  │ Controller   │                 │
│  └──────┬──────┘  └──────┬───────┘                 │
│         │                │                          │
│         └───────┬────────┘                          │
│          ┌──────┴───────┐                           │
│          │   Wallet     │   Service (core logic)    │
│          │   Service    │                           │
│          └──────┬───────┘                           │
│                 │                                   │
│          ┌──────┴───────┐                           │
│          │  PostgreSQL   │   Database               │
│          │  (pg Pool)    │                           │
│          └──────────────┘                           │
└─────────────────────────────────────────────────────┘
```

### Double-Entry Ledger Model

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  asset_types │     │   accounts   │     │ transactions │
│──────────────│     │──────────────│     │──────────────│
│ GOLD         │◄────│ treasury/GOLD│◄────│ idempotency  │
│ DIAMOND      │     │ user_1/GOLD  │     │ source_acct  │
│ LOYALTY      │     │ user_2/GOLD  │     │ dest_acct    │
└──────────────┘     │ ...          │     │ amount       │
                     └──────┬───────┘     └──────┬───────┘
                            │                    │
                     ┌──────┴────────────────────┴───┐
                     │         ledger_entries         │
                     │───────────────────────────────│
                     │ debit  (source, -amount)      │
                     │ credit (destination, +amount) │
                     └───────────────────────────────┘
```

For every transaction, exactly **2 ledger entries** are created:

| Flow | Source (Debit) | Destination (Credit) |
|---|---|---|
| **Top-up** | Treasury | User |
| **Bonus** | Treasury | User |
| **Spend** | User | Treasury |

## Running the Service

### With Docker (recommended)

```bash
docker-compose up --build
```

This starts both PostgreSQL and the app. The database is automatically initialized with schema and seed data.

The service will be available at `http://localhost:3000`.

### Local Development

1. Start a PostgreSQL instance and create a database.

2. Copy `.env.example` to `.env` and set your `DATABASE_URL`:
   ```bash
   cp .env.example .env
   ```

3. Initialize the database:
   ```bash
   psql $DATABASE_URL -f init.sql
   ```

4. Install dependencies and run:
   ```bash
   npm install
   npm run dev
   ```

## API Documentation

### Health Check

```bash
curl http://localhost:3000/health
```

### Get User Balances

```bash
curl http://localhost:3000/api/v1/wallets/user_1/balances
```

**Response:**
```json
{
  "userId": "user_1",
  "balances": [
    { "asset": "DIAMOND", "assetName": "Diamonds", "balance": 500 },
    { "asset": "GOLD", "assetName": "Gold Coins", "balance": 1000 },
    { "asset": "LOYALTY", "assetName": "Loyalty Points", "balance": 200 }
  ]
}
```

### Top-up Wallet

```bash
curl -X POST http://localhost:3000/api/v1/transactions/topup \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_1",
    "asset": "GOLD",
    "amount": 500,
    "idempotencyKey": "topup-001"
  }'
```

**Response (201):**
```json
{
  "id": "txn-uuid",
  "type": "topup",
  "status": "completed",
  "amount": 500,
  "asset": "GOLD",
  "balanceAfter": 1500,
  "createdAt": "2026-02-18T..."
}
```

### Grant Bonus

```bash
curl -X POST http://localhost:3000/api/v1/transactions/bonus \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_1",
    "asset": "DIAMOND",
    "amount": 100,
    "idempotencyKey": "bonus-001",
    "referenceId": "promo_feb_2026",
    "metadata": { "campaign": "welcome_bonus" }
  }'
```

### Spend Credits

```bash
curl -X POST http://localhost:3000/api/v1/transactions/spend \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_1",
    "asset": "GOLD",
    "amount": 200,
    "idempotencyKey": "spend-001"
  }'
```

**Error — Insufficient Balance (400):**
```bash
curl -X POST http://localhost:3000/api/v1/transactions/spend \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_1",
    "asset": "GOLD",
    "amount": 999999,
    "idempotencyKey": "spend-fail-001"
  }'
# → { "error": "Insufficient balance" }
```

### Get Transaction by ID

```bash
curl http://localhost:3000/api/v1/transactions/<transaction-id>
```

### Get User Transaction History

```bash
curl http://localhost:3000/api/v1/wallets/user_1/transactions
```

## Concurrency Strategy

### Problem
Two concurrent requests for the same user could read stale balances and produce incorrect results (lost updates / overdrafts).

### Solution: Row-Level Locking with Consistent Ordering

```sql
SELECT * FROM accounts WHERE id IN ($source, $dest) ORDER BY id FOR UPDATE
```

- **`FOR UPDATE`** acquires exclusive row locks within the transaction, blocking other transactions until commit.
- **`ORDER BY id`** ensures locks are always acquired in the same order (ascending UUID), regardless of which account is source or destination.

### Why This Prevents Deadlocks

A deadlock occurs when Transaction A locks Account 1 then waits for Account 2, while Transaction B locks Account 2 then waits for Account 1. By always locking in ascending ID order, both transactions attempt to lock Account 1 first — one succeeds, the other waits. No circular dependency is possible.

## Idempotency

Every transaction endpoint requires an `idempotencyKey` field.

1. The key has a `UNIQUE` constraint in the database.
2. Before processing, the service checks if a transaction with that key already exists.
3. If found, the original result is returned (HTTP 200) without re-processing.
4. This protects against network retries, double-clicks, and duplicate webhook deliveries.

## Seed Data

The database is initialized with:

| Entity | Details |
|---|---|
| **Asset Types** | GOLD (Gold Coins), DIAMOND (Diamonds), LOYALTY (Loyalty Points) |
| **Treasury** | System account per asset type with 1,000,000 initial balance |
| **user_1** | 1,000 Gold, 500 Diamonds, 200 Loyalty Points |
| **user_2** | 1,000 Gold, 500 Diamonds, 200 Loyalty Points |

All initial balances are established through proper ledger entries for full audit trail consistency.

## Deployment (Render)

The project includes a `render.yaml` Blueprint for one-click deployment:

1. Push the repository to GitHub.
2. In Render dashboard, click **New → Blueprint** and connect your repo.
3. Render will provision a PostgreSQL database and web service automatically.
4. After deployment, run the init SQL against the Render database to seed data:
   ```bash
   psql <RENDER_DATABASE_URL> -f init.sql
   ```

The `render.yaml` configures:
- **Free-tier PostgreSQL** database
- **Free-tier Web Service** with auto-build (`npm install && npm run build`)
- Environment variables wired automatically between services
