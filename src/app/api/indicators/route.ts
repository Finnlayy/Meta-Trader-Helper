// route.ts — technical indicator catalog & computation API. Dependencies: indicators, screener, db.
import { z } from 'zod';
import { getDb } from '../../../lib/db';
import { computeIndicator, computeTechnicalSnapshot, INDICATOR_CATALOG } from '../../../lib/indicators';
import { evaluateGroup, type ConditionGroupNode, type ConditionNode } from '../../../lib/conditions';
import { loadSymbolBars } from '../../../lib/screener';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  const indicator = url.searchParams.get('indicator');
  if (!symbol) {
    return Response.json({ catalog: INDICATOR_CATALOG });
  }

  const db = await getDb();
  const timeframe = (url.searchParams.get('timeframe') ?? '1h') as '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
  const bars = db ? (await loadSymbolBars(db, symbol, timeframe, 200, true)).bars : [];
  if (indicator && bars.length > 0) {
    return Response.json({
      catalog: INDICATOR_CATALOG,
      indicator,
      result: computeIndicator(indicator, bars, {}),
      snapshot: computeTechnicalSnapshot(bars),
    });
  }
  return Response.json({
    catalog: INDICATOR_CATALOG,
    snapshot: bars.length > 0 ? computeTechnicalSnapshot(bars) : null,
  });
}

const evalSchema = z.object({
  symbol: z.string().default('BTC/USDT'),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).default('1h'),
  indicator: z.string().optional(),
  params: z.record(z.string(), z.number()).optional(),
  logic: z.enum(['AND', 'OR']).default('AND'),
  conditions: z.array(z.record(z.string(), z.unknown())).optional(),
});

export async function POST(request: Request) {
  const parsed = evalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid indicator evaluation payload.' }, { status: 400 });

  const db = await getDb();
  if (!db) return Response.json({ error: 'Database unavailable.' }, { status: 503 });
  const { bars, mode } = await loadSymbolBars(db, parsed.data.symbol, parsed.data.timeframe, 220, true);

  const indicatorResult = parsed.data.indicator
    ? computeIndicator(parsed.data.indicator, bars, parsed.data.params ?? {})
    : null;
  const conditionResult = parsed.data.conditions
    ? evaluateGroup(
        parsed.data.conditions as unknown as (ConditionNode | ConditionGroupNode)[],
        parsed.data.logic,
        bars,
      )
    : null;

  return Response.json({
    symbol: parsed.data.symbol,
    mode,
    snapshot: computeTechnicalSnapshot(bars),
    indicatorResult,
    conditionResult,
  });
}
