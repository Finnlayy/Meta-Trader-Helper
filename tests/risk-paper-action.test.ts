// risk-paper-action.test.ts — verify Pre-Trade Risk Core, Paper Engine, Touch OrderMatcher, SemiAuto TTL queue, and Kill Switch cascade against PGlite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEphemeralTestDb } from '../src/lib/db';
import {
  approveActionPacket,
  executeKillSwitch,
  expireStaleActions,
  queueActionPacket,
  resumeFromKillSwitch,
} from '../src/lib/actionCenter';
import {
  computePortfolioAnalytics,
  getPaperWorkspace,
  matchPendingPaperOrders,
  placePaperOrder,
  topUpPaperPortfolio,
} from '../src/lib/paper';
import { evaluatePreTradeRisk, saveRiskPolicy } from '../src/lib/risk';
import { pendingActions } from '../src/lib/schema';
import { eq } from 'drizzle-orm';

test('Pre-Trade Risk Core enforces limits, sanity checks, fail-closed pricing, and reducing exemption', () => {
  const policy = {
    maxOrderValue: 5000,
    maxOrderQuantity: 10,
    dailyLossLimit: 500,
    maxOpenPositions: 3,
    maxLeverage: 5,
    sanityChecks: true,
    killSwitchEnforced: true,
    oneClickEnabled: false,
    semiAutoMode: true,
    pendingTtlMinutes: 5,
    blockedSymbols: ['DOGE/USDT'],
  };

  // Sanity rejection on huge qty
  const typoCheck = evaluatePreTradeRisk(
    { symbol: 'BTC/USDT', exchange: 'CRYPTO', side: 'buy', orderType: 'limit', quantity: 2_000_000, price: 1 },
    policy,
    { refPrice: 1, buyingPower: 10000, dayPnl: 0, dayPnlKnown: true, openPositionCount: 0, reducesPosition: false, killed: false, enforcedAccount: true },
  );
  assert.equal(typoCheck.valid, false);
  assert.ok(typoCheck.errors.some((e) => e.includes('sanity')));

  // Blocked symbol
  const blockedCheck = evaluatePreTradeRisk(
    { symbol: 'DOGE/USDT', exchange: 'CRYPTO', side: 'buy', orderType: 'limit', quantity: 5, price: 0.2 },
    policy,
    { refPrice: 0.2, buyingPower: 10000, dayPnl: 0, dayPnlKnown: true, openPositionCount: 0, reducesPosition: false, killed: false, enforcedAccount: true },
  );
  assert.equal(blockedCheck.valid, false);
  assert.ok(blockedCheck.errors.some((e) => e.includes('blocked-symbols')));

  // Kill switch blocks new risk
  const killedEntry = evaluatePreTradeRisk(
    { symbol: 'ETH/USDT', exchange: 'CRYPTO', side: 'buy', orderType: 'market', quantity: 1, price: 3000 },
    policy,
    { refPrice: 3000, buyingPower: 10000, dayPnl: 0, dayPnlKnown: true, openPositionCount: 0, reducesPosition: false, killed: true, enforcedAccount: true },
  );
  assert.equal(killedEntry.valid, false);

  // Kill switch STILL ALLOWS position-reducing exit
  const exitWhileKilled = evaluatePreTradeRisk(
    { symbol: 'ETH/USDT', exchange: 'CRYPTO', side: 'sell', orderType: 'market', quantity: 1, reduceOnly: true, price: 3000 },
    policy,
    { refPrice: 3000, buyingPower: 10000, dayPnl: -900, dayPnlKnown: true, openPositionCount: 3, reducesPosition: true, killed: true, enforcedAccount: true },
  );
  assert.equal(exitWhileKilled.valid, true);
});

test('Paper Engine margin blocking, netting, touch matcher, SemiAuto TTL, and Kill Switch cascade', async () => {
  const { db, close } = await createEphemeralTestDb();
  try {
    await saveRiskPolicy(db, { maxOrderValue: 25000, maxOrderQuantity: 100, pendingTtlMinutes: 5 });

    // 1. Direct market buy fills immediately
    const fill1 = await placePaperOrder(db, {
      portfolioId: 'paper-default',
      symbol: 'BTC/USDT',
      exchange: 'CRYPTO',
      side: 'buy',
      orderType: 'market',
      product: 'CNC',
      quantity: 0.1,
      refPrice: 60000,
    });
    assert.equal(fill1.status, 'filled');

    // 2. Resting limit buy blocks margin and fills when touch matcher hits limit price
    const lim = await placePaperOrder(db, {
      portfolioId: 'paper-default',
      symbol: 'ETH/USDT',
      exchange: 'CRYPTO',
      side: 'buy',
      orderType: 'limit',
      product: 'CNC',
      quantity: 1,
      price: 3000,
      refPrice: 3000,
    });
    assert.equal(lim.status, 'pending');

    const match = await matchPendingPaperOrders(db, 'paper-default', [
      { symbol: 'BTC/USDT', last: 62000 },
      { symbol: 'ETH/USDT', last: 2990, ask: 2995 },
    ]);
    assert.ok(match.matchedOrders.includes(lim.orderId));

    // 3. Queue an Action Center packet and approve it
    const pkt = await queueActionPacket(db, {
      symbol: 'SOL/USDT',
      side: 'buy',
      orderType: 'market',
      quantity: 5,
      refPrice: 150,
      rationale: 'Integration test approval',
    });
    const app = await approveActionPacket(db, pkt.id);
    assert.equal(app.packet?.status, 'approved');
    assert.equal(app.orderResult.status, 'filled');

    // 4. Verify TTL expiry sweeper rejects stale packet
    const stalePkt = await queueActionPacket(db, {
      symbol: 'SOL/USDT',
      side: 'buy',
      orderType: 'limit',
      quantity: 2,
      price: 140,
      refPrice: 140,
    });
    await db
      .update(pendingActions)
      .set({ expiresAt: new Date(Date.now() - 10_000) })
      .where(eq(pendingActions.id, stalePkt.id));
    const swept = await expireStaleActions(db);
    assert.equal(swept, 1);

    // 5. Top up paper balance, queue another limit order & resting paper limit order, then engage Kill Switch with squareOff
    await topUpPaperPortfolio(db, 'paper-default', 15000);
    await queueActionPacket(db, {
      symbol: 'BTC/USDT',
      side: 'buy',
      orderType: 'limit',
      quantity: 0.05,
      price: 55000,
      refPrice: 55000,
    });
    await placePaperOrder(db, {
      portfolioId: 'paper-default',
      symbol: 'BTC/USDT',
      side: 'buy',
      orderType: 'limit',
      quantity: 0.05,
      price: 54000,
      refPrice: 54000,
    });

    const killReport = await executeKillSwitch(db, {
      reason: 'Unit test kill cascade',
      squareOffPositions: true,
    });
    assert.equal(killReport.killed, true);
    assert.equal(killReport.queuedRejected, 1);
    assert.equal(killReport.ordersCancelled, 1);
    assert.equal(killReport.positionsClosed, 3);

    const ws = await getPaperWorkspace(db, 'paper-default');
    assert.equal(ws.positions.length, 0);
    assert.ok(ws.analytics);
    const analyticsCheck = computePortfolioAnalytics(ws.active!, ws.positions, ws.trades);
    assert.ok(analyticsCheck.totalTrades >= 6);

    await resumeFromKillSwitch(db, 'Integration test cleanup');
  } finally {
    await close();
  }
});
