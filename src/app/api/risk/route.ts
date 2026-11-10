// route.ts — Pre-Trade Risk Core policy management & dry-run validator endpoint. Dependencies: risk, paper, schema, http.
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { getPaperWorkspace } from '../../../lib/paper';
import { evaluatePreTradeRisk, isKillSwitchActive, loadRiskPolicy, saveRiskPolicy } from '../../../lib/risk';
import { auditLog } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const [policy, killed, audits] = await Promise.all([
    loadRiskPolicy(db),
    isKillSwitchActive(db),
    db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(40),
  ]);

  return Response.json({ policy, killed, audits }, { headers: { 'Cache-Control': 'no-store' } });
}

const riskPostSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('updatePolicy'),
    maxOrderValue: z.number().min(0).optional(),
    maxOrderQuantity: z.number().min(0).optional(),
    dailyLossLimit: z.number().min(0).optional(),
    maxOpenPositions: z.number().int().min(0).optional(),
    maxLeverage: z.number().min(1).max(100).optional(),
    sanityChecks: z.boolean().optional(),
    killSwitchEnforced: z.boolean().optional(),
    oneClickEnabled: z.boolean().optional(),
    semiAutoMode: z.boolean().optional(),
    pendingTtlMinutes: z.number().int().min(1).max(240).optional(),
    blockedSymbols: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal('dryRun'),
    symbol: z.string(),
    exchange: z.string().default('CRYPTO'),
    side: z.enum(['buy', 'sell']),
    orderType: z.enum(['market', 'limit', 'stop', 'stop_limit']).default('limit'),
    quantity: z.number(),
    price: z.number().optional(),
    stopPrice: z.number().optional(),
    reduceOnly: z.boolean().optional(),
  }),
]);

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = riskPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid risk payload.' }, { status: 400 });

  const d = parsed.data;
  if (d.action === 'updatePolicy') {
    const { action: _unused, ...updates } = d;
    void _unused;
    const saved = await saveRiskPolicy(db, updates);
    await db.insert(auditLog).values({ actor: 'operator', action: 'risk_policy_updated', details: saved });
    return Response.json({ policy: saved });
  }

  const [policy, killed, ws] = await Promise.all([
    loadRiskPolicy(db),
    isKillSwitchActive(db),
    getPaperWorkspace(db, 'paper-default'),
  ]);
  const refPrice = d.price ?? d.stopPrice ?? 0;
  const oppSide = d.side === 'buy' ? 'short' : 'long';
  const opp = ws.positions.find((p) => p.symbol === d.symbol.trim().toUpperCase() && p.side === oppSide);
  const reducesPosition = Boolean(d.reduceOnly) || (opp !== undefined && d.quantity <= opp.quantity);

  const check = evaluatePreTradeRisk(
    {
      symbol: d.symbol,
      exchange: d.exchange,
      side: d.side,
      orderType: d.orderType,
      quantity: d.quantity,
      price: d.price,
      stopPrice: d.stopPrice,
      reduceOnly: d.reduceOnly,
    },
    policy,
    {
      refPrice,
      buyingPower: ws.active?.balance ?? 0,
      dayPnl: ws.analytics?.todayPnl ?? 0,
      dayPnlKnown: true,
      openPositionCount: ws.positions.length,
      reducesPosition,
      killed,
      enforcedAccount: true,
    },
  );
  return Response.json({ evaluation: check });
}
