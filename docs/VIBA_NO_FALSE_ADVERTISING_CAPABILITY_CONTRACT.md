# VIBA No-False-Advertising Capability Contract

Branch: `feature/viba-builder-toolbox`

## Rule

VIBA must not tell a user that a capability is complete unless the toolbox can either execute it now or clearly labels it as planning-only, credential-required, external-setup-required, or adapter-required.

## Capability statuses

| Status | Meaning | Can be marketed as live? |
|---|---|---|
| `executable` | Broker can perform the operation through current code, subject to policy gates. | Yes, with limits. |
| `planning_only` | Tool produces structured plans/specs/checklists but does not change code or infrastructure. | Yes, only as planning/spec capability. |
| `credential_required` | Tool needs provider credentials before it can run. | Yes, only with setup requirement disclosed. |
| `external_setup_required` | Provider/project setup is required first. | No, unless setup requirement is visible. |
| `adapter_required` | Tool is registered or planned, but the live adapter is not complete. | No. Must be shown as not live yet. |

## Added code

`artifacts/api-server/src/lib/toolCapabilityMatrix.ts`

This module:

- inspects existing registry tools plus builder tools,
- classifies each tool truthfully,
- provides a summary count,
- provides job-type routing so Groq/Gemini can choose the right tool sequence,
- returns `rawValuesReturned: false`.

`artifacts/api-server/src/lib/toolCapabilityMatrix.test.ts`

This test ensures:

- builder tools are not falsely marked as full execution tools,
- build/deploy tools requiring live adapters are marked `adapter_required`,
- job routing for repair work chooses diagnosis, repair plan, patch plan, tests, and release gate.

## Route still to mount in Replit

The capability matrix should be mounted in the toolbox API:

```txt
GET /api/tools/capabilities
GET /api/tools/capabilities/summary
GET /api/tools/route-job?type=repair
```

The route mount update to `toolBroker.ts` should be done in Replit because the current connector blocked the file update. Replit must mount these endpoints and run typecheck/tests before merge.

## Required AI behaviour

Before promising a job outcome, Groq/Gemini/VIBA Director should:

1. call the capability matrix,
2. route the job type to a tool sequence,
3. refuse to describe `adapter_required` tools as live,
4. use `planning_only` tools honestly for specs/plans,
5. require credentials where status is `credential_required`,
6. require proof before saying a task was completed.

## Full work loop VIBA should aim for

```txt
1. classify user job
2. check capability matrix
3. route to tool sequence
4. generate plan/spec/diagnosis
5. use repository adapter only on a feature branch
6. run build runner checks
7. create evidence report
8. open PR
9. deploy only after safe-build and approval
10. monitor and report proof
```

## Merge rule

Do not merge claims, UI copy, pricing copy, or landing page text that says VIBA can fully build/repair/deploy autonomously until:

- Build Runner Adapter is implemented and tested,
- GitHub Repository Adapter is implemented and tested,
- Render/VPS deploy path is tested,
- evidence reports are generated from real runs,
- the capability matrix says the relevant tools are not `adapter_required`.
