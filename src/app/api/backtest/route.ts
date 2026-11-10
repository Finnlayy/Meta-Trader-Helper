// route.ts — strategy backtest runner, presets, and historical result persistence. Dependencies: backtest, screener, schema, http.
import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { runBacktest, STRATEGY_PRESETS, type BacktestConfig } from '../../../lib/backtest';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { parseOhlcvPayload } from '../../../lib/market';
import { strategyBacktests } from '../../../lib/schema';
import { loadSymbolBars } from '../../../lib/screener';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const history = await db.select().from(strategyBacktests).orderBy(desc(strategyBacktests.createdAt)).limit(30);
  return Response.json(
    {
      presets: Object.entries(STRATEGY_PRESETS).map(([id, cfg]) => ({ id, ...cfg })),
      history,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const runSchema = z.object({
  presetId: z.string().optional(),
  name: z.string().min(1).max(100).optional(),
  symbol: z.string().min(2).max(24).default('BTC/USDT'),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).default('1h'),
  initialCapital: z.number().min(100).max(10_000_000).optional(),
  positionSizePct: z.number().min(1).max(100).optional(),
  stopLossPct: z.number().min(0).max(90).optional(),
  takeProfitPct: z.number().min(0).max(500).optional(),
  trailingStopPct: z.number().min(0).max(90).optional(),
  entryLogic: z.enum(['AND', 'OR']).optional(),
  exitLogic: z.enum(['AND', 'OR']).optional(),
  entryConditions: z.array(z.record(z.string(), z.unknown())).optional(),
  exitConditions: z.array(z.record(z.string(), z.unknown())).optional(),
  csvPayload: z.string().optional(),
  save: z.boolean().default(true),
});

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = runSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid backtest request.' }, { status: 400 });

  const d = parsed.data;
  const preset = d.presetId ? STRATEGY_PRESETS[d.presetId] : undefined;

  let barsMode: 'LIVE' | 'CACHED' | 'BENCHMARK' | 'UPLOADED_CSV' = 'BENCHMARK';
  let bars;
  if (d.csvPayload && d.csvPayload.trim().length > 0) {
    const csvRes = parseOhlcvPayload(d.csvPayload);
    if (csvRes.error || csvRes.candles.length < 60) {
      return Response.json({ error: csvRes.error ?? 'Uploaded CSV needs at least 60 OHLCV bars for warmup.' }, { status: 400 });
    }
    bars = csvRes.candles;
    barsMode = 'UPLOADED_CSV';
  } else {
    const loaded = await loadSymbolBars(db, d.symbol, d.timeframe, 300, true);
    bars = loaded.bars;
    barsMode = loaded.mode;
  }

  const config: BacktestConfig = {
    name: d.name ?? preset?.name ?? 'Custom Strategy',
    symbol: d.symbol.trim().toUpperCase(),
    timeframe: d.timeframe,
    initialCapital: d.initialCapital ?? preset?.initialCapital ?? 10000,
    positionSizePct: d.positionSizePct ?? preset?.positionSizePct ?? 95,
    stopLossPct: d.stopLossPct ?? preset?.stopLossPct ?? 3,
    takeProfitPct: d.takeProfitPct ?? preset?.takeProfitPct ?? 7,
    trailingStopPct: d.trailingStopPct ?? preset?.trailingStopPct ?? 0,
    entryLogic: d.entryLogic ?? preset?.entryLogic ?? 'AND',
    exitLogic: d.exitLogic ?? preset?.exitLogic ?? 'OR',
    entryConditions: (d.entryConditions as BacktestConfig['entryConditions']) ?? preset?.entryConditions ?? STRATEGY_PRESETS.rsi_reversion.entryConditions,
    exitConditions: (d.exitConditions as BacktestConfig['exitConditions']) ?? preset?.exitConditions ?? STRATEGY_PRESETS.rsi_reversion.exitConditions,
  };

  const result = runBacktest(bars, config);

  let savedId: string | null = null;
  if (d.save && result.success) {
    savedId = `bt-${randomUUID().slice(0, 10)}`;
    await db.insert(strategyBacktests).values({
      id: savedId,
      name: config.name ?? 'Custom Strategy',
      symbol: config.symbol ?? 'BTC/USDT',
      timeframe: config.timeframe ?? '1h',
      initialCapital: config.initialCapital ?? 10000,
      positionSizePct: config.positionSizePct ?? 95,
      stopLossPct: config.stopLossPct ?? 0,
      takeProfitPct: config.takeProfitPct ?? 0,
      trailingStopPct: config.trailingStopPct ?? 0,
      entryLogic: config.entryLogic ?? 'AND',
      exitLogic: config.exitLogic ?? 'OR',
      entryConditions: config.entryConditions as unknown as Record<string, unknown>[],
      exitConditions: config.exitConditions as unknown as Record<string, unknown>[],
      totalTrades: result.totalTrades,
      winRate: result.winRate,
      totalReturn: result.totalReturn,
      maxDrawdown: result.maxDrawdown,
      sharpe: result.sharpeRatio,
      sortino: result.sortino,
      calmar: result.calmar,
      profitFactor: result.profitFactor,
      resultJson: {
        barsMode,
        finalValue: result.finalValue,
        benchmarkReturn: result.benchmarkReturn,
        equityCurve: result.equityCurve,
        benchmarkCurve: result.benchmarkCurve,
        monthlyReturns: result.monthlyReturns,
        trades: result.trades.slice(-50),
      },
    });
  }

  return Response.json({ id: savedId, barsMode, config, result });
}
