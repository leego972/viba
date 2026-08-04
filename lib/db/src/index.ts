import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { ensureGovernanceDatabase } from "./governanceBootstrap";

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

const rawPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/**
 * Starts governance bootstrap immediately. The exported pool waits for this
 * promise before application queries/connects, while the bootstrap itself uses
 * rawPool and therefore cannot deadlock through the guard.
 */
export const governanceReady = ensureGovernanceDatabase(rawPool);

export const pool = new Proxy(rawPool, {
  get(target, property, receiver) {
    if (property === "query") {
      return async (...args: unknown[]) => {
        await governanceReady;
        return (target.query as (...queryArgs: unknown[]) => unknown).apply(target, args);
      };
    }
    if (property === "connect") {
      return async (...args: unknown[]) => {
        await governanceReady;
        return (target.connect as (...connectArgs: unknown[]) => unknown).apply(target, args);
      };
    }

    const value = Reflect.get(target, property, receiver) as unknown;
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as pg.Pool;

export const db = drizzle(pool, { schema });

export * from "./schema";
