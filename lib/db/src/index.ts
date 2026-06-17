import { drizzle } from "drizzle-orm/node-postgres";
  import pg from "pg";
  import * as schema from "./schema";

  const { Pool } = pg;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }

  // Default to 25 connections; tune via DATABASE_POOL_MAX env var.
  // Railway's Postgres plan allows up to 100 simultaneous connections.
  // 25 leaves headroom for the db push step and other tooling.
  const poolMax = parseInt(process.env["DATABASE_POOL_MAX"] ?? "25", 10);

  export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  export const db = drizzle(pool, { schema });

  export * from "./schema";
  