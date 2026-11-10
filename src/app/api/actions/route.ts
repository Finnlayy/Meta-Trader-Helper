// route.ts — Semi-Auto Action Center approval queue API. Dependencies: actionCenter, schema, http.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  approveActionPacket,
  listActionCenterState,
  queueActionPacket,
  rejectActionPacket,
} from '../../../lib/actionCenter';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { pendingActions } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;
  const state = await listActionCenterState(db);
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } });
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('queue'),
    accountId: z.string().default('paper-default'),
    symbol: z.string().min(2).max(24),
    exchange: z.string().default('CRYPTO'),
    side: z.enum(['buy', 'sell']),
    orderType: z.enum(['market', 'limit', 'stop', 'stop_limit']).default('limit'),
    product: z.enum(['MIS', 'CNC', 'NRML']).default('CNC'),
    quantity: z.number().positive(),
    price: z.number().nonnegative().nullable().optional(),
    stopPrice: z.number().nonnegative().nullable().optional(),
    refPrice: z.number().positive().nullable().optional(),
    reduceOnly: z.boolean().optional(),
    strategy: z.string().max(80).optional(),
    rationale: z.string().max(400).optional(),
  }),
  z.object({ action: z.literal('approve'), id: z.string().min(2) }),
  z.object({ action: z.literal('reject'), id: z.string().min(2), reason: z.string().max(240).optional() }),
  z.object({ action: z.literal('approveAll') }),
  z.object({ action: z.literal('rejectAll'), reason: z.string().max(240).optional() }),
]);

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid Action Center request.' }, { status: 400 });

  const d = parsed.data;
  try {
    if (d.action === 'queue') {
      const packet = await queueActionPacket(db, d);
      return Response.json({ packet, state: await listActionCenterState(db) }, { status: 201 });
    }
    if (d.action === 'approve') {
      const approved = await approveActionPacket(db, d.id);
      return Response.json({ approved, state: await listActionCenterState(db) });
    }
    if (d.action === 'reject') {
      const rejected = await rejectActionPacket(db, d.id, d.reason ?? 'Rejected by operator');
      return Response.json({ rejected, state: await listActionCenterState(db) });
    }
    if (d.action === 'approveAll') {
      const stateBefore = await listActionCenterState(db);
      const pendingList = stateBefore.actions.filter((a) => a.status === 'pending').reverse();
      const results = [];
      for (const item of pendingList) {
        try {
          results.push({ id: item.id, ok: true, res: await approveActionPacket(db, item.id) });
        } catch (err) {
          results.push({ id: item.id, ok: false, error: err instanceof Error ? err.message : 'failed' });
        }
      }
      return Response.json({ results, state: await listActionCenterState(db) });
    }

    const pendingList = await db.select().from(pendingActions).where(eq(pendingActions.status, 'pending'));
    for (const item of pendingList) {
      await rejectActionPacket(db, item.id, d.reason ?? 'Bulk rejected by operator');
    }
    return Response.json({ rejectedCount: pendingList.length, state: await listActionCenterState(db) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Action Center operation failed.' }, { status: 400 });
  }
}
