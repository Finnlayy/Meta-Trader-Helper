// paper.ts — paper trading engine, touch-based OrderMatcher, and portfolio risk analytics ported from FinceptTerminal PaperTrading.cpp, OrderMatcher.cpp & PortfolioService_Metrics.cpp. Dependencies: schema, risk, market.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { isMarketOpen } from './market';
import { evaluatePreTradeRisk, isKillSwitchActive, loadRiskPolicy, type OrderCandidate, type OrderSide, type OrderType } from './risk';
import { auditLog, paperOrders, paperPortfolios, paperPositions, paperTrades } from './schema';

export type TickQuote = {
  symbol: string;
  last: number;
  bid?: number | null;
  ask?: number | null;
};

export type PlacePaperOrderInput = {
  portfolioId: string;
  symbol: string;
  exchange?: string;
  side: OrderSide;
  orderType: OrderType;
  product?: 'MIS' | 'CNC' | 'NRML';
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  reduceOnly?: boolean;
  refPrice?: number | null;
  skipRiskGate?: boolean;
};

export type PortfolioAnalytics = {
  equity: number;
  cashBalance: number;
  heldMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  todayPnl: number;
  totalReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  totalFees: number;
  turnover: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  var95Pct: number;
  cvar95Pct: number;
  top3ConcentrationPct: number;
  hhiConcentration: number;
  compositeRiskScore: number;
};

export function calculateRequiredMargin(
  portfolioLeverage: number,
  product: string,
  quantity: number,
  price: number,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) return 0;
  let lev = portfolioLeverage > 0 ? portfolioLeverage : 1;
  if (product.toUpperCase() === 'CNC') lev = 1;
  else if (product.toUpperCase() === 'MIS') lev = Math.max(lev, 5);
  return (quantity * price) / lev;
}

export async function getTodayRealizedPnl(db: AppDatabase, portfolioId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ pnl: paperTrades.pnl })
    .from(paperTrades)
    .where(and(eq(paperTrades.portfolioId, portfolioId), gte(paperTrades.timestamp, startOfDay)));
  return rows.reduce((sum, r) => sum + (Number.isFinite(r.pnl) ? r.pnl : 0), 0);
}

export async function createPaperPortfolio(
  db: AppDatabase,
  input: { name: string; balance: number; currency?: string; leverage?: number; feeRate?: number; enforceMarketHours?: boolean },
) {
  if (!input.name.trim()) throw new Error('Portfolio name cannot be empty');
  if (!Number.isFinite(input.balance) || input.balance <= 0) throw new Error('Initial balance must be positive');
  const id = `paper-${randomUUID().slice(0, 8)}`;
  const [created] = await db
    .insert(paperPortfolios)
    .values({
      id,
      name: input.name.trim(),
      currency: (input.currency ?? 'USD').toUpperCase(),
      initialBalance: input.balance,
      balance: input.balance,
      leverage: Math.max(1, input.leverage ?? 2),
      feeRate: Math.min(0.05, Math.max(0, input.feeRate ?? 0.001)),
      enforceMarketHours: input.enforceMarketHours ?? false,
    })
    .returning();
  await db.insert(auditLog).values({ actor: 'operator', action: 'paper_portfolio_created', details: { id, name: created.name, balance: created.balance } });
  return created;
}

export async function resetPaperPortfolio(db: AppDatabase, portfolioId: string) {
  const [p] = await db.select().from(paperPortfolios).where(eq(paperPortfolios.id, portfolioId)).limit(1);
  if (!p) throw new Error('Portfolio not found');
  await db.transaction(async (tx) => {
    await tx.delete(paperTrades).where(eq(paperTrades.portfolioId, portfolioId));
    await tx.delete(paperOrders).where(eq(paperOrders.portfolioId, portfolioId));
    await tx.delete(paperPositions).where(eq(paperPositions.portfolioId, portfolioId));
    await tx
      .update(paperPortfolios)
      .set({ balance: p.initialBalance, updatedAt: new Date() })
      .where(eq(paperPortfolios.id, portfolioId));
    await tx.insert(auditLog).values({ actor: 'operator', action: 'paper_portfolio_reset', details: { portfolioId } });
  });
}

export async function topUpPaperPortfolio(db: AppDatabase, portfolioId: string, newBalance: number) {
  if (!Number.isFinite(newBalance) || newBalance < 0) throw new Error('Balance must be finite and non-negative');
  await db
    .update(paperPortfolios)
    .set({ balance: newBalance, updatedAt: new Date() })
    .where(eq(paperPortfolios.id, portfolioId));
  await db.insert(auditLog).values({ actor: 'operator', action: 'paper_balance_updated', details: { portfolioId, newBalance } });
}

export async function placePaperOrder(db: AppDatabase, input: PlacePaperOrderInput) {
  const symbol = input.symbol.trim().toUpperCase();
  const exchange = (input.exchange ?? 'CRYPTO').trim().toUpperCase();
  const product = input.product ?? 'CNC';
  const reduceOnly = Boolean(input.reduceOnly);

  const [portfolio] = await db.select().from(paperPortfolios).where(eq(paperPortfolios.id, input.portfolioId)).limit(1);
  if (!portfolio) throw new Error('Paper portfolio not found');

  const positions = await db.select().from(paperPositions).where(eq(paperPositions.portfolioId, portfolio.id));
  const oppositeSide = input.side === 'buy' ? 'short' : 'long';
  const oppPos = positions.find((p) => p.symbol === symbol && p.side === oppositeSide);
  const samePos = positions.find((p) => p.symbol === symbol && p.side === (input.side === 'buy' ? 'long' : 'short'));

  const reducesPosition = reduceOnly || (oppPos !== undefined && input.quantity <= oppPos.quantity);
  const refPrice = input.refPrice ?? input.price ?? input.stopPrice ?? oppPos?.currentPrice ?? samePos?.currentPrice ?? 0;

  if (!input.skipRiskGate) {
    const policy = await loadRiskPolicy(db);
    const killed = await isKillSwitchActive(db);
    const dayPnl = await getTodayRealizedPnl(db, portfolio.id);
    const candidate: OrderCandidate = {
      symbol,
      exchange,
      side: input.side,
      orderType: input.orderType,
      quantity: input.quantity,
      price: input.price,
      stopPrice: input.stopPrice,
      reduceOnly,
      leverage: product === 'MIS' ? Math.max(portfolio.leverage, 5) : product === 'CNC' ? 1 : portfolio.leverage,
    };
    const riskCheck = evaluatePreTradeRisk(candidate, policy, {
      refPrice,
      buyingPower: portfolio.balance,
      dayPnl,
      dayPnlKnown: true,
      openPositionCount: positions.length,
      reducesPosition,
      killed,
      enforcedAccount: true,
    });
    if (!riskCheck.valid) {
      const reason = riskCheck.errors.join(' | ');
      const rejId = `po-${randomUUID().slice(0, 10)}`;
      await db.insert(paperOrders).values({
        id: rejId,
        portfolioId: portfolio.id,
        symbol,
        exchange,
        side: input.side,
        orderType: input.orderType,
        product,
        quantity: input.quantity,
        price: input.price ?? null,
        stopPrice: input.stopPrice ?? null,
        status: 'rejected',
        rejectionReason: reason,
        reduceOnly,
        marginBlocked: 0,
      });
      throw new Error(reason);
    }
  }

  if (portfolio.enforceMarketHours && !isMarketOpen(exchange)) {
    const reason = `Market closed for exchange ${exchange}`;
    await db.insert(paperOrders).values({
      id: `po-${randomUUID().slice(0, 10)}`,
      portfolioId: portfolio.id,
      symbol,
      exchange,
      side: input.side,
      orderType: input.orderType,
      product,
      quantity: input.quantity,
      price: input.price ?? null,
      stopPrice: input.stopPrice ?? null,
      status: 'rejected',
      rejectionReason: reason,
      reduceOnly,
      marginBlocked: 0,
    });
    throw new Error(reason);
  }

  let marginToBlock = 0;
  if (!reduceOnly) {
    const netNewQty = oppPos ? Math.max(0, input.quantity - oppPos.quantity) : input.quantity;
    if (netNewQty > 0) {
      if (refPrice <= 0) {
        throw new Error('Market/resting order requires a valid reference or limit price for margin check');
      }
      marginToBlock = calculateRequiredMargin(portfolio.leverage, product, netNewQty, refPrice);
      if (marginToBlock > portfolio.balance + 1e-6) {
        const reason = `Insufficient paper margin: required ${marginToBlock.toFixed(2)}, available ${portfolio.balance.toFixed(2)}`;
        await db.insert(paperOrders).values({
          id: `po-${randomUUID().slice(0, 10)}`,
          portfolioId: portfolio.id,
          symbol,
          exchange,
          side: input.side,
          orderType: input.orderType,
          product,
          quantity: input.quantity,
          price: input.price ?? null,
          stopPrice: input.stopPrice ?? null,
          status: 'rejected',
          rejectionReason: reason,
          reduceOnly,
          marginBlocked: 0,
        });
        throw new Error(reason);
      }
    }
  }

  const orderId = `po-${randomUUID().slice(0, 10)}`;
  await db.transaction(async (tx) => {
    await tx.insert(paperOrders).values({
      id: orderId,
      portfolioId: portfolio.id,
      symbol,
      exchange,
      side: input.side,
      orderType: input.orderType,
      product,
      quantity: input.quantity,
      price: input.price ?? null,
      stopPrice: input.stopPrice ?? null,
      filledQty: 0,
      marginBlocked: marginToBlock,
      reduceOnly,
      status: 'pending',
    });
    if (marginToBlock > 0) {
      await tx
        .update(paperPortfolios)
        .set({ balance: portfolio.balance - marginToBlock, updatedAt: new Date() })
        .where(eq(paperPortfolios.id, portfolio.id));
    }
  });

  if (input.orderType === 'market' && refPrice > 0) {
    const fill = await fillPaperOrder(db, orderId, refPrice);
    return { orderId, status: 'filled' as const, trade: fill };
  }

  return { orderId, status: 'pending' as const, trade: null };
}

export async function cancelPaperOrder(db: AppDatabase, orderId: string) {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(paperOrders).where(eq(paperOrders.id, orderId)).limit(1);
    if (!order || (order.status !== 'pending' && order.status !== 'partial')) return;

    if (order.marginBlocked > 0) {
      const [p] = await tx.select().from(paperPortfolios).where(eq(paperPortfolios.id, order.portfolioId)).limit(1);
      if (p) {
        await tx
          .update(paperPortfolios)
          .set({ balance: p.balance + order.marginBlocked, updatedAt: new Date() })
          .where(eq(paperPortfolios.id, p.id));
      }
    }

    await tx
      .update(paperOrders)
      .set({ status: 'cancelled', marginBlocked: 0 })
      .where(eq(paperOrders.id, orderId));
  });
}

export async function fillPaperOrder(db: AppDatabase, orderId: string, fillPrice: number) {
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) throw new Error('Invalid fill price');

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(paperOrders).where(eq(paperOrders.id, orderId)).limit(1);
    if (!order) throw new Error('Order not found');
    if (order.status !== 'pending' && order.status !== 'partial') throw new Error('Order is not fillable');

    const [portfolio] = await tx.select().from(paperPortfolios).where(eq(paperPortfolios.id, order.portfolioId)).limit(1);
    if (!portfolio) throw new Error('Portfolio not found');

    let qty = order.quantity - order.filledQty;
    if (qty <= 0) throw new Error('Nothing left to fill');

    const positionSide = order.side === 'buy' ? 'long' : 'short';
    const oppositeSide = order.side === 'buy' ? 'short' : 'long';

    const positions = await tx.select().from(paperPositions).where(eq(paperPositions.portfolioId, portfolio.id));
    const opp = positions.find((p) => p.symbol === order.symbol && p.side === oppositeSide);

    if (order.reduceOnly) {
      const reducible = opp?.quantity ?? 0;
      if (reducible <= 0) {
        await tx.update(paperOrders).set({ status: 'cancelled', marginBlocked: 0 }).where(eq(paperOrders.id, orderId));
        throw new Error('Reduce-only order has no opposite position to reduce');
      }
      if (qty > reducible) qty = reducible;
    }

    const fee = qty * fillPrice * portfolio.feeRate;
    let pnl = 0;
    let balanceDelta = -fee;
    let closeQty = 0;

    if (opp) {
      closeQty = Math.min(qty, opp.quantity);
      pnl = opp.side === 'long' ? (fillPrice - opp.entryPrice) * closeQty : (opp.entryPrice - fillPrice) * closeQty;
      const fracClose = opp.quantity > 0 ? closeQty / opp.quantity : 1;
      const marginReleased = opp.heldMargin * fracClose;
      if (closeQty >= opp.quantity - 1e-12) {
        await tx.delete(paperPositions).where(eq(paperPositions.id, opp.id));
      } else {
        await tx
          .update(paperPositions)
          .set({
            quantity: opp.quantity - closeQty,
            heldMargin: Math.max(0, opp.heldMargin - marginReleased),
            realizedPnl: opp.realizedPnl + pnl,
            currentPrice: fillPrice,
            updatedAt: new Date(),
          })
          .where(eq(paperPositions.id, opp.id));
      }
      balanceDelta += marginReleased + pnl;
    }

    const openQty = qty - closeQty;
    if (openQty > 1e-12) {
      const openMargin = calculateRequiredMargin(portfolio.leverage, order.product, openQty, fillPrice);
      balanceDelta += order.marginBlocked - openMargin;

      const same = positions.find((p) => p.symbol === order.symbol && p.side === positionSide);
      if (same) {
        const newQty = same.quantity + openQty;
        const newEntry = (same.entryPrice * same.quantity + fillPrice * openQty) / newQty;
        await tx
          .update(paperPositions)
          .set({
            quantity: newQty,
            entryPrice: newEntry,
            currentPrice: fillPrice,
            heldMargin: same.heldMargin + openMargin,
            updatedAt: new Date(),
          })
          .where(eq(paperPositions.id, same.id));
      } else {
        await tx.insert(paperPositions).values({
          id: `pos-${randomUUID().slice(0, 10)}`,
          portfolioId: portfolio.id,
          symbol: order.symbol,
          exchange: order.exchange,
          side: positionSide,
          product: order.product,
          quantity: openQty,
          entryPrice: fillPrice,
          currentPrice: fillPrice,
          heldMargin: openMargin,
          realizedPnl: 0,
          leverage: openMargin > 0 ? (openQty * fillPrice) / openMargin : portfolio.leverage,
        });
      }
    } else if (order.marginBlocked > 0) {
      balanceDelta += order.marginBlocked;
    }

    await tx
      .update(paperPortfolios)
      .set({ balance: portfolio.balance + balanceDelta, updatedAt: new Date() })
      .where(eq(paperPortfolios.id, portfolio.id));

    const now = new Date();
    await tx
      .update(paperOrders)
      .set({
        filledQty: order.filledQty + qty,
        avgPrice: fillPrice,
        status: 'filled',
        marginBlocked: 0,
        filledAt: now,
      })
      .where(eq(paperOrders.id, orderId));

    const tradeId = `pt-${randomUUID().slice(0, 10)}`;
    const [trade] = await tx
      .insert(paperTrades)
      .values({
        id: tradeId,
        portfolioId: portfolio.id,
        orderId,
        symbol: order.symbol,
        side: order.side,
        price: fillPrice,
        quantity: qty,
        fee,
        pnl,
        timestamp: now,
      })
      .returning();

    await tx.insert(auditLog).values({
      actor: 'paper-engine',
      action: 'paper_order_filled',
      details: { orderId, tradeId, symbol: order.symbol, side: order.side, qty, fillPrice, pnl, fee },
    });

    return trade;
  });
}

/**
 * Touch-based OrderMatcher (ported from FinceptTerminal OrderMatcher.cpp).
 * Evaluates resting limit / stop / stop_limit orders and marks open positions to market.
 */
export async function matchPendingPaperOrders(
  db: AppDatabase,
  portfolioId: string,
  ticks: TickQuote[],
): Promise<{ matchedOrders: string[]; updatedPositions: number }> {
  const tickMap = new Map(ticks.map((t) => [t.symbol.trim().toUpperCase(), t]));
  const matchedOrders: string[] = [];
  let updatedPositions = 0;

  // Update mark prices on open positions
  const openPositions = await db.select().from(paperPositions).where(eq(paperPositions.portfolioId, portfolioId));
  for (const pos of openPositions) {
    const tick = tickMap.get(pos.symbol.toUpperCase());
    if (tick && Number.isFinite(tick.last) && tick.last > 0) {
      await db
        .update(paperPositions)
        .set({ currentPrice: tick.last, updatedAt: new Date() })
        .where(eq(paperPositions.id, pos.id));
      updatedPositions++;
    }
  }

  const pending = await db
    .select()
    .from(paperOrders)
    .where(and(eq(paperOrders.portfolioId, portfolioId), inArray(paperOrders.status, ['pending', 'partial'])));

  for (const ord of pending) {
    const tick = tickMap.get(ord.symbol.toUpperCase());
    if (!tick || !Number.isFinite(tick.last) || tick.last <= 0) continue;

    const ask = tick.ask && tick.ask > 0 ? tick.ask : tick.last;
    const bid = tick.bid && tick.bid > 0 ? tick.bid : tick.last;

    let shouldFill = false;
    let fillPrice = tick.last;

    if (ord.orderType === 'limit' && ord.price && ord.price > 0) {
      shouldFill = ord.side === 'buy' ? ask <= ord.price : bid >= ord.price;
      fillPrice = ord.price;
    } else if (ord.orderType === 'stop' && ord.stopPrice && ord.stopPrice > 0) {
      shouldFill = ord.side === 'buy' ? tick.last >= ord.stopPrice : tick.last <= ord.stopPrice;
      fillPrice = tick.last;
    } else if (ord.orderType === 'stop_limit' && ord.stopPrice && ord.stopPrice > 0 && ord.price && ord.price > 0) {
      const triggered = ord.side === 'buy' ? tick.last >= ord.stopPrice : tick.last <= ord.stopPrice;
      const limitMet = ord.side === 'buy' ? ask <= ord.price : bid >= ord.price;
      shouldFill = triggered && limitMet;
      fillPrice = ord.price;
    }

    if (shouldFill) {
      try {
        await fillPaperOrder(db, ord.id, fillPrice);
        matchedOrders.push(ord.id);
      } catch {
        // Order may fail reduce-only check if position closed concurrently
      }
    }
  }

  return { matchedOrders, updatedPositions };
}

export async function closePaperPosition(db: AppDatabase, positionId: string, priceOverride?: number) {
  const [pos] = await db.select().from(paperPositions).where(eq(paperPositions.id, positionId)).limit(1);
  if (!pos) throw new Error('Position not found');
  const px = priceOverride && priceOverride > 0 ? priceOverride : pos.currentPrice;
  return placePaperOrder(db, {
    portfolioId: pos.portfolioId,
    symbol: pos.symbol,
    exchange: pos.exchange,
    side: pos.side === 'long' ? 'sell' : 'buy',
    orderType: 'market',
    product: (pos.product as 'MIS' | 'CNC' | 'NRML') || 'CNC',
    quantity: pos.quantity,
    reduceOnly: true,
    refPrice: px,
    skipRiskGate: false,
  });
}

export function computePortfolioAnalytics(
  portfolio: { initialBalance: number; balance: number },
  positions: { symbol: string; side: string; quantity: number; entryPrice: number; currentPrice: number; heldMargin: number }[],
  trades: { pnl: number; fee: number; price: number; quantity: number; timestamp: Date | string }[],
): PortfolioAnalytics {
  let heldMargin = 0;
  let unrealizedPnl = 0;
  const notionalBySymbol = new Map<string, number>();
  let totalNotional = 0;

  for (const pos of positions) {
    heldMargin += pos.heldMargin;
    const uPnl =
      pos.side === 'long'
        ? (pos.currentPrice - pos.entryPrice) * pos.quantity
        : (pos.entryPrice - pos.currentPrice) * pos.quantity;
    unrealizedPnl += uPnl;
    const n = Math.abs(pos.quantity * pos.currentPrice);
    totalNotional += n;
    notionalBySymbol.set(pos.symbol, (notionalBySymbol.get(pos.symbol) ?? 0) + n);
  }

  const equity = portfolio.balance + heldMargin + unrealizedPnl;
  const totalReturnPct = portfolio.initialBalance > 0 ? ((equity - portfolio.initialBalance) / portfolio.initialBalance) * 100 : 0;

  let realizedPnl = 0;
  let todayPnl = 0;
  let winningTrades = 0;
  let losingTrades = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalFees = 0;
  let turnover = 0;
  const todayUtc = new Date().toISOString().slice(0, 10);

  // Build chronological equity steps from trades for drawdown, Sharpe, Sortino, VaR
  const sortedTrades = [...trades].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const tradeReturns: number[] = [];
  let runningEq = portfolio.initialBalance;
  let peakEq = portfolio.initialBalance;
  let maxDrawdownPct = 0;

  for (const t of sortedTrades) {
    realizedPnl += t.pnl;
    totalFees += t.fee;
    turnover += t.price * t.quantity;
    if (new Date(t.timestamp).toISOString().slice(0, 10) === todayUtc) {
      todayPnl += t.pnl;
    }
    if (t.pnl > 0) {
      winningTrades++;
      grossProfit += t.pnl;
      if (t.pnl > largestWin) largestWin = t.pnl;
    } else if (t.pnl < 0) {
      losingTrades++;
      grossLoss += t.pnl;
      if (t.pnl < largestLoss) largestLoss = t.pnl;
    }

    const net = t.pnl - t.fee;
    if (runningEq > 0) tradeReturns.push(net / runningEq);
    runningEq = Math.max(1, runningEq + net);
    if (runningEq > peakEq) peakEq = runningEq;
    const dd = peakEq > 0 ? ((peakEq - runningEq) / peakEq) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const totalTrades = trades.length;
  const winRatePct = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? 999.99 : 0;
  const avgWin = winningTrades > 0 ? grossProfit / winningTrades : 0;
  const avgLoss = losingTrades > 0 ? grossLoss / losingTrades : 0;

  let sharpeRatio = 0;
  let sortinoRatio = 0;
  let var95Pct = 0;
  let cvar95Pct = 0;
  if (tradeReturns.length >= 2) {
    const mean = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
    const variance = tradeReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / tradeReturns.length;
    const downsideVar = tradeReturns.reduce((s, r) => s + (r < 0 ? r * r : 0), 0) / tradeReturns.length;
    const sd = Math.sqrt(variance);
    const dsd = Math.sqrt(downsideVar);
    const ann = Math.sqrt(252);
    if (sd > 0) sharpeRatio = (mean / sd) * ann;
    if (dsd > 0) sortinoRatio = (mean / dsd) * ann;

    const sortedRets = [...tradeReturns].sort((a, b) => a - b);
    const idx = Math.max(0, Math.floor(0.05 * sortedRets.length));
    var95Pct = Math.abs(Math.min(0, sortedRets[idx])) * 100;
    const tail = sortedRets.slice(0, Math.max(1, idx + 1));
    const tailMean = tail.reduce((a, b) => a + b, 0) / tail.length;
    cvar95Pct = Math.abs(Math.min(0, tailMean)) * 100;
  }

  const weights = totalNotional > 0 ? Array.from(notionalBySymbol.values()).map((v) => v / totalNotional).sort((a, b) => b - a) : [];
  const top3ConcentrationPct = weights.slice(0, 3).reduce((s, w) => s + w, 0) * 100;
  const hhiConcentration = weights.reduce((s, w) => s + w * w, 0) * 100;

  const ddScore = Math.min(1, maxDrawdownPct / 50) * 35;
  const concScore = Math.min(1, top3ConcentrationPct / 100) * 25;
  const varScore = Math.min(1, var95Pct / 10) * 25;
  const marginUtilPct = equity > 0 ? Math.min(1, heldMargin / equity) * 15 : 0;
  const compositeRiskScore = Math.round(Math.min(100, ddScore + concScore + varScore + marginUtilPct));

  return {
    equity: Number(equity.toFixed(2)),
    cashBalance: Number(portfolio.balance.toFixed(2)),
    heldMargin: Number(heldMargin.toFixed(2)),
    unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    realizedPnl: Number(realizedPnl.toFixed(2)),
    todayPnl: Number(todayPnl.toFixed(2)),
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePct: Number(winRatePct.toFixed(1)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    largestWin: Number(largestWin.toFixed(2)),
    largestLoss: Number(largestLoss.toFixed(2)),
    totalFees: Number(totalFees.toFixed(2)),
    turnover: Number(turnover.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(3)),
    sortinoRatio: Number(sortinoRatio.toFixed(3)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    var95Pct: Number(var95Pct.toFixed(2)),
    cvar95Pct: Number(cvar95Pct.toFixed(2)),
    top3ConcentrationPct: Number(top3ConcentrationPct.toFixed(1)),
    hhiConcentration: Number(hhiConcentration.toFixed(1)),
    compositeRiskScore,
  };
}

export async function getPaperWorkspace(db: AppDatabase, portfolioId = 'paper-default') {
  const portfolios = await db.select().from(paperPortfolios);
  const active = portfolios.find((p) => p.id === portfolioId) ?? portfolios[0] ?? null;
  if (!active) {
    return { portfolios: [], active: null, orders: [], positions: [], trades: [], analytics: null };
  }
  const orders = await db
    .select()
    .from(paperOrders)
    .where(eq(paperOrders.portfolioId, active.id))
    .orderBy(desc(paperOrders.createdAt))
    .limit(100);
  const positions = await db.select().from(paperPositions).where(eq(paperPositions.portfolioId, active.id));
  const trades = await db
    .select()
    .from(paperTrades)
    .where(eq(paperTrades.portfolioId, active.id))
    .orderBy(desc(paperTrades.timestamp))
    .limit(100);
  const analytics = computePortfolioAnalytics(active, positions, trades);
  return { portfolios, active, orders, positions, trades, analytics };
}
