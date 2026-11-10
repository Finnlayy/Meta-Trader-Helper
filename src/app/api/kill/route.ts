// route.ts — atomic kill switch engagement and resumption with cascading order/action cancellation. Dependencies: actionCenter, http.
import { z } from 'zod';
import { executeKillSwitch, resumeFromKillSwitch } from '../../../lib/actionCenter';
import { checkSameOrigin, requireDb } from '../../../lib/http';

const killBodySchema = z.object({
  action: z.enum(['kill', 'resume']).default('kill'),
  reason: z.string().max(300).optional(),
  squareOffPositions: z.boolean().optional(),
});

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request, true);
  if (originErr) return originErr;

  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  let body: z.infer<typeof killBodySchema> = { action: 'kill' };
  try {
    const raw = await request.text();
    if (raw.trim()) {
      const parsed = killBodySchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return Response.json({ error: 'Invalid kill switch payload.' }, { status: 400 });
      }
      body = parsed.data;
    }
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    if (body.action === 'resume') {
      await resumeFromKillSwitch(db, body.reason ?? 'Operator verified safety posture and resumed trading');
      return Response.json({ killed: false, resumed: true });
    }
    const report = await executeKillSwitch(db, {
      reason: body.reason,
      squareOffPositions: body.squareOffPositions ?? false,
      actor: 'operator',
    });
    return Response.json(report);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Kill switch update failed.' },
      { status: 400 },
    );
  }
}
