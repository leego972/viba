import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const approvalsTable = pgTable("approvals", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  // MIGRATION NOTE: ALTER TABLE approvals ADD COLUMN rejected_at TIMESTAMPTZ;
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  // MIGRATION NOTE: ALTER TABLE approvals ADD COLUMN rejected_reason TEXT;
  rejectedReason: text("rejected_reason"),
  // MIGRATION NOTE: ALTER TABLE approvals ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertApprovalSchema = createInsertSchema(approvalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertApproval = z.infer<typeof insertApprovalSchema>;
export type Approval = typeof approvalsTable.$inferSelect;
