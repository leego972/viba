# VIBA Game-Changer UI Rules

All major VIBA features must keep the UI clean, calm, and non-overwhelming. Power belongs in the workflow logic, not in visual clutter.

This applies to:

- GitHub/Railway Doctor mode
- credit quote before action
- credit receipt after action
- budget cap per session
- pause/resume after top-up
- complexity badges
- before/after proof reports
- agent handoff timeline
- background progress
- next-action preview
- future debate/disagreement panels

## 1. Main principle

Each screen must answer one question:

```txt
What is happening, what will it cost, and what should I do next?
```

If a screen cannot answer that clearly, simplify it.

## 2. Default visual structure

Use this hierarchy:

1. **Primary status card** — current state and next best action.
2. **One primary CTA** — the main action.
3. **Small secondary action** — optional, lower emphasis.
4. **Expandable details** — logs, receipts, raw findings, advanced controls.

Do not show every technical detail by default.

## 3. Doctor mode UI

Doctor mode should start simple:

```txt
Connect / select repo
Select deployment provider
Run cheap diagnostic
Review findings
Approve deeper analysis or repair
```

Default Doctor result layout:

1. Health score.
2. Top 3 blockers.
3. Estimated credit cost to continue.
4. Recommended next action.
5. Expandable evidence.
6. Expandable raw logs.

Do not show a giant wall of CI logs, env names, routes, files, and provider details all at once.

## 4. Credit and finance UI

Finance UI must be clearer than normal product UI.

Always show:

```txt
current credits
estimated action cost
remaining credits after action
whether auto top-up is off/on
whether billable execution is locked
```

Never hide:

```txt
charge amount
credit amount
payment failure
lock state
renewal/reset behaviour
```

Auto top-up UI must be opt-in and explicit:

```txt
Auto top-up is OFF by default.
Turn on auto top-up?
Pack: $50 / 1,000 credits
Trigger: when credits fall below 100
Limit: max 1 automatic top-up per billing period
```

Use confirmation text before enabling:

```txt
I authorise VIBA to top up my account using my saved Stripe payment method when my credits fall below the selected limit, up to my selected maximum per billing period.
```

## 5. Budget cap UI

Budget controls must be visible before background/full-run execution.

Required fields:

```txt
Session budget cap
Estimated credit range
Stop behaviour when cap is reached
```

Default:

```txt
Budget cap: required for background full-run
Stop when cap is reached: yes
Ask before increasing budget: yes
```

## 6. Receipts and proof reports

Receipt cards should be compact by default:

```txt
Task completed
Agent used
Credits spent
Remaining balance
Evidence status
```

Expandable receipt details:

```txt
files changed
logs checked
tests run
warnings
raw agent output
```

Proof reports should use red/yellow/green evidence labels:

```txt
Green: verified by tool/test/log
Yellow: inferred from available evidence
Red: unverified or blocked
```

## 7. Agent timeline UI

Agent orchestration should feel visible but not noisy.

Show only major events by default:

```txt
Task assigned
Agent produced result
Handoff occurred
Approval required
Credits spent
Task completed
```

Hide low-level polling, retries, and token/model noise under advanced details.

## 8. Complexity badges

Use simple labels:

```txt
Low
Medium
High
Heavy
```

Do not expose complex formulas in the main UI. Put formula details in tooltip/help text.

Example:

```txt
High complexity · estimated 120 credits
```

## 9. Progressive disclosure rule

Every advanced feature must follow this pattern:

```txt
Simple summary first
Action button second
Advanced evidence/details behind expand/collapse
```

Never put:

- all env vars on the main screen
- full logs by default
- raw JSON by default
- every agent thought/action by default
- more than two primary-looking buttons in one panel

## 10. Mobile rule

Mobile views must be stricter than desktop.

Mobile default:

1. One status card.
2. One primary button.
3. One compact progress row.
4. Expandable details.

No three-column layouts on mobile. No dense tables as default mobile views.

## 11. Language rules

Use plain operational language:

```txt
Ready to run
Blocked
Needs payment
Needs approval
Safe mode on
Credits low
Repair proposed
Evidence verified
```

Avoid vague language:

```txt
Processing magic
AI is thinking deeply
Something went wrong
Advanced intelligence layer activated
```

## 12. Build acceptance criteria

A feature is not accepted if:

- the first screen is visually crowded,
- the user cannot identify the next action in 3 seconds,
- costs are hidden behind a modal,
- failure states are vague,
- raw logs dominate the screen,
- finance controls are ambiguous,
- mobile layout feels like squeezed desktop.

## 13. Required review before merge

Before merging any major game-changer UI, verify:

```txt
Desktop layout clean
Mobile layout clean
Primary CTA obvious
Finance/cost info visible
Advanced details collapsible
Failure states clear
No hidden financial behaviour
No overwhelming default log output
```
