import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const creditTransactionsTable = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  /** Positive = credits added, negative = credits deducted */
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  sessionId: integer("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
