import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  accessToken: text("access_token").unique().notNull(),
  status: text("status").notNull().default("pending"),
  trialEnd: timestamp("trial_end"),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
