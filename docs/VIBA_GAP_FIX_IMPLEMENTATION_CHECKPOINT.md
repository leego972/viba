# VIBA Gap Fix Implementation Checkpoint

Branch: `viba-landing-positioning-cleanup`
Date: 2026-06-28

## Decision

AI collaboration remains a main VIBA feature. The product should not be positioned as a loose multi-AI chatroom. It should be positioned as a controlled AI collaboration system for project work.

## Precise product wording

VIBA coordinates specialist AI agents in one controlled workspace. Agents can divide tasks, ask each other focused questions, review outputs, route work to the right model or tool, and keep the user in control through approvals, budget caps, audit trails, and proof reports.

## Landing page goal

The landing page should communicate these points clearly and without clutter:

1. AI collaboration is central.
2. Control is the differentiator.
3. Doctor, approval gates, budget control, and proof reports make the collaboration safer and more commercially useful.
4. VIBA is for serious project work, not casual chatbot use.

## Safe implementation rules

Replit should validate before merge:

```bash
pnpm run typecheck
pnpm --filter @workspace/bridge-ai run build
pnpm --filter @workspace/api-server run build
```

Do not merge if the landing page change breaks routing, build, auth, billing, or session workflow.

## Gap fix status

- [x] Product wording clarified.
- [x] AI collaboration confirmed as central feature.
- [ ] Landing page copy updated.
- [ ] Build/typecheck verified by Replit.
- [ ] Replit final review complete.
- [ ] Owner merge approved.
