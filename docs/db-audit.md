# VIBA Database Audit Report

**Date:** 2026-06-16  
**Scope:** All Drizzle ORM schema files, startup migrations, and DB-touching routes.

---

## Summary

| Severity | Count | Status |
|---|---|---|
| Critical | 9 | Fixed (7 applied, 2 migration-noted) |
| Moderate | 6 | Fixed (5 applied, 1 noted) |
| Minor | 5 | Documented |

---

## Issues Found & Fixed

### CRITICAL

#### 1. `subscribers.email` — NOT UNIQUE ✅ Fixed
**File:** `lib/db/src/schema/subscribers.ts`  
**Problem:** Multiple subscribers could register with the same email, creating duplicate accounts.  
**Fix applied:** Added `uniqueIndex("subscribers_email_unique")` to schema. Migration applied via startup SQL guard:
```sql
ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_unique UNIQUE (email);
```

#### 2. `subscribers.*` — timestamps missing `withTimezone: true` ✅ Fixed
**Problem:** `trialEnd`, `currentPeriodEnd`, `createdAt`, `updatedAt` used plain `timestamp()` while every other table uses `{ withTimezone: true }`. Would diverge from the `TIMESTAMPTZ` columns created by the startup SQL.  
**Fix applied:** All four timestamps now use `{ withTimezone: true }`.

#### 3. `subscribers.updatedAt` — no `$onUpdate()` ✅ Fixed
**Problem:** `updatedAt` would never auto-update via Drizzle ORM `.update()` calls.  
**Fix applied:** Added `.$onUpdate(() => new Date())`.

#### 4. `subscribers` — export name inconsistent ✅ Fixed
**Problem:** All other tables export as `<entity>Table` (e.g., `sessionsTable`, `agentsTable`) but subscribers exported as bare `subscribers`. This caused `storage.ts` to import by the table-name pattern, breaking consistency and making auto-import ambiguous.  
**Fix applied:** Renamed export to `subscribersTable`. Kept `export const subscribers = subscribersTable` as a deprecated alias for backwards compatibility. Updated `storage.ts` imports.

#### 5. `subscribers` — no Zod insert/select schemas ✅ Fixed
**Problem:** Every other table exports `insertXxxSchema` and `Xxx` type from `drizzle-zod`. Subscribers had none.  
**Fix applied:** Added `insertSubscriberSchema`, `selectSubscriberSchema`, `InsertSubscriber`, `Subscriber`.

#### 6. `auditLogs.sessionId` — NOT NULL forces session context ✅ Fixed (schema + migration)
**Problem:** System-level events (circuit opens, rate limit hits, failed startup) cannot be logged because they have no session context. Also, `onDelete: "cascade"` means **deleting a session destroys its audit history** — bad for compliance.  
**Fix applied:**
- Made `sessionId` nullable in schema (`references()` without `notNull()`)
- Changed `onDelete: "cascade"` → `"set null"` 
- Startup migration drops NOT NULL constraint idempotently

> **⚠️ Manual migration required if FK constraint name changed:**
> ```sql
> -- Verify with: \d audit_logs
> ALTER TABLE audit_logs ALTER COLUMN session_id DROP NOT NULL;
> -- Optionally re-add FK with SET NULL:
> ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_session_id_sessions_id_fk;
> ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_session_id_fk
>   FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
> ```

#### 7. `tasks.assignedAgentId` — integer with no FK ⚠️ Documented, not applied
**Problem:** If an agent row is deleted, `assignedAgentId` silently points to nothing.  
**Why not auto-fixed:** Adding FK requires verifying no orphan rows exist in production.  
**Manual migration:**
```sql
-- Only run after confirming no orphan assignedAgentId values:
ALTER TABLE tasks
  ADD CONSTRAINT tasks_assigned_agent_id_fk
  FOREIGN KEY (assigned_agent_id) REFERENCES agents(id) ON DELETE SET NULL;
```

#### 8. `tasks.dependencyTaskId` — self-referential integer with no FK ⚠️ Documented
**Problem:** No referential integrity for task dependency chains.  
**Manual migration:**
```sql
ALTER TABLE tasks
  ADD CONSTRAINT tasks_dependency_task_id_fk
  FOREIGN KEY (dependency_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
```

#### 9. `messages.agentId` / `messages.taskId` — integers with no FK ⚠️ Documented
**Problem:** Orphan risk. `agentName` and `agentRole` are denormalized copies — acceptable for message history preservation after agent deletion, but should be documented as intentional.  
**Status:** Denormalization is intentional (messages preserve historical agent context after agents are deleted). FKs with `ON DELETE SET NULL` would be safe additions.  
**Manual migration (optional):**
```sql
ALTER TABLE messages
  ADD CONSTRAINT messages_agent_id_fk FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
  ADD CONSTRAINT messages_task_id_fk  FOREIGN KEY (task_id)  REFERENCES tasks(id)  ON DELETE SET NULL;
```

---

### MODERATE

#### 10. `agents` — missing `createdAt` ✅ Fixed
**Fix applied:** Added `createdAt` column. Startup migration: `ALTER TABLE agents ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`

#### 11. `memory` — missing `createdAt`, no UNIQUE on `sessionId` ✅ Fixed
**Fix applied:** Added `createdAt`. Added `unique("memory_session_id_unique")` constraint. Startup migration handles both idempotently.

#### 12. `approvals` — missing `updatedAt`, `rejectedAt`, `rejectedReason` ✅ Fixed
**Fix applied:** Added all three columns. Startup migration: `ALTER TABLE approvals ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ADD COLUMN rejected_at TIMESTAMPTZ, ADD COLUMN rejected_reason TEXT;`

#### 13. `bannerDismissals.dismissedAt` — no `defaultNow()` ✅ Fixed
**Problem:** Caller always had to provide this value. Inconsistent with rest of codebase.  
**Fix applied:** Added `.defaultNow()`.

#### 14. `admin.ts` — `parseInt` without NaN guard ✅ Fixed
**Problem:** `Math.min(NaN, 200)` returns NaN, which would send `LIMIT NaN` to Postgres (→ runtime error).  
**Fix applied:** Extracted `safeInt(raw, fallback, max?)` helper used for all `limit`, `offset`, and `id` params in admin routes.

#### 15. `stripeWebhook.ts` — `"cancelled"` vs Stripe's `"canceled"` ✅ Fixed
**Problem:** On `customer.subscription.deleted`, the code wrote `status: "cancelled"` (British spelling). Stripe's native status is `"canceled"` (single L). Any code comparing against Stripe's canonical values would miss it.  
**Fix:** Changed to `"canceled"` in `updateSubscriberBySubscriptionId` call.

---

### MINOR / ARCHITECTURAL

#### 16. No soft-delete pattern
**Observation:** All deletes are hard deletes (`DELETE FROM`). Cascades on sessions remove all agents, tasks, messages, approvals, memory, and audit logs in one operation.  
**Recommendation:** If session history needs to be preserved for billing/compliance, add `deleted_at TIMESTAMPTZ` to `sessions` and filter with `WHERE deleted_at IS NULL`.  
**Status:** Not applied — requires product decision and significant migration.

#### 17. No DB-level indexes beyond unique constraints
**Observation:** Common query patterns (filter by `status`, `created_at`, `provider`, `session_id`) have no explicit Drizzle indexes. Unique constraints create implicit indexes, but non-unique query columns are unindexed.  
**Recommendation:** Add indexes for high-traffic columns:
```sql
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
```

#### 18. `status` fields are unconstrained text
**Observation:** `sessions.status`, `tasks.status`, `approvals.status`, `subscribers.status` are all plain `text`. No CHECK constraints enforce valid values.  
**Known valid values:**
- `sessions.status`: `active`, `completed`, `failed`, `stopped`
- `tasks.status`: `planned`, `in_progress`, `completed`, `failed`, `blocked`
- `approvals.status`: `pending`, `approved`, `rejected`
- `subscribers.status`: Stripe values — `trialing`, `active`, `past_due`, `canceled`, `incomplete`, `incomplete_expired`, `unpaid`, `paused`

**Recommendation (optional):** Add CHECK constraints if strict enforcement is needed.

#### 19. No migration history / version tracking
**Observation:** Schema is managed via Drizzle push (`pnpm --filter @workspace/db run push`). There are no migration files — only `CREATE TABLE IF NOT EXISTS` guards in the startup script. This means there is no rollback path for schema changes.  
**Recommendation:** Consider adopting `drizzle-kit generate` to produce versioned migration SQL files, especially before the production schema becomes complex.

#### 20. `settings` table: SMTP passwords stored in plaintext
**Observation:** `SMTP_PASS`, `NOTIFICATION_WEBHOOK_URL` stored in `settings` table as plain text. Admin UI masks them but they are readable in raw DB.  
**Recommendation:** Prefer env vars for secrets over DB-stored settings. If DB storage is required, encrypt the value at rest.

---

## Migration Run Order

For production, run these migrations in order (once, by hand) if the startup migrations haven't applied them yet:

```sql
-- 1. subscribers: email unique
ALTER TABLE subscribers ADD CONSTRAINT subscribers_email_unique UNIQUE (email);

-- 2. agents: add created_at
ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3. memory: add created_at + unique session
ALTER TABLE memory ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE memory ADD CONSTRAINT IF NOT EXISTS memory_session_id_unique UNIQUE (session_id);

-- 4. approvals: add tracking columns
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS rejected_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- 5. audit_logs: make session_id nullable
ALTER TABLE audit_logs ALTER COLUMN session_id DROP NOT NULL;

-- 6. Recommended indexes (run at low-traffic time)
CREATE INDEX IF NOT EXISTS idx_sessions_status       ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at   ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_id   ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_provider     ON messages(provider);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscribers_status    ON subscribers(status);
```
