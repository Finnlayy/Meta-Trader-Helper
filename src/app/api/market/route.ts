// route.ts — market read endpoint. Dependencies: market adapter, Next.js.
import { marketQuery, fetchMarket } from '../../../lib/market';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const result = marketQuery.safeParse({ symbol: new URL(request.url).searchParams.get('symbol') ?? undefined });
  if (!result.success) return Response.json({ error: 'Invalid symbol; use BASE/QUOTE.' }, { status: 400 });
  return Response.json(await fetchMarket(result.data.symbol), { headers: { 'Cache-Control': 'no-store' } });
}
