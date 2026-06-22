import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  name: text("name"),
  googleId: text("google_id").unique(),
  githubId: text("github_id").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  creditsRemaining: integer("credits_remaining").notNull().default(0),
  creditsPeriodEnd: timestamp("credits_period_end", { withTimezone: true }),
  creditsExhaustedNotifiedAt: timestamp("credits_exhausted_notified_at", { withTimezone: true }),
  lowCreditsNotifiedAt: timestamp("low_credits_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectUserSchema = createSelectSchema(usersTable);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

/** @deprecated use usersTable */
export const users = usersTable;
