// route.ts — terminal status, safety state, source registry, market hours, and pending action summary. Dependencies: db, bootstrap, market, metaapi, actionCenter.
import { desc, eq } from 'drizzle-orm';
import { getDatabaseHealth, getDb } from '../../../lib/db';
import { expireStaleActions } from '../../../lib/actionCenter';
import { getMarketSessions } from '../../../lib/market';
import { getMetaApiConnection } from '../../../lib/metaapi';
import { pendingActions, safetyState, sentimentEvents, sources } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await getDatabaseHealth();
  const db = await getDb();

  if (!db) {
    return Response.json({
      database: health.database,
      storageEngine: health.storageEngine,
      reason: health.reason,
      killed: null,
      killReason: null,
      pendingActions: 0,
      sources: [],
      marketSessions: getMarketSessions(),
      metaapiStatus: 'NOT_CONFIGURED',
      newsShockAlert: false,
    });
  }

  try {
    await expireStaleActions(db);
    const [safetyRows, sourceRows, pendingRows, newsRows, metaCfg] = await Promise.all([
      db.select().from(safetyState).where(eq(safetyState.id, 1)).limit(1),
      db.select().from(sources),
      db.select({ id: pendingActions.id }).from(pendingActions).where(eq(pendingActions.status, 'pending')),
      db.select({ shock: sentimentEvents.shockTriggered }).from(sentimentEvents).orderBy(desc(sentimentEvents.createdAt)).limit(25),
      getMetaApiConnection(db),
    ]);

    return Response.json(
      {
        database: health.database,
        storageEngine: health.storageEngine,
        reason: health.reason,
        killed: safetyRows[0]?.killed ?? false,
        killReason: safetyRows[0]?.reason ?? null,
        pendingActions: pendingRows.length,
        sources: sourceRows,
        marketSessions: getMarketSessions(),
        metaapiStatus: metaCfg.status,
        newsShockAlert: newsRows.some((n) => n.shock),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json({
      database: 'OFFLINE',
      storageEngine: health.storageEngine,
      reason: 'Database query failed.',
      killed: null,
      killReason: null,
      pendingActions: 0,
      sources: [],
      marketSessions: getMarketSessions(),
      metaapiStatus: 'OFFLINE',
      newsShockAlert: false,
    });
  }
}
