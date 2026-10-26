import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type OperatorDatabase = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: OperatorDatabase | undefined;

export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for Operator database access.");
  }
  return url;
}

export function createDatabase(databaseUrl = getDatabaseUrl()): OperatorDatabase {
  const nextPool = new pg.Pool({ connectionString: databaseUrl });
  return drizzle(nextPool, { schema });
}

export function getDatabase(): OperatorDatabase {
  if (!db) {
    pool = new pg.Pool({ connectionString: getDatabaseUrl() });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  const current = pool;
  pool = undefined;
  db = undefined;
  await current?.end();
}
