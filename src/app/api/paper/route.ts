// route.ts — paper trading portfolio, order book, touch matcher, and execution endpoint. Dependencies: paper, actionCenter, risk, screener, http.
import { z } from 'zod';
import { queueActionPacket } from '../../../lib/actionCenter';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import {
  cancelPaperOrder,
  closePaperPosition,
  createPaperPortfolio,
  getPaperWorkspace,
  matchPendingPaperOrders,
  placePaperOrder,
  resetPaperPortfolio,
  topUpPaperPortfolio,
} from '../../../lib/paper';
import { loadRiskPolicy } from '../../../lib/risk';
import { loadSymbolBars } from '../../../lib/screener';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;
  const portfolioId = new URL(request.url).searchParams.get('portfolioId') ?? 'paper-default';
  const workspace = await getPaperWorkspace(db, portfolioId);
  return Response.json(workspace, { headers: { 'Cache-Control': 'no-store' } });
}

const paperActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('placeOrder'),
    portfolioId: z.string().default('paper-default'),
    symbol: z.string().min(2).max(24),
    exchange: z.string().default('CRYPTO'),
    side: z.enum(['buy', 'sell']),
    orderType: z.enum(['market', 'limit', 'stop', 'stop_limit']).default('market'),
    product: z.enum(['MIS', 'CNC', 'NRML']).default('CNC'),
    quantity: z.number().positive(),
    price: z.number().nonnegative().nullable().optional(),
    stopPrice: z.number().nonnegative().nullable().optional(),
    reduceOnly: z.boolean().optional(),
    refPrice: z.number().positive().nullable().optional(),
    bypassSemiAuto: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('cancelOrder'),
    orderId: z.string().min(2),
  }),
  z.object({
    action: z.literal('closePosition'),
    positionId: z.string().min(2),
    price: z.number().positive().optional(),
  }),
  z.object({
    action: z.literal('matchTicks'),
    portfolioId: z.string().default('paper-default'),
    ticks: z.array(
      z.object({
        symbol: z.string().min(2),
        last: z.number().positive(),
        bid: z.number().positive().nullable().optional(),
        ask: z.number().positive().nullable().optional(),
      }),
    ),
  }),
  z.object({
    action: z.literal('createPortfolio'),
    name: z.string().min(1).max(60),
    balance: z.number().positive(),
    currency: z.string().default('USD'),
    leverage: z.number().min(1).max(50).default(2),
    feeRate: z.number().min(0).max(0.05).default(0.001),
  }),
  z.object({
    action: z.literal('resetPortfolio'),
    portfolioId: z.string().default('paper-default'),
  }),
  z.object({
    action: z.literal('topUp'),
    portfolioId: z.string().default('paper-default'),
    balance: z.number().nonnegative(),
  }),
]);

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = paperActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid paper trading request.', issues: parsed.error.issues }, { status: 400 });
  }

  const d = parsed.data;
  try {
    if (d.action === 'placeOrder') {
      let refPrice = d.refPrice ?? d.price ?? null;
      if (!refPrice) {
        const loaded = await loadSymbolBars(db, d.symbol, '1h', 60, true);
        refPrice = loaded.bars[loaded.bars.length - 1]?.close ?? null;
      }

      const policy = await loadRiskPolicy(db);
      if (policy.semiAutoMode && !policy.oneClickEnabled && !d.bypassSemiAuto) {
        const packet = await queueActionPacket(db, {
          accountId: d.portfolioId,
          symbol: d.symbol,
          exchange: d.exchange,
          side: d.side,
          orderType: d.orderType,
          product: d.product,
          quantity: d.quantity,
          price: d.price,
          stopPrice: d.stopPrice,
          refPrice,
          reduceOnly: d.reduceOnly,
          strategy: 'paper-ticket',
          rationale: 'Routed through SemiAuto safety guard for operator sign-off',
        });
        return Response.json({ routedToActionCenter: true, packet, workspace: await getPaperWorkspace(db, d.portfolioId) });
      }

      const orderRes = await placePaperOrder(db, {
        portfolioId: d.portfolioId,
        symbol: d.symbol,
        exchange: d.exchange,
        side: d.side,
        orderType: d.orderType,
        product: d.product,
        quantity: d.quantity,
        price: d.price,
        stopPrice: d.stopPrice,
        reduceOnly: d.reduceOnly,
        refPrice,
      });
      return Response.json({ routedToActionCenter: false, orderRes, workspace: await getPaperWorkspace(db, d.portfolioId) });
    }

    if (d.action === 'cancelOrder') {
      await cancelPaperOrder(db, d.orderId);
      return Response.json({ cancelled: d.orderId, workspace: await getPaperWorkspace(db) });
    }

    if (d.action === 'closePosition') {
      const res = await closePaperPosition(db, d.positionId, d.price);
      return Response.json({ closed: res, workspace: await getPaperWorkspace(db) });
    }

    if (d.action === 'matchTicks') {
      const matched = await matchPendingPaperOrders(db, d.portfolioId, d.ticks);
      return Response.json({ matched, workspace: await getPaperWorkspace(db, d.portfolioId) });
    }

    if (d.action === 'createPortfolio') {
      const created = await createPaperPortfolio(db, d);
      return Response.json({ created, workspace: await getPaperWorkspace(db, created.id) }, { status: 201 });
    }

    if (d.action === 'resetPortfolio') {
      await resetPaperPortfolio(db, d.portfolioId);
      return Response.json({ reset: true, workspace: await getPaperWorkspace(db, d.portfolioId) });
    }

    await topUpPaperPortfolio(db, d.portfolioId, d.balance);
    return Response.json({ updated: true, workspace: await getPaperWorkspace(db, d.portfolioId) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Paper action failed.' }, { status: 400 });
  }
}
