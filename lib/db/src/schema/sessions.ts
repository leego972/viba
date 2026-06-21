import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("active"),
  autonomyMode: text("autonomy_mode").notNull().default("supervised"),
  mode: text("mode").notNull().default("simulation"),
  estimatedCost: real("estimated_cost"),
  finalOutput: text("final_output"),
  /** Git repo URL the tool-capable agents should act on (optional). */
  repoUrl: text("repo_url"),
  /** Branch to target — defaults to main if not specified. */
  repoBranch: text("repo_branch"),
  /** Environment label: development | staging | production */
  workspaceEnv: text("workspace_env"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
