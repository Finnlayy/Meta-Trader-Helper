// route.ts — safety and service availability. Dependencies: database.
import { db } from '../../../lib/db';
import { safetyState } from '../../../lib/schema';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (db === null) return Response.json({ database: 'NOT CONFIGURED', killed: null, reason: 'DATABASE_URL is not configured.' });
  try {
    const state = await db.select().from(safetyState).limit(1);
    return Response.json({ database: 'LIVE', killed: state[0]?.killed ?? false, reason: null });
  } catch {
    return Response.json({ database: 'OFFLINE', killed: null, reason: 'Database unavailable or migrations not applied.' });
  }
}
