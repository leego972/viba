import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const teamMembersTable = pgTable("viba_team_members", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  email: text("email").notNull(),
  role: text("role").notNull().default("viewer"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({ id: true, createdAt: true, updatedAt: true });
export const selectTeamMemberSchema = createSelectSchema(teamMembersTable);
export type TeamMember = typeof teamMembersTable.$inferSelect;
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
