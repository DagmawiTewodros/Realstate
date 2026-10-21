import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { Pool } from "pg";

export type AnySchema = Record<string, unknown>;

/** A database handle or an open transaction. Every service method that writes accepts one of these. */
export type Executor = PgDatabase<NodePgQueryResultHKT, AnySchema, ExtractTablesWithRelations<AnySchema>>;
export type Database = NodePgDatabase<AnySchema> & { $client: Pool };

export function createDatabase(url: string, max = 10): { pool: Pool; db: Database } {
  const pool = new Pool({ connectionString: url, max });
  const db = drizzle(pool) as unknown as Database;
  return { pool, db };
}

/** Runs fn in a transaction, or reuses the transaction the caller passed in. */
export async function withTx<T>(db: Database, tx: Executor | undefined, fn: (tx: Executor) => Promise<T>): Promise<T> {
  if (tx) return fn(tx);
  return db.transaction((inner) => fn(inner as unknown as Executor));
}
