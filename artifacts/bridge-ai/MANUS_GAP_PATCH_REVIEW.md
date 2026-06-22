# VIBA Gap Patch Review — Manus Handoff

## Product position

VIBA should not become another crowded AI chat app. The upgraded product position is:

> VIBA turns ideas into verified, monetisable business assets through coordinated agents, proof gates, and clear next actions.

## Hard UI rule

Every visible button must do one of these only:

1. Open a real route.
2. Start a real workflow.
3. Copy/export a real asset.
4. Trigger a real backend/client action.

Remove or hide anything that does not meet that rule.

## Game-changing gaps patched in this branch

### 1. Proof before done

Patched in:

- `src/pages/bridge.tsx`
- `src/pages/workbench.tsx`

Expected behaviour:

- Growth Engine shows proof gates.
- Workbench shows a Submission Quality Gate.
- Output should not be positioned as ready unless the proof/review state supports it.

### 2. Business Asset Ledger

Patched in:

- `src/pages/bridge.tsx`

Expected behaviour:

- Growth Engine creates a structured asset record with asset name, status, revenue path, and next action.
- Future backend should persist this as a first-class asset table, but do not add a cluttered menu until persistence exists.

Suggested later backend model:

```ts
type BusinessAsset = {
  id: string;
  userId: string;
  name: string;
  type: "growth" | "code" | "report" | "campaign" | "deployment" | "client-proof";
  status: "draft" | "validate" | "ready" | "scale" | "blocked";
  buyer?: string;
  proofSummary?: string;
  revenuePath?: string;
  nextAction?: string;
  sourceSessionId?: number;
  sourceRepoUrl?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 3. Revenue path attached to work

Patched in:

- `src/pages/bridge.tsx`
- `src/pages/home.tsx`

Expected behaviour:

- Growth Engine shows report → repair sprint → retainer path.
- Pricing is dynamically scored.
- Landing page frames VIBA around monetisable business assets, not generic AI chat.

### 4. Agent Tribunal

Patched in:

- `src/pages/bridge.tsx`

Expected behaviour:

- Agent chain appears as Strategist, Builder, Tester, Critic, Risk Officer, Monetiser, Verifier.
- These are not fake buttons; they are the operating model and prompt handoff logic.

Future safe enhancement:

- Wire tribunal roles into New Session templates after typecheck confirms role values are compatible.

### 5. Next Best Action

Patched in:

- `src/pages/bridge.tsx`

Expected behaviour:

- Score generates a practical next action.
- Do not add an extra dashboard module unless there is a real persisted asset source.

### 6. Evidence packet / client-ready proof export

Patched in:

- `src/pages/workbench.tsx`

Expected behaviour:

- Workbench has a real `Packet` button.
- It copies a review packet with task ID, platform, confidence, quality gate, answer, reasoning, risk flags, rubric checklist, and manual review checklist.

### 7. No-dead-button precision UX

Patched across:

- `src/pages/bridge.tsx`
- `src/pages/workbench.tsx`
- `src/pages/home.tsx`

Expected behaviour:

- Growth Engine buttons are real: start session, copy command prompt, copy campaign assets.
- Workbench buttons are real: analyze, packet, copy, mark used, load history, clear history.
- Landing buttons route to existing pages.

### 8. Private opportunity engine

Patched in:

- `src/pages/bridge.tsx`
- `src/pages/home.tsx`

Expected behaviour:

- No public shame board.
- No public naming/ranking/mocking.
- Opportunity work is private-by-design.

### 9. Verified monetisation workflow for AI-built products

Patched in:

- `src/pages/bridge.tsx`

Expected behaviour:

- User sees whether an opportunity is Draft, Validate, Ready, or Scale.
- User sees proof gates and revenue path before selling.

### 10. Operator memory as structured assets

Partially patched in:

- `src/pages/bridge.tsx`
- This handoff document

Important:

- Do not fake persistence.
- Until backend persistence exists, keep this as a structured on-page ledger and copyable command prompt.
- Next real backend patch should create asset persistence, not another UI panel.

## Files changed by this branch

Expected changed files:

- `src/pages/bridge.tsx`
- `src/pages/workbench.tsx`
- `src/pages/home.tsx`
- `MANUS_GAP_PATCH_REVIEW.md`

## Build checks Manus should run

From `artifacts/bridge-ai`:

```bash
pnpm install
pnpm typecheck
pnpm build
```

If typecheck fails, inspect first:

1. `WorkbenchAnalyzeRequest["taskType"]` typing in `src/pages/workbench.tsx`.
2. `routingReceipt` cast shapes in `src/pages/workbench.tsx`.
3. `lucide-react` icons imported in `src/pages/bridge.tsx` and `src/pages/workbench.tsx`.
4. Any strict status union mismatch around `Draft | Validate | Ready | Scale`.

## What not to add

Do not add:

- More nav items.
- More dashboard widgets without persistence.
- Coming-soon buttons.
- Public audit/shame-board mechanics.
- Fake verification states.
- Guaranteed revenue claims.

## Next high-value backend patch

Only after build passes:

1. Add persistent `business_assets` storage.
2. Add backend endpoints for create/list/update asset.
3. Surface assets on Dashboard only when real data exists.
4. Add exportable proof report generation.
5. Tie asset records to sessions and repos.
