# VIBA Asset Ledger Spec

## Purpose

The Asset Ledger is the core VIBA differentiator. It turns AI work into structured business assets instead of leaving value trapped in chat history.

The ledger should not be a cluttered UI feature. It should be a backend-backed record that appears on the Dashboard only when real assets exist.

## Core asset lifecycle

```text
Draft → Validate → Ready → Scale → Maintained
```

Failure states:

```text
Blocked → Needs Proof → Needs Owner Review
```

## Asset record fields

```ts
export type BusinessAssetStatus =
  | "draft"
  | "validate"
  | "ready"
  | "scale"
  | "maintained"
  | "blocked"
  | "needs_proof"
  | "needs_owner_review";

export type BusinessAssetType =
  | "growth_engine"
  | "code_patch"
  | "app_build"
  | "report"
  | "campaign"
  | "client_proof"
  | "deployment"
  | "workflow";

export type BusinessAsset = {
  id: string;
  userId: string;
  name: string;
  type: BusinessAssetType;
  status: BusinessAssetStatus;
  summary: string;
  buyer?: string;
  customerNeed?: string;
  proofSummary?: string;
  revenuePath?: string;
  nextAction?: string;
  riskLevel?: "low" | "medium" | "high";
  score?: number;
  sourceSessionId?: number;
  sourceRepoUrl?: string;
  sourceBranch?: string;
  sourceRoute?: string;
  createdAt: string;
  updatedAt: string;
};
```

## Proof gate fields

```ts
export type ProofGate = {
  id: string;
  assetId: string;
  name: string;
  state: "required" | "ready" | "strong" | "failed";
  evidenceText?: string;
  evidenceUrl?: string;
  createdAt: string;
  updatedAt: string;
};
```

## Minimum backend endpoints

```text
GET    /api/assets
POST   /api/assets
GET    /api/assets/:id
PATCH  /api/assets/:id
POST   /api/assets/:id/proof-gates
PATCH  /api/assets/:id/proof-gates/:gateId
```

## Dashboard behaviour

Only show the Asset Ledger on Dashboard when at least one real asset exists.

Dashboard asset card should show:

```text
Asset name
Status
Score
Proof state
Revenue path
Next action
Open source session
Open source repo, if available
```

## Growth Engine behaviour

The current Growth Engine already calculates:

```text
Asset name
Score
Status
Revenue path
Proof gates
Next action
Command prompt
Campaign assets
```

Next backend patch should allow `Save asset` only after `POST /api/assets` exists. Do not add a fake save button before persistence exists.

## Workbench behaviour

The Workbench Review Packet should eventually be attached as a `client_proof` asset or proof gate evidence.

## No-clutter rule

Do not add:

- A new nav item until backend persistence exists.
- Multiple asset tabs.
- Fake progress bars.
- Placeholder export buttons.
- Any button that does not trigger a real route, copy/export action, or backend mutation.

## Best first implementation

1. Add database table for `business_assets`.
2. Add database table for `asset_proof_gates`.
3. Add API client methods.
4. Add a real `Save asset` button to Growth Engine.
5. Add Dashboard ledger only when real assets exist.
6. Add exportable proof report after assets persist.
