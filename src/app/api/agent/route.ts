// route.ts — Fable 5 AI Copilot synthesis & direct Semi-Auto Action queuing. Dependencies: agent, actionCenter, http.
import { z } from 'zod';
import { queueActionPacket } from '../../../lib/actionCenter';
import { runTerminalAgent } from '../../../lib/agent';
import { checkSameOrigin, requireDb } from '../../../lib/http';

const agentPostSchema = z.object({
  prompt: z.string().min(2).max(2000),
  symbol: z.string().max(24).optional(),
  queueProposal: z.boolean().default(false),
});

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = agentPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Provide a research or strategy prompt.' }, { status: 400 });

  const response = await runTerminalAgent(db, {
    prompt: parsed.data.prompt,
    symbol: parsed.data.symbol,
    allowBenchmarkFallback: true,
  });

  let queuedPacket = null;
  let queueError: string | null = null;
  if (parsed.data.queueProposal && response.proposal) {
    try {
      queuedPacket = await queueActionPacket(db, {
        symbol: response.proposal.symbol,
        side: response.proposal.side,
        orderType: response.proposal.orderType,
        quantity: response.proposal.quantity,
        price: response.proposal.price,
        refPrice: response.proposal.price,
        strategy: 'fable5-copilot',
        rationale: response.proposal.rationale,
      });
    } catch (err) {
      queueError = err instanceof Error ? err.message : 'Failed to queue proposal';
    }
  }

  return Response.json({ ...response, queuedPacket, queueError });
}
