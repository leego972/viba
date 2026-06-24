# VIBA Credit Implementation TODO

## Target values

- Membership: USD 50 per month.
- Evaluation period: 3 days.
- Evaluation allowance: 260 credits.
- Monthly included allowance: 500 credits.
- Extra credit pack: 500 credits for USD 50.

## Credit estimates

| Workflow type | Estimate |
|---|---:|
| Project review with written findings | 180-260 credits |
| Small repair | 60-120 credits |
| 2-3 small repairs | 180-300 credits |
| Full review plus multi-step repair cycle | 550-700 credits |

## Required product behavior

When credits run out during a background workflow, pause the session and show:

- add 500 credits for USD 50;
- wait until monthly credits renew.

## Already added in this branch

- server-side background session runner;
- run state endpoint;
- credit-aware pause behavior for background runs;
- visible credit balance pill in web navigation;
- visible credit balance pill in mobile shell;
- full-parity mobile shell remains active for Android and iOS.

## Remaining direct code patch

Patch `artifacts/api-server/src/lib/billing.ts`:

```txt
VIBA_PLAN.unitAmount = 5000
VIBA_PLAN.monthlyCredits = 500
VIBA_PLAN.trialDays = 3
CREDIT_PACKS = [{ key: credits_500, credits: 500, unitAmount: 5000 }]
```

Patch `artifacts/bridge-ai/src/pages/pricing.tsx`:

```txt
change 7-day copy to 3-day copy
change 1,000 credits per month to 500 credits per month
show one 500-credit USD 50 pack
```

Patch `artifacts/bridge-ai/src/pages/signup.tsx`:

```txt
on email account creation, send the user to the membership checkout flow or pricing fallback
show clear trial and cancellation text
```
