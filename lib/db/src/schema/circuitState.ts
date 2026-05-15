import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const circuitStateTable = pgTable("circuit_state", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type CircuitStateRow = typeof circuitStateTable.$inferSelect;
