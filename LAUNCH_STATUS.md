# VIBA Launch Status

Date: 2026-06-28
Status: Not production-cleared yet.

## Current position

VIBA is a serious multi-agent AI collaboration platform under active build. It should be described as a controlled AI collaboration system for project work, not as a casual chatbot or loose multi-AI chatroom.

## Production claim rule

Do not claim that VIBA is production-ready until all critical checks below have passed in the real Replit/Railway environment.

## Required before production launch

- [ ] `pnpm install --frozen-lockfile` passes
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run build` passes
- [ ] API server starts in production mode
- [ ] Frontend static build is served correctly
- [ ] Signup works
- [ ] Login works
- [ ] Logout works
- [ ] Pricing page works
- [ ] Stripe checkout works in test mode
- [ ] Billing state updates correctly
- [ ] User cannot access another user's session
- [ ] User cannot access admin maintenance routes
- [ ] User cannot operate VIBA source-repair routes
- [ ] Project Doctor runs without mutation in diagnostic mode
- [ ] Approval gates are verified before sensitive actions
- [ ] Budget cap behavior is verified
- [ ] Proof/report pages load correctly
- [ ] Mobile layout is verified on iPhone/Safari-style viewport
- [ ] Railway deploy passes
- [ ] `viba.guru` and/or `www.viba.guru` resolve correctly
- [ ] No secrets are committed

## Safe public wording before full clearance

Use:

> VIBA is a controlled AI collaboration platform being prepared for production launch.

Do not use:

> Fully production ready.
> Guaranteed autonomous repairs.
> Fully verified billing.
> Fully secure.
> No-risk AI automation.

## Current priority order

1. Keep the landing page precise: AI collaboration is central, control is the differentiator.
2. Verify build/typecheck.
3. Fix repository identity references from legacy `bridge-ai` wording to `viba` where those references are no longer historically intentional.
4. Verify Project Doctor diagnostic mode.
5. Implement Value Router scoring.
6. Implement adaptive workflow planning.
7. Verify approval gates and proof reports.

## Owner merge rule

Only merge a gap-fix PR after Replit or local build validation has passed and the owner approves the merge.
