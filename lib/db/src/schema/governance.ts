import { boolean, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { sessionsTable } from "./sessions";
import { tasksTable } from "./tasks";

export const taskContractsTable = pgTable("task_contracts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  assignedAgentId: integer("assigned_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("active"),
  objective: text("objective").notNull(),
  allowedPaths: text("allowed_paths").array().notNull().default([]),
  forbiddenPaths: text("forbidden_paths").array().notNull().default([]),
  ownedInterfaces: text("owned_interfaces").array().notNull().default([]),
  dependencyTaskIds: integer("dependency_task_ids").array().notNull().default([]),
  architectureRules: jsonb("architecture_rules").$type<Record<string, unknown>>().notNull().default({}),
  acceptanceCriteria: text("acceptance_criteria").array().notNull().default([]),
  requiredChecks: text("required_checks").array().notNull().default([]),
  maxEstimatedCost: real("max_estimated_cost"),
  requiresProposalApproval: boolean("requires_proposal_approval").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ taskVersion: uniqueIndex("task_contracts_task_version_uq").on(table.taskId, table.version) }));

export const governanceReservationsTable = pgTable("governance_reservations", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  contractId: integer("contract_id").notNull().references(() => taskContractsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  resourceType: text("resource_type").notNull(),
  resourceKey: text("resource_key").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

export const operatorProposalsTable = pgTable("operator_proposals", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  contractId: integer("contract_id").notNull().references(() => taskContractsTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  proposalType: text("proposal_type").notNull(),
  summary: text("summary").notNull(),
  rationale: text("rationale").notNull(),
  affectedPaths: text("affected_paths").array().notNull().default([]),
  affectedInterfaces: text("affected_interfaces").array().notNull().default([]),
  requestedDependencies: text("requested_dependencies").array().notNull().default([]),
  expectedBenefits: text("expected_benefits").array().notNull().default([]),
  estimatedCost: jsonb("estimated_cost").$type<Record<string, unknown>>().notNull().default({}),
  risk: text("risk").notNull().default("medium"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const proposalDecisionsTable = pgTable("proposal_decisions", {
  id: serial("id").primaryKey(),
  proposalId: integer("proposal_id").notNull().references(() => operatorProposalsTable.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  conditions: text("conditions").array().notNull().default([]),
  conflictReport: jsonb("conflict_report").$type<Record<string, unknown>>().notNull().default({}),
  contractVersionCreated: integer("contract_version_created"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const architectureTwinSnapshotsTable = pgTable("architecture_twin_snapshots", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  sourceRevision: text("source_revision"),
  nodeCount: integer("node_count").notNull(),
  edgeCount: integer("edge_count").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ sessionVersion: uniqueIndex("architecture_twin_session_version_uq").on(table.sessionId, table.version) }));
