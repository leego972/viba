# Extraction provenance

## Audited source

- Repository: `leego972/virellestudios`
- File: `server/storage.ts`
- Source commit: `8c8bc2d44da8c87c03fe12daccc88ce05d872db4`

## Retained concepts

- explicit media versus permanent asset storage classes;
- centralized bucket routing;
- defensive maximum-object-size enforcement;
- normalized object keys;
- adapter operations for put, delete, head and signed download URLs;
- bounded signed-URL expiry.

## Removed or replaced

- direct environment-variable reads;
- AWS SDK and Manus FORGE coupling;
- global cached clients;
- implicit public-read defaults;
- Render-specific configuration messages;
- backend fallback selection inside the domain service.

The extracted module uses an injected adapter and defaults objects to private. Provider-specific S3/R2 adapters will be implemented separately.
