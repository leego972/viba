# Stage 3C Live Coordination Invariants

- Dependency-blocked tasks are held outside the runnable queue until their prerequisite is complete.
- Stalled in-progress tasks are recovered after the configured threshold and reassigned to a capable operator.
- Tool-requiring tasks cannot be assigned to operators without tool capability.
- Coordination decisions are written to the session audit log.
- Governance enforcement remains authoritative after coordination selects a task.
- Architecture impact simulation still runs before execution.
- Coordination state changes are scoped to one session.
- Audit-only governance must be explicitly enabled; enforcement is the default.
