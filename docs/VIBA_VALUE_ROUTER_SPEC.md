# VIBA Value Router Spec

Date: 2026-06-28

## Purpose

The current routing model should evolve from simple capability matching into a Value Router.

The Value Router chooses the best agent or provider for a task based on fit, cost, reliability, tool access, risk, and expected value.

## Why this matters

Leading AI orchestration products will not win by calling the strongest model every time. They will win by getting reliable work done at the lowest acceptable cost with the least risk.

## Scoring inputs

Each candidate agent should be scored with:

- task capability fit
- model/provider strength for that task type
- tool availability
- estimated cost
- remaining user budget
- prior success rate
- latency expectation
- approval requirement
- data sensitivity
- fallback availability

## Recommended score shape

Final score should reward high task fit, successful history, tool availability, and low cost.

Final score should penalise missing tools, high cost, high risk, poor reliability, and unnecessary escalation to expensive providers.

## Required behaviour

1. Cheap deterministic checks run before paid model calls where possible.
2. Low-cost agents handle simple classification, planning, summarisation, and checklist work.
3. Expensive agents are reserved for high-value reasoning, repair planning, final QA, and hard blockers.
4. Tool-capable agents receive tool-required tasks.
5. Sensitive tasks trigger approval before execution.
6. If a provider fails, the router should choose the next best fallback.

## Data to persist later

- provider name
- model name
- task type
- estimated cost
- actual cost if known
- success/failure
- latency
- fallback used
- user approval status

## First safe implementation step

Add a pure function that accepts task, agents, budget state, and provider history, then returns a ranked list of candidates with reasons.

Do not wire it into execution until unit tests pass.

## Acceptance criteria

- Router can explain why an agent was chosen.
- Router can explain why an expensive model was not chosen.
- Router prefers cheap checks before paid calls.
- Router blocks tool-required tasks from text-only agents unless a handoff exists.
- Router has unit tests for cost, capability, fallback, and approval scenarios.
