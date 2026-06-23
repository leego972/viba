# VIBA Final Typecheck Notes

This file lists small build-risk items for Manus to check after the feature patches.

## Likely strict TypeScript cleanup items

### `src/pages/new-session.tsx`

Check whether `CardFooter` is still imported from `@/components/ui/card`.

If it is imported and unused, remove it:

```ts
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
```

### `src/pages/bridge.tsx`

Check whether any lucide icons are imported but unused.

Likely import to inspect:

```ts
TrendingUp
```

If unused, remove it from the import list.

### `src/pages/home.tsx`

The landing import was cleaned in this branch, but Manus should still confirm no unused lucide icons remain after final build.

## Do not fix by weakening TypeScript

Do not disable:

```json
noUnusedLocals
noUnusedParameters
strict
```

Fix the file imports/types instead.

## Correct acceptance condition

The work is acceptable only when:

```bash
pnpm typecheck
pnpm build
```

both pass from `artifacts/bridge-ai`.
