import { pgTable, serial, text, integer, timestamp, boolean, jsonb, decimal } from "drizzle-orm/pg-core";

export const marketingSettings = pgTable("marketing_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const marketingBudgets = pgTable("marketing_budgets", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  channel: text("channel").notNull(),
  allocatedAmount: text("allocated_amount").notNull().default("0"),
  spentAmount: text("spent_amount").notNull().default("0"),
  reasoning: text("reasoning"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("draft"),
  type: text("type").notNull().default("awareness"),
  targetAudience: jsonb("target_audience"),
  dailyBudget: integer("daily_budget").default(0),
  budget: integer("budget").default(0),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  aiStrategy: text("ai_strategy"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const marketingContent = pgTable("marketing_content", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id"),
  platform: text("platform").notNull(),
  type: text("type").notNull().default("organic_post"),
  headline: text("headline"),
  body: text("body"),
  hashtags: jsonb("hashtags").$type<string[]>().default([]),
  callToAction: text("call_to_action"),
  imagePrompt: text("image_prompt"),
  imageUrl: text("image_url"),
  publishedUrl: text("published_url"),
  status: text("status").notNull().default("draft"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketingPerformance = pgTable("marketing_performance", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id"),
  channel: text("channel").notNull(),
  date: timestamp("date").defaultNow(),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  conversions: integer("conversions").default(0),
  spend: decimal("spend", { precision: 10, scale: 2 }).default("0"),
  revenue: decimal("revenue", { precision: 10, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketingActivityLog = pgTable("marketing_activity_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  description: text("description"),
  details: jsonb("details"),
  metadata: jsonb("metadata"),
  status: text("status").default("success"),
  createdAt: timestamp("created_at").defaultNow(),
});
