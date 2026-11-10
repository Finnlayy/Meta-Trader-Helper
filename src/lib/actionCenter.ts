// actionCenter.ts — semi-auto Action Packet approval queue, TTL expiry sweep, and meaningful kill-switch enforcement ported from FinceptTerminal ActionCenter.cpp. Dependencies: schema, risk, paper.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { closePaperPosition, cancelPaperOrder, placePaperOrder } from './paper';
import { evaluatePreTradeRisk, isKillSwitchActive, loadRiskPolicy, type OrderSide, type OrderType } from './risk';
import { auditLog, paperOrders, paperPortfolios, paperPositions, pendingActions, safetyState } from './schema';

export type QueueActionInput = {
  accountId?: string;
  symbol: string;
  exchange?: string;
  side: OrderSide;
  orderType: OrderType;
  product?: 'MIS' | 'CNC' | 'NRML';
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  refPrice?: number | null;
  reduceOnly?: boolean;
  strategy?: string;
  rationale?: string;
};

export type KillSwitchReport = {
  killed: boolean;
  queuedRejected: number;
  ordersCancelled: number;
  positionsClosed: number;
  errors: string[];
  reason: string;
  executedAt: string;
};

export async function expireStaleActions(db: AppDatabase, now = new Date()): Promise<number> {
  const expired = await db
    .update(pendingActions)
    .set({
      status: 'rejected',
      rejectionReason: 'Expired: approval window elapsed (stale market view — re-queue if still desired)',
      resolvedAt: now,
    })
    .where(and(eq(pendingActions.status, 'pending'), lte(pendingActions.expiresAt, now)))
    .returning({ id: pendingActions.id });

  if (expired.length > 0) {
    await db.insert(auditLog).values({
      actor: 'action-center',
      action: 'pending_actions_expired',
      details: { count: expired.length, ids: expired.map((e) => e.id) },
    });
  }
  return expired.length;
}

export async function queueActionPacket(db: AppDatabase, input: QueueActionInput) {
  const policy = await loadRiskPolicy(db);
  const killed = await isKillSwitchActive(db);
  const accountId = input.accountId ?? 'paper-default';
  const symbol = input.symbol.trim().toUpperCase();
  const exchange = (input.exchange ?? 'CRYPTO').trim().toUpperCase();
  const refPrice = input.refPrice ?? input.price ?? input.stopPrice ?? 0;

  const [portfolio] = await db.select().from(paperPortfolios).where(eq(paperPortfolios.id, accountId)).limit(1);
  const positions = await db.select().from(paperPositions).where(eq(paperPositions.portfolioId, accountId));
  const opp = positions.find((p) => p.symbol === symbol && p.side === (input.side === 'buy' ? 'short' : 'long'));
  const reducesPosition = Boolean(input.reduceOnly) || (opp !== undefined && input.quantity <= opp.quantity);

  const riskCheck = evaluatePreTradeRisk(
    {
      symbol,
      exchange,
      side: input.side,
      orderType: input.orderType,
      quantity: input.quantity,
      price: input.price,
      stopPrice: input.stopPrice,
      reduceOnly: input.reduceOnly,
    },
    policy,
    {
      refPrice,
      buyingPower: portfolio?.balance ?? 0,
      dayPnl: 0,
      dayPnlKnown: true,
      openPositionCount: positions.length,
      reducesPosition,
      killed,
      enforcedAccount: true,
    },
  );

  if (!riskCheck.valid) {
    throw new Error(riskCheck.errors.join(' | '));
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + policy.pendingTtlMinutes * 60_000);
  const id = `act-${randomUUID().slice(0, 10)}`;

  const [packet] = await db
    .insert(pendingActions)
    .values({
      id,
      accountId,
      orderType: 'placeorder',
      symbol,
      exchange,
      side: input.side,
      quantity: input.quantity,
      priceType: input.orderType,
      price: input.price ?? null,
      stopPrice: input.stopPrice ?? null,
      strategy: input.strategy ?? 'operator-ticket',
      rationale: input.rationale ?? '',
      orderData: {
        ...input,
        symbol,
        exchange,
        refPrice,
        expiresAt: expiresAt.toISOString(),
      },
      riskSnapshot: {
        notional: riskCheck.notional,
        warnings: riskCheck.warnings,
        reducesPosition,
        ttlMinutes: policy.pendingTtlMinutes,
      },
      status: 'pending',
      expiresAt,
      createdAt: now,
    })
    .returning();

  await db.insert(auditLog).values({
    actor: 'action-center',
    action: 'action_packet_queued',
    details: { id, symbol, side: input.side, quantity: input.quantity, strategy: packet.strategy },
  });

  return packet;
}

export async function approveActionPacket(db: AppDatabase, id: string) {
  await expireStaleActions(db);

  const [packet] = await db.select().from(pendingActions).where(eq(pendingActions.id, id)).limit(1);
  if (!packet) throw new Error('Action packet not found');
  if (packet.status !== 'pending') {
    throw new Error(`Action packet is already ${packet.status}${packet.rejectionReason ? `: ${packet.rejectionReason}` : ''}`);
  }
  if (new Date() >= packet.expiresAt) {
    await expireStaleActions(db);
    throw new Error('Action packet approval window expired (fail closed)');
  }

  const orderData = packet.orderData as Partial<QueueActionInput>;
  const result = await placePaperOrder(db, {
    portfolioId: packet.accountId,
    symbol: packet.symbol,
    exchange: packet.exchange,
    side: packet.side as OrderSide,
    orderType: packet.priceType as OrderType,
    product: orderData.product ?? 'CNC',
    quantity: packet.quantity,
    price: packet.price,
    stopPrice: packet.stopPrice,
    reduceOnly: Boolean(orderData.reduceOnly),
    refPrice: typeof orderData.refPrice === 'number' ? orderData.refPrice : packet.price,
  });

  const [updated] = await db
    .update(pendingActions)
    .set({
      status: 'approved',
      brokerOrderId: result.orderId,
      resolvedAt: new Date(),
    })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.status, 'pending')))
    .returning();

  await db.insert(auditLog).values({
    actor: 'operator',
    action: 'action_packet_approved',
    details: { id, orderId: result.orderId, status: result.status },
  });

  return { packet: updated, orderResult: result };
}

export async function rejectActionPacket(db: AppDatabase, id: string, reason: string) {
  const [updated] = await db
    .update(pendingActions)
    .set({
      status: 'rejected',
      rejectionReason: reason || 'Rejected by operator',
      resolvedAt: new Date(),
    })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.status, 'pending')))
    .returning();
  if (!updated) throw new Error('Pending action packet not found');
  await db.insert(auditLog).values({
    actor: 'operator',
    action: 'action_packet_rejected',
    details: { id, reason: updated.rejectionReason },
  });
  return updated;
}

export async function executeKillSwitch(
  db: AppDatabase,
  options?: { reason?: string; squareOffPositions?: boolean; actor?: string },
): Promise<KillSwitchReport> {
  const now = new Date();
  const reason = options?.reason?.trim() || 'Operator emergency kill switch engaged';
  const actor = options?.actor ?? 'operator';
  const errors: string[] = [];

  await db
    .insert(safetyState)
    .values({ id: 1, killed: true, reason, updatedAt: now })
    .onConflictDoUpdate({ target: safetyState.id, set: { killed: true, reason, updatedAt: now } });

  const rejectedQueued = await db
    .update(pendingActions)
    .set({
      status: 'rejected',
      rejectionReason: `Cancelled by Kill Switch: ${reason}`,
      resolvedAt: now,
    })
    .where(eq(pendingActions.status, 'pending'))
    .returning({ id: pendingActions.id });

  const restingOrders = await db
    .select()
    .from(paperOrders)
    .where(inArray(paperOrders.status, ['pending', 'partial']));

  let ordersCancelled = 0;
  for (const ord of restingOrders) {
    try {
      await cancelPaperOrder(db, ord.id);
      ordersCancelled++;
    } catch (err) {
      errors.push(`Cancel order ${ord.id}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  let positionsClosed = 0;
  if (options?.squareOffPositions) {
    const openPositions = await db.select().from(paperPositions);
    for (const pos of openPositions) {
      try {
        await closePaperPosition(db, pos.id);
        positionsClosed++;
      } catch (err) {
        errors.push(`Close position ${pos.symbol}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
  }

  await db.insert(auditLog).values({
    actor,
    action: 'kill_switch',
    details: {
      reason,
      queuedRejected: rejectedQueued.length,
      ordersCancelled,
      positionsClosed,
      errors,
    },
  });

  return {
    killed: true,
    queuedRejected: rejectedQueued.length,
    ordersCancelled,
    positionsClosed,
    errors,
    reason,
    executedAt: now.toISOString(),
  };
}

export async function resumeFromKillSwitch(db: AppDatabase, reason: string) {
  if (!reason.trim()) throw new Error('A resume justification is required to clear the kill switch');
  const now = new Date();
  await db
    .insert(safetyState)
    .values({ id: 1, killed: false, reason: `Resumed: ${reason.trim()}`, updatedAt: now })
    .onConflictDoUpdate({
      target: safetyState.id,
      set: { killed: false, reason: `Resumed: ${reason.trim()}`, updatedAt: now },
    });
  await db.insert(auditLog).values({
    actor: 'operator',
    action: 'kill_switch_resumed',
    details: { reason: reason.trim() },
  });
}

export async function listActionCenterState(db: AppDatabase) {
  await expireStaleActions(db);
  const actions = await db.select().from(pendingActions).orderBy(desc(pendingActions.createdAt)).limit(100);
  const stats = {
    totalPending: actions.filter((a) => a.status === 'pending').length,
    totalApproved: actions.filter((a) => a.status === 'approved').length,
    totalRejected: actions.filter((a) => a.status === 'rejected').length,
    totalBuy: actions.filter((a) => a.side === 'buy').length,
    totalSell: actions.filter((a) => a.side === 'sell').length,
  };
  return { actions, stats };
}
