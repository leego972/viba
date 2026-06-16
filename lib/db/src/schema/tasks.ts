import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  type: text("type").notNull().default("planning"),
  /**
   * Status values:
   *   planned | in_progress | complete | review | blocked_needs_tools
   *
   * blocked_needs_tools — a text-only agent hit a tool requirement.
   * VIBA creates a sibling task for the remaining work and re-routes it to
   * a tool-capable agent (Replit or Manus).
   */
  status: text("status").notNull().default("planned"),
  assignedAgentId: integer("assigned_agent_id"),
  costEstimate: real("cost_estimate"),
  dependencyTaskId: integer("dependency_task_id"),
  /** Why a text-only agent could not complete this task (tool limitation). */
  blockedReason: text("blocked_reason"),
  /** Work the text-only agent completed before hitting the tool blocker. */
  partialWork: text("partial_work"),
  /** Tool names that are required to finish this task (e.g. git_clone, run_tests). */
  toolRequirements: text("tool_requirements").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
