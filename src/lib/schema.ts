// schema.ts — durable safety and source records. Dependencies: Drizzle ORM.
import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const safetyState = pgTable('safety_state', {
  id: integer('id').primaryKey(),
  killed: boolean('killed').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const auditLog = pgTable('audit_log', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  lastSuccess: timestamp('last_success', { withTimezone: true }),
  lastError: text('last_error'),
  latencyMs: integer('latency_ms'),
});
