# Generic Credit Ledger

A reusable immutable credit ledger for purchased, promotional and earned credits.

## Included

- Grants, purchases, debits, refunds and adjustments
- Available and reserved balances
- Reservation, partial capture and partial release
- Idempotency keys
- PostgreSQL schema
- In-memory reference store for tests and demos
- Strict TypeScript declarations

## Design rules

Amounts are positive integer `bigint` values. Every operation appends a ledger entry; balances are derived from entry deltas rather than updated in place. Production stores must enforce idempotency and transactional balance checks at the database layer.

## Commands

```bash
pnpm --filter @viba/credit-ledger test
pnpm --filter @viba/credit-ledger build
```

## Production integration

Implement `CreditLedgerStore` with PostgreSQL transactions and row or advisory locking for account mutations. Apply `migrations/001_credit_ledger.sql`, then inject the store and a collision-resistant ID generator.

The package contains no Viba-specific pricing, plan or route assumptions.
