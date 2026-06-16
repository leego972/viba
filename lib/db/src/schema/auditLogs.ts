import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  // MIGRATION NOTE:
  //   ALTER TABLE audit_logs ALTER COLUMN session_id DROP NOT NULL;
  //   ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_session_id_sessions_id_fk;
  //   ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_session_id_fk
  //     FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
  // Rationale: system-level events (circuit opens, rate limits) have no session
  // context. Cascade-deleting audit logs destroys compliance history.
  sessionId: integer("session_id").references(() => sessionsTable.id, {
    onDelete: "set null",
  }),
  eventType: text("event_type").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
