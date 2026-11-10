// route.ts — audit log & source registry read endpoint. Dependencies: db, schema.
import { desc } from 'drizzle-orm';
import { requireDb } from '../../../lib/http';
import { auditLog, sources } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const [logs, sourceList] = await Promise.all([
    db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(100),
    db.select().from(sources),
  ]);
  return Response.json({ logs, sources: sourceList }, { headers: { 'Cache-Control': 'no-store' } });
}
