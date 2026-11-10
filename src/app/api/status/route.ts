// route.ts — safety and service availability. Dependencies: database.
import { db } from '../../../lib/db';
import { getSnapshot } from '../../../lib/mt5';
import { safetyState } from '../../../lib/schema';
export const dynamic = 'force-dynamic';
export async function GET() {
  const mt5 = process.env.MT5_BRIDGE_TOKEN && Buffer.byteLength(process.env.MT5_BRIDGE_TOKEN) >= 32 ? getSnapshot().status : 'NOT CONFIGURED';
  if (db === null) return Response.json({ mt5, database: 'NOT CONFIGURED', killed: null, reason: 'DATABASE_URL is not configured.' });
  try {
    const state = await db.select().from(safetyState).limit(1);
    return Response.json({ mt5, database: 'LIVE', killed: state[0]?.killed ?? false, reason: null });
  } catch {
    return Response.json({ mt5, database: 'OFFLINE', killed: null, reason: 'Database unavailable or migrations not applied.' });
  }
}
