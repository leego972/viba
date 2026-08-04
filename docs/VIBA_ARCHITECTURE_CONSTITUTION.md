# VIBA Architecture Constitution

This document defines non-negotiable rules enforced by the orchestration-governance kernel.

## Authority

1. The orchestrator owns architecture, task decomposition, dependency ordering, file reservations, interface ownership and merge authority.
2. Worker operators execute versioned task contracts. They may not silently expand scope.
3. Any improvement outside the current contract must be submitted as a structured proposal before implementation.
4. Approval creates a new immutable contract version. Verbal or inferred approval is insufficient.

## Scope and collaboration

5. Every implementation task declares allowed paths, forbidden paths, owned interfaces, dependencies and required checks.
6. A path or interface may have only one active owner unless the orchestrator explicitly creates a shared contract.
7. Conflicting proposals are deferred until reservations are released, transferred or deliberately coordinated.
8. Completed work must be validated and merged before dependent operators begin from it.

## Architecture and quality

9. Public API and event contracts remain backward compatible within a major version.
10. Business logic must remain outside transport controllers and UI components.
11. Tenant isolation, authorization and auditability are mandatory where user or organization data is involved.
12. New dependencies require explicit approval and a security, maintenance and cost assessment.
13. Database changes must be additive or include an approved migration and rollback plan.
14. High-risk architectural changes require an ADR and independent architecture and security review.
15. Required checks are part of the task contract and cannot be waived by a worker operator.

## Cost and operations

16. Operators should propose demonstrably cheaper, faster or more reliable approaches when discovered.
17. Recurring cost increases require explicit cost-owner approval.
18. Claimed savings must identify their assumptions and measurement method.
19. Deployment, secrets, billing and production infrastructure remain forbidden unless specifically granted in the contract.

## Evidence

20. The orchestrator records contracts, proposals, decisions, conflicts, review evidence and merge outcomes as durable project memory.
21. Operators must distinguish verified facts, assumptions and recommendations.
22. No operator may claim a build, test, push, deployment or merge succeeded without machine-verifiable evidence.
