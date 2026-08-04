# Extraction provenance

## Audited sources

1. `leego972/virellestudios`
   - file: `server/_core/rateLimit.ts`
   - source commit: `8c8bc2d44da8c87c03fe12daccc88ce05d872db4`
2. `leego972/PeacemakerAI`
   - file: `artifacts/api-server/src/middlewares/rateLimit.ts`
   - source commit: `cbb662bef2dfbaf43a775de621dca6e916046252`

## Retained concepts

- fixed-window request counting;
- store abstraction suitable for Redis or memory implementations;
- deterministic reset and retry-after values;
- standard rate-limit response headers;
- separate named policies for different API operations;
- injectable time for deterministic tests.

## Removed or replaced

- tRPC and Express coupling;
- direct Redis client construction;
- logger and process-environment coupling;
- global admin bypass state;
- app-specific courtroom and media-generation messages;
- silent fallback from distributed Redis to per-process memory storage.

Production consumers must explicitly select a distributed store. The included memory store is for tests and single-process development only.
