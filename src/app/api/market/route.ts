// route.ts — market read endpoint with durable source health logging. Dependencies: market, db.
import { getDb } from '../../../lib/db';
import { fetchMarket, getMarketSessions, marketQuery } from '../../../lib/market';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const result = marketQuery.safeParse({ symbol: new URL(request.url).searchParams.get('symbol') ?? undefined });
  if (!result.success) return Response.json({ error: 'Invalid symbol; use BASE/QUOTE.' }, { status: 400 });
  const db = await getDb();
  const snapshot = await fetchMarket(result.data.symbol, db);
  return Response.json({ ...snapshot, sessions: getMarketSessions() }, { headers: { 'Cache-Control': 'no-store' } });
}
