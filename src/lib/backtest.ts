// backtest.ts — strategy backtest engine ported from FinceptTerminal BacktestEngine.cpp. Dependencies: conditions, market.
import type { OhlcvBar } from './market';
import { type ConditionGroupNode, type ConditionNode, evaluateGroup } from './conditions';

export type BacktestConfig = {
  name?: string;
  symbol?: string;
  timeframe?: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
  initialCapital?: number;
  positionSizePct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  trailingStopPct?: number;
  entryLogic?: 'AND' | 'OR';
  exitLogic?: 'AND' | 'OR';
  entryConditions: (ConditionNode | ConditionGroupNode)[];
  exitConditions: (ConditionNode | ConditionGroupNode)[];
};

export type BacktestTrade = {
  entryBar: number;
  exitBar: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPct: number;
  reason: 'exit_signal' | 'stop_loss' | 'take_profit' | 'end_of_data';
  barsHeld: number;
};

export type BacktestResult = {
  success: boolean;
  error?: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturn: number;
  totalReturnAbs: number;
  finalValue: number;
  maxDrawdown: number;
  avgPnl: number;
  avgBarsHeld: number;
  profitFactor: number;
  sharpeRatio: number;
  sortino: number;
  calmar: number;
  expectancy: number;
  benchmarkReturn: number;
  equityCurve: number[];
  benchmarkCurve: number[];
  monthlyReturns: { month: string; returnPct: number }[];
  trades: BacktestTrade[];
};

const WARMUP_BARS = 50;
const EVAL_WINDOW = 500;

const roundTo = (v: number, d: number) => {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
};

function barsPerYear(tf: string): number {
  if (tf === '1m') return 252 * 390;
  if (tf === '5m') return 252 * 78;
  if (tf === '15m') return 252 * 26;
  if (tf === '30m') return 252 * 13;
  if (tf === '1h') return 252 * 6.5;
  if (tf === '4h') return 252 * 1.625;
  return 252;
}

export const STRATEGY_PRESETS: Record<string, Omit<BacktestConfig, 'symbol' | 'timeframe'>> = {
  rsi_reversion: {
    name: 'RSI Mean Reversion (30 / 68)',
    initialCapital: 10000,
    positionSizePct: 95,
    stopLossPct: 3.5,
    takeProfitPct: 7.0,
    trailingStopPct: 0,
    entryLogic: 'AND',
    exitLogic: 'OR',
    entryConditions: [
      { indicator: 'RSI', params: { period: 14 }, field: 'value', operator: '<', value: 35 },
    ],
    exitConditions: [
      { indicator: 'RSI', params: { period: 14 }, field: 'value', operator: '>', value: 65 },
    ],
  },
  ema_crossover: {
    name: 'EMA 12 / 26 Trend Crossover',
    initialCapital: 10000,
    positionSizePct: 95,
    stopLossPct: 4.0,
    takeProfitPct: 0,
    trailingStopPct: 3.0,
    entryLogic: 'AND',
    exitLogic: 'OR',
    entryConditions: [
      {
        indicator: 'EMA',
        params: { period: 12 },
        field: 'value',
        operator: 'crosses_above',
        compare_mode: 'indicator',
        compare_indicator: 'EMA',
        compare_params: { period: 26 },
        compare_field: 'value',
      },
    ],
    exitConditions: [
      {
        indicator: 'EMA',
        params: { period: 12 },
        field: 'value',
        operator: 'crosses_below',
        compare_mode: 'indicator',
        compare_indicator: 'EMA',
        compare_params: { period: 26 },
        compare_field: 'value',
      },
    ],
  },
  supertrend_momentum: {
    name: 'SuperTrend + ADX Filter',
    initialCapital: 10000,
    positionSizePct: 90,
    stopLossPct: 3.0,
    takeProfitPct: 8.0,
    trailingStopPct: 2.5,
    entryLogic: 'AND',
    exitLogic: 'OR',
    entryConditions: [
      { indicator: 'SUPERTREND', params: { period: 10, multiplier: 3 }, field: 'direction', operator: '>', value: 0 },
      { indicator: 'ADX', params: { period: 14 }, field: 'value', operator: '>', value: 18 },
    ],
    exitConditions: [
      { indicator: 'SUPERTREND', params: { period: 10, multiplier: 3 }, field: 'direction', operator: '<', value: 0 },
    ],
  },
  bollinger_breakout: {
    name: 'Bollinger Lower Band Rebound',
    initialCapital: 10000,
    positionSizePct: 95,
    stopLossPct: 2.5,
    takeProfitPct: 5.5,
    trailingStopPct: 0,
    entryLogic: 'AND',
    exitLogic: 'OR',
    entryConditions: [
      { indicator: 'BOLLINGER', params: { period: 20, std_dev: 2 }, field: 'pct_b', operator: '<', value: 0.1 },
    ],
    exitConditions: [
      { indicator: 'BOLLINGER', params: { period: 20, std_dev: 2 }, field: 'pct_b', operator: '>', value: 0.85 },
    ],
  },
};

export function runBacktest(candles: OhlcvBar[], config: BacktestConfig): BacktestResult {
  const n = candles.length;
  const initialCapital = Math.max(100, config.initialCapital ?? 10000);
  const sizeFrac = Math.min(100, Math.max(1, config.positionSizePct ?? 95)) / 100;
  const slPct = Math.max(0, config.stopLossPct ?? 0);
  const tpPct = Math.max(0, config.takeProfitPct ?? 0);
  const trailPct = Math.max(0, config.trailingStopPct ?? 0);
  const timeframe = config.timeframe ?? '1h';

  if (n < WARMUP_BARS + 10) {
    return {
      success: false,
      error: `Insufficient data: ${n} candles (need at least ${WARMUP_BARS + 10})`,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalReturn: 0,
      totalReturnAbs: 0,
      finalValue: initialCapital,
      maxDrawdown: 0,
      avgPnl: 0,
      avgBarsHeld: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      sortino: 0,
      calmar: 0,
      expectancy: 0,
      benchmarkReturn: 0,
      equityCurve: [],
      benchmarkCurve: [],
      monthlyReturns: [],
      trades: [],
    };
  }

  let cash = initialCapital;
  let inPos = false;
  let entryPrice = 0;
  let entryBar = 0;
  let shares = 0;
  let highest = 0;

  let entrySignal = false;
  let exitSignal = false;

  const trades: BacktestTrade[] = [];
  const equityCurve: number[] = [];
  const benchmarkCurve: number[] = [];
  const benchBase = candles[WARMUP_BARS].close;
  let peakEquity = initialCapital;
  let maxDd = 0;

  const closeTrade = (exitPrice: number, reason: BacktestTrade['reason'], exitBar: number) => {
    const pnl = (exitPrice - entryPrice) * shares;
    const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    cash += shares * exitPrice;
    trades.push({
      entryBar,
      exitBar,
      entryTime: candles[entryBar].timestamp,
      exitTime: candles[exitBar].timestamp,
      entryPrice: roundTo(entryPrice, 4),
      exitPrice: roundTo(exitPrice, 4),
      shares: roundTo(shares, 6),
      pnl: roundTo(pnl, 2),
      pnlPct: roundTo(pnlPct, 2),
      reason,
      barsHeld: exitBar - entryBar,
    });
    inPos = false;
    shares = 0;
  };

  for (let i = WARMUP_BARS; i < n; i++) {
    const bar = candles[i];

    // 1. Execute pending signal fills at THIS bar's open (eliminates look-ahead bias)
    if (!inPos && entrySignal) {
      const px = bar.open;
      const qty = px > 0 ? (cash * sizeFrac) / px : 0;
      if (qty > 0) {
        inPos = true;
        entryPrice = px;
        entryBar = i;
        shares = qty;
        cash -= shares * px;
        highest = px;
      }
      entrySignal = false;
    } else if (inPos && exitSignal) {
      closeTrade(bar.open, 'exit_signal', i);
      exitSignal = false;
    }

    // 2. Intrabar stop-loss / trailing-stop / take-profit (conservative stop-first check)
    if (inPos) {
      highest = Math.max(highest, bar.high);
      let haveStop = false;
      let stopPrice = 0;
      if (slPct > 0) {
        stopPrice = entryPrice * (1 - slPct / 100);
        haveStop = true;
      }
      if (trailPct > 0) {
        const trail = highest * (1 - trailPct / 100);
        stopPrice = haveStop ? Math.max(stopPrice, trail) : trail;
        haveStop = true;
      }
      const tpPrice = tpPct > 0 ? entryPrice * (1 + tpPct / 100) : 0;

      if (haveStop && bar.low <= stopPrice) {
        closeTrade(Math.min(stopPrice, bar.open), 'stop_loss', i);
      } else if (tpPct > 0 && bar.high >= tpPrice) {
        closeTrade(Math.max(tpPrice, bar.open), 'take_profit', i);
      }
    }

    // 3. Evaluate conditions on close of bar i -> latch for next bar
    const start = Math.max(0, i - EVAL_WINDOW + 1);
    const window = candles.slice(start, i + 1);
    if (!inPos && !entrySignal && config.entryConditions.length > 0) {
      if (evaluateGroup(config.entryConditions, config.entryLogic ?? 'AND', window).triggered) {
        entrySignal = true;
      }
    } else if (inPos && !exitSignal && config.exitConditions.length > 0) {
      if (evaluateGroup(config.exitConditions, config.exitLogic ?? 'OR', window).triggered) {
        exitSignal = true;
      }
    }

    // 4. Mark-to-market equity
    const equity = cash + (inPos ? shares * bar.close : 0);
    equityCurve.push(roundTo(equity, 2));
    benchmarkCurve.push(roundTo(benchBase > 0 ? (initialCapital * bar.close) / benchBase : initialCapital, 2));
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  if (inPos) closeTrade(candles[n - 1].close, 'end_of_data', n - 1);

  const totalTrades = trades.length;
  const finalValue = cash;
  const totalReturnAbs = finalValue - initialCapital;
  const totalReturn = initialCapital > 0 ? (totalReturnAbs / initialCapital) * 100 : 0;

  if (totalTrades === 0) {
    const benchFinal = benchmarkCurve.length > 0 ? benchmarkCurve[benchmarkCurve.length - 1] : initialCapital;
    return {
      success: true,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalReturn: roundTo(totalReturn, 2),
      totalReturnAbs: roundTo(totalReturnAbs, 2),
      finalValue: roundTo(finalValue, 2),
      maxDrawdown: roundTo(maxDd, 2),
      avgPnl: 0,
      avgBarsHeld: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      sortino: 0,
      calmar: 0,
      expectancy: 0,
      benchmarkReturn: roundTo(initialCapital > 0 ? ((benchFinal - initialCapital) / initialCapital) * 100 : 0, 2),
      equityCurve,
      benchmarkCurve,
      monthlyReturns: [],
      trades: [],
    };
  }

  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let sumPnl = 0;
  let sumBars = 0;
  for (const t of trades) {
    sumPnl += t.pnl;
    sumBars += t.barsHeld;
    if (t.pnl > 0) {
      wins++;
      grossProfit += t.pnl;
    } else {
      grossLoss += Math.abs(t.pnl);
    }
  }
  const losses = totalTrades - wins;
  const winRate = (wins / totalTrades) * 100;
  const avgPnl = sumPnl / totalTrades;
  const avgBarsHeld = sumBars / totalTrades;
  const profitFactor = Math.min(999.99, grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999.99 : 0);

  let sharpe = 0;
  let sortino = 0;
  if (equityCurve.length > 1) {
    const rets: number[] = [];
    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i - 1] !== 0) rets.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
    if (rets.length > 0) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      let v = 0;
      let dv = 0;
      for (const r of rets) {
        v += (r - mean) * (r - mean);
        if (r < 0) dv += r * r;
      }
      const sd = Math.sqrt(v / rets.length);
      const dsd = Math.sqrt(dv / rets.length);
      const ann = Math.sqrt(barsPerYear(timeframe));
      if (sd > 0) sharpe = (mean / sd) * ann;
      if (dsd > 0) sortino = (mean / dsd) * ann;
    }
  }
  const calmar = maxDd > 0 ? totalReturn / maxDd : 0;

  const monthlyReturns: { month: string; returnPct: number }[] = [];
  let curMonth = '';
  let monthEnd = initialCapital;
  let prevMonthEnd = initialCapital;
  for (let j = 0; j < equityCurve.length; j++) {
    const dt = new Date(candles[WARMUP_BARS + j].timestamp);
    const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (curMonth && ym !== curMonth) {
      monthlyReturns.push({
        month: curMonth,
        returnPct: roundTo(prevMonthEnd > 0 ? ((monthEnd - prevMonthEnd) / prevMonthEnd) * 100 : 0, 2),
      });
      prevMonthEnd = monthEnd;
    }
    curMonth = ym;
    monthEnd = equityCurve[j];
  }
  if (curMonth) {
    monthlyReturns.push({
      month: curMonth,
      returnPct: roundTo(prevMonthEnd > 0 ? ((monthEnd - prevMonthEnd) / prevMonthEnd) * 100 : 0, 2),
    });
  }

  const benchFinal = benchmarkCurve.length > 0 ? benchmarkCurve[benchmarkCurve.length - 1] : initialCapital;
  const benchmarkReturn = initialCapital > 0 ? ((benchFinal - initialCapital) / initialCapital) * 100 : 0;

  return {
    success: true,
    totalTrades,
    winningTrades: wins,
    losingTrades: losses,
    winRate: roundTo(winRate, 1),
    totalReturn: roundTo(totalReturn, 2),
    totalReturnAbs: roundTo(totalReturnAbs, 2),
    finalValue: roundTo(finalValue, 2),
    maxDrawdown: roundTo(maxDd, 2),
    avgPnl: roundTo(avgPnl, 2),
    avgBarsHeld: roundTo(avgBarsHeld, 1),
    profitFactor: roundTo(profitFactor, 2),
    sharpeRatio: roundTo(sharpe, 3),
    sortino: roundTo(sortino, 3),
    calmar: roundTo(calmar, 2),
    expectancy: roundTo(avgPnl, 2),
    benchmarkReturn: roundTo(benchmarkReturn, 2),
    equityCurve,
    benchmarkCurve,
    monthlyReturns,
    trades,
  };
}
