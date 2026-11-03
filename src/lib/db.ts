// db.ts — Postgres connection, absent when unconfigured. Dependencies: pg, Drizzle.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
const connectionString = process.env.DATABASE_URL;
export const db = connectionString !== undefined && connectionString.length > 0
  ? drizzle(new Pool({ connectionString, connectionTimeoutMillis: 3000 })) : null;
