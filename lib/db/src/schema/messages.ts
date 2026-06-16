import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id"),
  role: text("role").notNull().default("assistant"),
  provider: text("provider"),
  model: text("model"),
  content: text("content").notNull(),
  taskId: integer("task_id"),
  agentName: text("agent_name"),
  agentRole: text("agent_role"),
  /**
   * Inter-agent message type:
   *   output   — standard task output (default)
   *   question — agent asking another agent a task-scoped question
   *   answer   — response to a question message
   *   handoff  — partial work handed off to a tool-capable agent
   *   context  — proactive context/information shared between agents
   */
  messageType: text("message_type").notNull().default("output"),
  /** For question/answer/handoff messages — the receiving agent's id. */
  toAgentId: integer("to_agent_id"),
  /** Extra structured data (e.g. partialWork, remainingWork, questionRef). */
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
