import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { tasksTable } from "./tasks";

export const architectureDecisionsTable = pgTable("architecture_decisions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  decisionKey: text("decision_key").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("accepted"),
  title: text("title").notNull(),
  context: text("context").notNull(),
  decision: text("decision").notNull(),
  rationale: text("rationale").notNull(),
  alternatives: jsonb("alternatives").$type<Array<{ option: string; reasonRejected?: string }>>().notNull().default([]),
  consequences: text("consequences").array().notNull().default([]),
  affectedModules: text("affected_modules").array().notNull().default([]),
  affectedInterfaces: text("affected_interfaces").array().notNull().default([]),
  evidence: jsonb("evidence").$type<Array<{ type: string; reference: string; summary?: string }>>().notNull().default([]),
  supersedesDecisionId: integer("supersedes_decision_id"),
  createdBy: text("created_by").notNull().default("orchestrator"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  decisionVersion: uniqueIndex("architecture_decisions_key_version_uq").on(table.sessionId, table.decisionKey, table.version),
}));

export const engineeringPatternsTable = pgTable("engineering_patterns", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  patternKey: text("pattern_key").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("approved"),
  problem: text("problem").notNull(),
  solution: text("solution").notNull(),
  applicability: text("applicability").array().notNull().default([]),
  constraints: text("constraints").array().notNull().default([]),
  requiredChecks: text("required_checks").array().notNull().default([]),
  sourceDecisionId: integer("source_decision_id").references(() => architectureDecisionsTable.id, { onDelete: "set null" }),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  patternIdentity: uniqueIndex("engineering_patterns_session_key_uq").on(table.sessionId, table.patternKey),
}));

export const engineeringLessonsTable = pgTable("engineering_lessons", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  lessonType: text("lesson_type").notNull(),
  severity: text("severity").notNull().default("medium"),
  title: text("title").notNull(),
  observation: text("observation").notNull(),
  rootCause: text("root_cause"),
  correctiveAction: text("corrective_action").notNull(),
  preventionRules: text("prevention_rules").array().notNull().default([]),
  affectedModules: text("affected_modules").array().notNull().default([]),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ArchitectureDecision = typeof architectureDecisionsTable.$inferSelect;
export type EngineeringPattern = typeof engineeringPatternsTable.$inferSelect;
export type EngineeringLesson = typeof engineeringLessonsTable.$inferSelect;
