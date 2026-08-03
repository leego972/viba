# Provenance

This package begins as an audited extraction from Viba's existing adapter retry and circuit-breaker implementation.

## Reviewed source

- `artifacts/api-server/src/lib/adapterRetry.ts`

## Reused concepts

- Bounded retry attempts.
- Delay between transient failures.
- Permanent-error classification.
- Consecutive-failure circuit opening.
- Open, half-open and closed circuit states.
- Injectable time for deterministic testing.

## Removed project-specific assumptions

- Agent, task and AI-provider domain types.
- Groq-specific fallback behavior.
- Dynamic imports of the Viba database package.
- Environment-variable configuration inside reusable logic.
- Global mutable circuit maps.
- Logger and audit-event coupling.
- Silent database persistence failures.

## Result

The extracted primitives are provider-neutral and dependency-free. Persistence, job leasing, scheduling, cancellation, progress, idempotency and dead-letter handling will be layered around explicit repository interfaces rather than embedded application globals.
