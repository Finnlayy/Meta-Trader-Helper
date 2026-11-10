// route.ts — multi-asset technical & condition-group screener API. Dependencies: screener, http.
import { z } from 'zod';
import { requireDb } from '../../../lib/http';
import { type ConditionGroupNode } from '../../../lib/conditions';
import { runTechnicalScreener } from '../../../lib/screener';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const url = new URL(request.url);
  const tf = (url.searchParams.get('timeframe') ?? '1h') as '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
  const rawSyms = url.searchParams.get('symbols');
  const symbols = rawSyms ? rawSyms.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const rows = await runTechnicalScreener(db, { symbols, timeframe: tf, allowBenchmarkFallback: true });
  return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });
}

const screenerPostSchema = z.object({
  symbols: z.array(z.string()).optional(),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).default('1h'),
  filter: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function POST(request: Request) {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = screenerPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid screener request.' }, { status: 400 });

  const rows = await runTechnicalScreener(db, {
    symbols: parsed.data.symbols,
    timeframe: parsed.data.timeframe,
    filter: (parsed.data.filter as unknown as ConditionGroupNode | null) ?? null,
    allowBenchmarkFallback: true,
  });
  return Response.json({ rows });
}
