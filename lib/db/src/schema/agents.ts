import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => sessionsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  role: text("role").notNull(),
  capabilities: text("capabilities").array().notNull().default([]),
  isMock: boolean("is_mock").notNull().default(true),
  lastUsedModel: text("last_used_model"),
  // MIGRATION NOTE: ALTER TABLE agents ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
