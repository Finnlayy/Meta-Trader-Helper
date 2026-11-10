// route.ts — OHLCV candle reader, CSV/JSON uploader, and technical snapshot endpoint. Dependencies: market, indicators, screener, schema, http.
import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../lib/db';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { computeTechnicalSnapshot } from '../../../lib/indicators';
import { fetchOhlcv, generateDeterministicBenchmarkSeries, ohlcvQuery, parseOhlcvPayload, type OhlcvBar } from '../../../lib/market';
import { candlesCache } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

async function cacheBars(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, symbol: string, timeframe: string, bars: OhlcvBar[], source: string) {
  for (const bar of bars.slice(-300)) {
    const id = createHash('sha1').update(`${symbol}:${timeframe}:${bar.timestamp}`).digest('hex').slice(0, 20);
    await db
      .insert(candlesCache)
      .values({
        id,
        symbol,
        timeframe,
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        source,
      })
      .onConflictDoUpdate({
        target: candlesCache.id,
        set: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, source },
      });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = ohlcvQuery.safeParse({
    symbol: url.searchParams.get('symbol') ?? undefined,
    timeframe: url.searchParams.get('timeframe') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: 'Invalid query parameters; use symbol=BASE/QUOTE, timeframe=1m..1d.' }, { status: 400 });
  }

  const { symbol, timeframe, limit } = parsed.data;
  const allowBenchmark = url.searchParams.get('benchmark') !== 'false';
  const db = await getDb();

  const live = await fetchOhlcv(symbol, timeframe, limit, db);
  if (live.status === 'LIVE' && live.candles.length >= 2) {
    if (db) await cacheBars(db, symbol, timeframe, live.candles, `ccxt:${live.venue ?? 'live'}`);
    return Response.json(
      {
        mode: 'LIVE' as const,
        symbol,
        timeframe,
        venue: live.venue,
        candles: live.candles,
        snapshot: computeTechnicalSnapshot(live.candles),
        errors: live.errors,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (db) {
    const cached = await db
      .select()
      .from(candlesCache)
      .where(and(eq(candlesCache.symbol, symbol), eq(candlesCache.timeframe, timeframe)))
      .orderBy(asc(candlesCache.timestamp))
      .limit(limit);
    if (cached.length >= 10) {
      const bars: OhlcvBar[] = cached.map((c) => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
      return Response.json(
        {
          mode: 'CACHED' as const,
          symbol,
          timeframe,
          venue: cached[cached.length - 1]?.source ?? 'cache',
          candles: bars,
          snapshot: computeTechnicalSnapshot(bars),
          errors: live.errors,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  if (allowBenchmark) {
    const basePrice = symbol.includes('BTC') ? 68400 : symbol.includes('ETH') ? 3450 : symbol.includes('SOL') ? 168 : 1.085;
    const bars = generateDeterministicBenchmarkSeries({ bars: limit, startPrice: basePrice });
    return Response.json(
      {
        mode: 'BENCHMARK' as const,
        symbol,
        timeframe,
        venue: 'deterministic-math-vector',
        candles: bars,
        snapshot: computeTechnicalSnapshot(bars),
        errors: live.errors,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return Response.json({ mode: 'OFFLINE', symbol, timeframe, candles: [], snapshot: null, errors: live.errors });
}

const importSchema = z.object({
  symbol: z.string().min(2).max(24),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).default('1h'),
  payload: z.string().min(10),
});

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const body = importSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'Provide symbol, timeframe, and CSV/JSON payload.' }, { status: 400 });

  const parsed = parseOhlcvPayload(body.data.payload);
  if (parsed.error || parsed.candles.length < 2) {
    return Response.json({ error: parsed.error ?? 'Could not parse OHLCV bars.' }, { status: 400 });
  }

  const symbol = body.data.symbol.trim().toUpperCase();
  await cacheBars(db, symbol, body.data.timeframe, parsed.candles, 'operator-csv-upload');
  return Response.json({
    imported: parsed.candles.length,
    symbol,
    timeframe: body.data.timeframe,
    snapshot: computeTechnicalSnapshot(parsed.candles),
    candles: parsed.candles,
  });
}
