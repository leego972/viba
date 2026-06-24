import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientReportsTable = pgTable("viba_client_reports", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  reportType: text("report_type").notNull(),
  sourceId: text("source_id").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClientReportSchema = createInsertSchema(clientReportsTable).omit({ id: true, createdAt: true });
export const selectClientReportSchema = createSelectSchema(clientReportsTable);
export type ClientReport = typeof clientReportsTable.$inferSelect;
export type InsertClientReport = z.infer<typeof insertClientReportSchema>;
