import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const vibaApiKeysTable = pgTable(
  "viba_api_keys",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    label: text("label").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["task-intake"]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_viba_api_keys_user").on(table.userId, table.createdAt),
    index("idx_viba_api_keys_prefix").on(table.keyPrefix),
  ],
);

export type VibaApiKey = typeof vibaApiKeysTable.$inferSelect;
