import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sessionsTable } from "./sessions";

export const memoryTable = pgTable(
  "memory",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    summary: text("summary").notNull().default(""),
    decisions: text("decisions").array().notNull().default([]),
    // MIGRATION NOTE: ALTER TABLE memory ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // MIGRATION NOTE: ALTER TABLE memory ADD CONSTRAINT memory_session_id_unique UNIQUE (session_id);
  (t) => [unique("memory_session_id_unique").on(t.sessionId)],
);

export const insertMemorySchema = createInsertSchema(memoryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMemory = z.infer<typeof insertMemorySchema>;
export type Memory = typeof memoryTable.$inferSelect;
