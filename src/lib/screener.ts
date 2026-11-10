// screener.ts — multi-asset technical & condition-group screener engine. Dependencies: schema, market, indicators, conditions.
import { and, asc, eq } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { evaluateGroup, type ConditionGroupNode } from './conditions';
import { computeTechnicalSnapshot, type TechnicalSnapshot } from './indicators';
import { fetchOhlcv, generateDeterministicBenchmarkSeries, type OhlcvBar } from './market';
import { candlesCache, watchlistItems } from './schema';

export type ScreenerRow = {
  symbol: string;
  exchange: string;
  timeframe: string;
  sourceMode: 'LIVE' | 'CACHED' | 'BENCHMARK';
  close: number;
  changePct: number;
  rsi14: number | null;
  macdHist: number | null;
  adx14: number | null;
  atrPct: number | null;
  trendBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  matched: boolean;
  snapshot: TechnicalSnapshot;
};

export async function loadSymbolBars(
  db: AppDatabase,
  symbol: string,
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' = '1h',
  limit = 160,
  allowBenchmarkFallback = false,
): Promise<{ bars: OhlcvBar[]; mode: 'LIVE' | 'CACHED' | 'BENCHMARK' }> {
  const sym = symbol.trim().toUpperCase();
  const cached = await db
    .select()
    .from(candlesCache)
    .where(and(eq(candlesCache.symbol, sym), eq(candlesCache.timeframe, timeframe)))
    .orderBy(asc(candlesCache.timestamp))
    .limit(limit);

  if (cached.length >= 60) {
    const ordered = cached.map((c) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
    return { bars: ordered, mode: 'CACHED' };
  }

  try {
    const live = await fetchOhlcv(sym, timeframe, limit, db);
    if (live.status === 'LIVE' && live.candles.length >= 60) {
      return { bars: live.candles, mode: 'LIVE' };
    }
  } catch {
    // Live exchange unreachable
  }

  if (allowBenchmarkFallback) {
    let hash = 0;
    for (let i = 0; i < sym.length; i++) hash = (hash * 31 + sym.charCodeAt(i)) >>> 0;
    const basePrice = sym.includes('BTC') ? 68000 : sym.includes('ETH') ? 3400 : sym.includes('SOL') ? 165 : sym.includes('EUR') ? 1.08 : 180;
    return {
      bars: generateDeterministicBenchmarkSeries({ bars: limit, startPrice: basePrice, seed: 10000 + hash }),
      mode: 'BENCHMARK',
    };
  }

  return { bars: [], mode: 'CACHED' };
}

export async function runTechnicalScreener(
  db: AppDatabase,
  options?: {
    symbols?: string[];
    timeframe?: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
    filter?: ConditionGroupNode | null;
    allowBenchmarkFallback?: boolean;
  },
): Promise<ScreenerRow[]> {
  const timeframe = options?.timeframe ?? '1h';
  const allowBenchmarkFallback = options?.allowBenchmarkFallback ?? true;

  let targets: { symbol: string; exchange: string }[] = [];
  if (options?.symbols && options.symbols.length > 0) {
    targets = options.symbols.map((s) => ({
      symbol: s.trim().toUpperCase(),
      exchange: s.includes('/') ? 'CRYPTO' : 'FX',
    }));
  } else {
    const wl = await db.select().from(watchlistItems).orderBy(asc(watchlistItems.createdAt));
    targets = wl.map((w) => ({ symbol: w.symbol, exchange: w.exchange }));
  }

  const rows: ScreenerRow[] = [];

  for (const target of targets) {
    const { bars, mode } = await loadSymbolBars(db, target.symbol, timeframe, 180, allowBenchmarkFallback);
    if (bars.length < 30) continue;

    const snapshot = computeTechnicalSnapshot(bars);
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2] ?? last;
    const changePct = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0;

    let trendBias: ScreenerRow['trendBias'] = 'NEUTRAL';
    if (snapshot.ema20 !== null && snapshot.ema50 !== null) {
      if (snapshot.ema20 > snapshot.ema50 && last.close > snapshot.ema20) trendBias = 'BULLISH';
      else if (snapshot.ema20 < snapshot.ema50 && last.close < snapshot.ema20) trendBias = 'BEARISH';
    }

    let matched = true;
    if (options?.filter && options.filter.children.length > 0) {
      matched = evaluateGroup(options.filter.children, options.filter.logic ?? 'AND', bars).triggered;
    }

    rows.push({
      symbol: target.symbol,
      exchange: target.exchange,
      timeframe,
      sourceMode: mode,
      close: Number(last.close.toFixed(4)),
      changePct: Number(changePct.toFixed(2)),
      rsi14: snapshot.rsi14 !== null ? Number(snapshot.rsi14.toFixed(2)) : null,
      macdHist: snapshot.macd ? Number(snapshot.macd.histogram.toFixed(4)) : null,
      adx14: snapshot.adx14 !== null ? Number(snapshot.adx14.toFixed(2)) : null,
      atrPct: snapshot.atr14 !== null && last.close > 0 ? Number(((snapshot.atr14 / last.close) * 100).toFixed(2)) : null,
      trendBias,
      matched,
      snapshot,
    });
  }

  return rows;
}
