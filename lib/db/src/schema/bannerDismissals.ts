import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";

export const bannerDismissalsTable = pgTable(
  "banner_dismissals",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessionsTable.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique("banner_dismissals_session_id_unique").on(t.sessionId)],
);

export type BannerDismissal = typeof bannerDismissalsTable.$inferSelect;
