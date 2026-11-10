// db.ts — PostgreSQL / Drizzle ORM connection with embedded PGlite workspace fallback when DATABASE_URL is unset. Dependencies: pg, @electric-sql/pglite, drizzle-orm.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import * as schema from './schema';
import { type AppDatabase, ensureInitialOperationalDefaults, runBootstrapSql } from './bootstrap';

export type DatabaseHealth = {
  database: 'LIVE' | 'LOCAL' | 'OFFLINE';
  postgresConfigured: boolean;
  storageEngine: 'postgresql' | 'pglite';
  reason: string | null;
};

type GlobalDbState = {
  __fable5PgPool?: Pool;
  __fable5PgDb?: AppDatabase;
  __fable5Pglite?: PGlite;
  __fable5PgliteDb?: AppDatabase;
  __fable5InitPromise?: Promise<AppDatabase | null>;
  __fable5InitKey?: string;
};

const g = globalThis as unknown as GlobalDbState;

const connectionString = process.env.DATABASE_URL;
export const db: AppDatabase | null =
  connectionString !== undefined && connectionString.length > 0
    ? (() => {
        if (!g.__fable5PgPool) {
          g.__fable5PgPool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
          g.__fable5PgDb = drizzlePg(g.__fable5PgPool, { schema });
        }
        return g.__fable5PgDb!;
      })()
    : null;

async function initLocalPglite(): Promise<AppDatabase> {
  if (g.__fable5PgliteDb) return g.__fable5PgliteDb;
  const dataDir = process.env.FABLE5_LOCAL_DB_DIR ?? resolve(process.cwd(), '.fable5', 'pgdata');
  if (dataDir !== 'memory://') {
    mkdirSync(dirname(dataDir), { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  }
  const client = dataDir === 'memory://' ? new PGlite() : new PGlite(dataDir);
  await client.waitReady;
  await runBootstrapSql(client);
  const localDb = drizzlePglite(client, { schema }) as unknown as AppDatabase;
  await ensureInitialOperationalDefaults(localDb);
  g.__fable5Pglite = client;
  g.__fable5PgliteDb = localDb;
  return localDb;
}

export async function getDb(): Promise<AppDatabase | null> {
  const url = process.env.DATABASE_URL;
  if (url !== undefined && url.length > 0) {
    if (!g.__fable5PgPool || !g.__fable5PgDb) {
      g.__fable5PgPool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
      g.__fable5PgDb = drizzlePg(g.__fable5PgPool, { schema });
    }
    const initKey = `pg:${url}`;
    if (g.__fable5InitKey !== initKey) {
      try {
        await ensureInitialOperationalDefaults(g.__fable5PgDb);
        g.__fable5InitKey = initKey;
      } catch {
        return g.__fable5PgDb;
      }
    }
    return g.__fable5PgDb;
  }

  const localKey = `pglite:${process.env.FABLE5_LOCAL_DB_DIR ?? 'default'}`;
  if (!g.__fable5InitPromise || g.__fable5InitKey !== localKey) {
    g.__fable5InitKey = localKey;
    g.__fable5InitPromise = initLocalPglite().catch(() => null);
  }
  return g.__fable5InitPromise;
}

export async function getDatabaseHealth(): Promise<DatabaseHealth> {
  const url = process.env.DATABASE_URL;
  if (url !== undefined && url.length > 0) {
    try {
      if (!g.__fable5PgPool) {
        g.__fable5PgPool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
        g.__fable5PgDb = drizzlePg(g.__fable5PgPool, { schema });
      }
      await g.__fable5PgPool.query('SELECT 1');
      return {
        database: 'LIVE',
        postgresConfigured: true,
        storageEngine: 'postgresql',
        reason: null,
      };
    } catch {
      return {
        database: 'OFFLINE',
        postgresConfigured: true,
        storageEngine: 'postgresql',
        reason: 'External PostgreSQL configured via DATABASE_URL is unreachable or migrations are not applied.',
      };
    }
  }

  const localDb = await getDb();
  if (localDb) {
    return {
      database: 'LOCAL',
      postgresConfigured: false,
      storageEngine: 'pglite',
      reason: 'DATABASE_URL is not configured; using embedded local PostgreSQL-compatible workspace storage (.fable5/pgdata).',
    };
  }
  return {
    database: 'OFFLINE',
    postgresConfigured: false,
    storageEngine: 'pglite',
    reason: 'Failed to initialize embedded local storage.',
  };
}

export async function createEphemeralTestDb(): Promise<{ db: AppDatabase; close: () => Promise<void> }> {
  const client = new PGlite();
  await client.waitReady;
  await runBootstrapSql(client);
  const testDb = drizzlePglite(client, { schema }) as unknown as AppDatabase;
  await ensureInitialOperationalDefaults(testDb);
  return { db: testDb, close: async () => { await client.close(); } };
}
