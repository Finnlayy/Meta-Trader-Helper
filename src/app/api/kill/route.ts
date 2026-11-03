// route.ts — persist an operator kill request and audit atomically. Dependencies: Drizzle.
import { db } from '../../../lib/db';
import { auditLog, safetyState } from '../../../lib/schema';
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin === null || host === null || new URL(origin).host !== host) return Response.json({ error: 'Same-origin request required.' }, { status: 403 });
  if (db === null) return Response.json({ error: 'Database not configured; kill state cannot be persisted.' }, { status: 503 });
  try {
    await db.transaction(async (tx) => {
      await tx.insert(safetyState).values({ id: 1, killed: true }).onConflictDoUpdate({ target: safetyState.id, set: { killed: true, updatedAt: new Date() } });
      await tx.insert(auditLog).values({ actor: 'operator', action: 'kill_switch' });
    });
    return Response.json({ killed: true });
  } catch {
    return Response.json({ error: 'Kill state could not be persisted. No execution engine is enabled.' }, { status: 503 });
  }
}
