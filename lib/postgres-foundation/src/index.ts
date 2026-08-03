export type QueryResult<Row> = { rows: Row[]; rowCount: number };

export interface Queryable {
  query<Row = unknown>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}

export interface TransactionClient extends Queryable {
  release?: () => void;
}

export interface TransactionPool extends Queryable {
  connect(): Promise<TransactionClient>;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorInput {
  createdAt: string;
  id: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function encodeCursor(value: CursorInput): string {
  if (!value.id || !value.createdAt) throw new Error("Cursor fields are required");
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorInput {
  if (!cursor || !BASE64URL.test(cursor)) throw new Error("Invalid cursor");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid cursor");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid cursor");
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.createdAt !== "string" || typeof candidate.id !== "string") {
    throw new Error("Invalid cursor");
  }
  if (Number.isNaN(Date.parse(candidate.createdAt)) || candidate.id.length === 0) {
    throw new Error("Invalid cursor");
  }
  return { createdAt: candidate.createdAt, id: candidate.id };
}

export function buildCursorPage<T extends { createdAt: string | Date; id: string }>(
  rows: readonly T[],
  limit: number,
): CursorPage<T> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid page limit");
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = hasMore ? items.at(-1) : undefined;
  return {
    items,
    nextCursor: last
      ? encodeCursor({ createdAt: new Date(last.createdAt).toISOString(), id: last.id })
      : null,
  };
}

export function normalizeLimit(limit: number | undefined, defaults = { value: 50, max: 200 }): number {
  const selected = limit ?? defaults.value;
  if (!Number.isInteger(selected) || selected < 1 || selected > defaults.max) {
    throw new Error(`Limit must be between 1 and ${defaults.max}`);
  }
  return selected;
}

export function buildKeysetPredicate(cursor: CursorInput | undefined, startParameter = 1): {
  sql: string;
  values: readonly unknown[];
} {
  if (!cursor) return { sql: "", values: [] };
  return {
    sql: `AND (created_at, id) < ($${startParameter}::timestamptz, $${startParameter + 1}::uuid)`,
    values: [cursor.createdAt, cursor.id],
  };
}

export function assertSafeIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error("Unsafe SQL identifier");
  return identifier;
}

export function softDeleteClause(tableAlias?: string): string {
  const prefix = tableAlias ? `${assertSafeIdentifier(tableAlias)}.` : "";
  return `${prefix}deleted_at IS NULL`;
}

export async function withTransaction<T>(pool: TransactionPool, operation: (client: TransactionClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original transaction failure.
    }
    throw error;
  } finally {
    client.release?.();
  }
}

export async function withAdvisoryLock<T>(
  client: Queryable,
  lockKey: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(lockKey)) throw new Error("Invalid advisory lock key");
  await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
  try {
    return await operation();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
  }
}
