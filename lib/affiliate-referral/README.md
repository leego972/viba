# Affiliate Referral Module

Generic affiliate and referral engine for Viba module packaging.

## Included

- first-touch and last-touch attribution;
- fixed and basis-point percentage commissions;
- recurring commission limits;
- idempotent conversion recording;
- pending, approved, payable, paid, held and reversed states;
- refund and chargeback reversal;
- payout batch creation;
- PostgreSQL schema and indexes.

Money values use integer minor units. Percentage commission values use basis points, where `1500` equals 15%.

## Integration

Implement `AffiliateStore` using the host application's database transaction layer. Conversion recording should run inside a serializable transaction, with `idempotency_key` protected by the included unique constraint. Do not trust client-supplied commission values; load campaign rules server-side.

## Source provenance

Virelle Studios was inspected as the preferred source candidate. Its affiliate router currently supplies placeholder implementations for the underlying engine operations, so no placeholder logic was copied. Only its domain concepts informed this clean implementation.

## Verification

The dedicated GitHub Actions workflow performs frozen dependency installation, strict typechecking, compilation, compiled-runtime lifecycle tests, ZIP packaging and SHA-256 generation.
