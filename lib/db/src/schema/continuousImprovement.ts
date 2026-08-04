import { integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { sessionsTable } from "./sessions";

export const operatorPerformanceSnapshotsTable = pgTable("operator_performance_snapshots", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  completedTasks: integer("completed_tasks").notNull().default(0),
  reviewedTasks: integer("reviewed_tasks").notNull().default(0),
  recoveredTasks: integer("recovered_tasks").notNull().default(0),
  blockedTasks: integer("blocked_tasks").notNull().default(0),
  successRate: real("success_rate").notNull().default(0),
  recoveryRate: real("recovery_rate").notNull().default(0),
  averageCostUsd: real("average_cost_usd").notNull().default(0),
  averageDurationMs: real("average_duration_ms").notNull().default(0),
  qualityScore: real("quality_score").notNull().default(0),
  efficiencyScore: real("efficiency_score").notNull().default(0),
  reliabilityScore: real("reliability_score").notNull().default(0),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionAgentVersion: uniqueIndex("operator_performance_session_agent_version_uq").on(table.sessionId, table.agentId, table.version),
}));

export const systemHealthSnapshotsTable = pgTable("system_health_snapshots", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  architectureHealthScore: real("architecture_health_score").notNull().default(0),
  coordinationHealthScore: real("coordination_health_score").notNull().default(0),
  memoryHealthScore: real("memory_health_score").notNull().default(0),
  costEfficiencyScore: real("cost_efficiency_score").notNull().default(0),
  technicalDebtScore: real("technical_debt_score").notNull().default(0),
  proposalSuccessRate: real("proposal_success_rate").notNull().default(0),
  unresolvedHighSeverityLessons: integer("unresolved_high_severity_lessons").notNull().default(0),
  activeConflictCount: integer("active_conflict_count").notNull().default(0),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionVersion: uniqueIndex("system_health_session_version_uq").on(table.sessionId, table.version),
}));

export const improvementRecommendationsTable = pgTable("improvement_recommendations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  recommendationKey: text("recommendation_key").notNull(),
  category: text("category").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("proposed"),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  expectedBenefit: text("expected_benefit").notNull(),
  estimatedCost: real("estimated_cost"),
  confidence: real("confidence").notNull().default(0),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  sessionRecommendation: uniqueIndex("improvement_recommendations_session_key_uq").on(table.sessionId, table.recommendationKey),
}));

export type OperatorPerformanceSnapshot = typeof operatorPerformanceSnapshotsTable.$inferSelect;
export type SystemHealthSnapshot = typeof systemHealthSnapshotsTable.$inferSelect;
export type ImprovementRecommendation = typeof improvementRecommendationsTable.$inferSelect;
