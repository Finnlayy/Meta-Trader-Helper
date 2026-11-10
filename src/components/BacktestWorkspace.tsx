// BacktestWorkspace.tsx — F4 Strategy Backtest Lab (50-bar warmup, next-bar-open fills, SL/TP/Trailing, Sharpe/Sortino/Calmar, equity SVG). Dependencies: React, Charts.
'use client';

import React, { useEffect, useState } from 'react';
import { EquityCurveSvgChart } from './Charts';

type Preset = {
  id: string;
  name: string;
  initialCapital: number;
  positionSizePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number;
};

type BacktestResult = {
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
  profitFactor: number;
  sharpeRatio: number;
  sortino: number;
  calmar: number;
  expectancy: number;
  benchmarkReturn: number;
  equityCurve: number[];
  benchmarkCurve: number[];
  monthlyReturns: { month: string; returnPct: number }[];
  trades: {
    entryBar: number;
    exitBar: number;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPct: number;
    reason: string;
    barsHeld: number;
  }[];
};

type HistoryRow = {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  totalTrades: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpe: number;
  createdAt: string;
};

export type EaBacktestHint = {
  eaName: string;
  presetId: 'ema_crossover' | 'rsi_reversion' | 'supertrend_momentum' | 'bollinger_breakout';
  slPct: number;
  tpPct: number;
};

export function BacktestWorkspace({
  initialSymbol,
  eaHint,
  onNotify,
}: {
  initialSymbol: string;
  eaHint?: EaBacktestHint | null;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [presetId, setPresetId] = useState<string>(eaHint?.presetId ?? 'ema_crossover');
  const [symbol, setSymbol] = useState(initialSymbol || 'BTC/USDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [capital, setCapital] = useState('10000');
  const [slPct, setSlPct] = useState(String(eaHint?.slPct ?? 4));
  const [tpPct, setTpPct] = useState(String(eaHint?.tpPct ?? 8));
  const [trailPct, setTrailPct] = useState('3');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [barsMode, setBarsMode] = useState<string>('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (eaHint) {
      setPresetId(eaHint.presetId);
      setSlPct(String(eaHint.slPct));
      setTpPct(String(eaHint.tpPct));
    }
  }, [eaHint]);

  async function loadMeta() {
    const res = await fetch('/api/backtest', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setPresets(data.presets ?? []);
      setHistory(data.history ?? []);
    }
  }

  useEffect(() => {
    void loadMeta();
  }, []);

  async function handleRun() {
    setRunning(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId,
          symbol,
          timeframe,
          initialCapital: Number(capital) || 10000,
          stopLossPct: Number(slPct) || 0,
          takeProfitPct: Number(tpPct) || 0,
          trailingStopPct: Number(trailPct) || 0,
          save: true,
        }),
      });
      const data = await res.json();
      if (res.ok && data.result) {
        setResult(data.result);
        setBarsMode(data.barsMode ?? '');
        await loadMeta();
        onNotify(`Backtest complete (${data.result.totalTrades} trades, Return ${data.result.totalReturn}%)`);
      } else {
        onNotify(data.error ?? 'Backtest failed', true);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {eaHint && (
        <div className="banner-warn" style={{ marginBottom: 0 }}>
          <strong>Seeded from MT5 EA:</strong> {eaHint.eaName} mapped to <code>{eaHint.presetId}</code> (SL {eaHint.slPct}%, TP {eaHint.tpPct}%).
        </div>
      )}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Fincept BacktestEngine (Next-Bar Open, 50-Bar Warmup, Intrabar SL/TP)</div>
            <h2 className="panel-h2">Quantitative Strategy Backtest Lab</h2>
          </div>
          <button className="btn btn-primary" disabled={running} onClick={() => void handleRun()}>
            {running ? 'Running Backtest...' : 'Execute & Persist Backtest'}
          </button>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="bt-preset">Strategy Preset</label>
            <select
              id="bt-preset"
              value={presetId}
              onChange={(e) => {
                const pid = e.target.value;
                setPresetId(pid);
                const found = presets.find((p) => p.id === pid);
                if (found) {
                  setSlPct(String(found.stopLossPct));
                  setTpPct(String(found.takeProfitPct));
                  setTrailPct(String(found.trailingStopPct));
                }
              }}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bt-sym">Symbol</label>
            <input id="bt-sym" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div style={{ width: 95 }}>
            <label htmlFor="bt-tf">TF</label>
            <select id="bt-tf" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              {['15m', '1h', '4h', '1d'].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </div>
          <div style={{ width: 110 }}>
            <label htmlFor="bt-cap">Capital ($)</label>
            <input id="bt-cap" type="number" value={capital} onChange={(e) => setCapital(e.target.value)} />
          </div>
          <div style={{ width: 90 }}>
            <label htmlFor="bt-sl">SL %</label>
            <input id="bt-sl" type="number" step="0.5" value={slPct} onChange={(e) => setSlPct(e.target.value)} />
          </div>
          <div style={{ width: 90 }}>
            <label htmlFor="bt-tp">TP %</label>
            <input id="bt-tp" type="number" step="0.5" value={tpPct} onChange={(e) => setTpPct(e.target.value)} />
          </div>
          <div style={{ width: 90 }}>
            <label htmlFor="bt-tr">Trail %</label>
            <input id="bt-tr" type="number" step="0.5" value={trailPct} onChange={(e) => setTrailPct(e.target.value)} />
          </div>
        </div>
      </div>

      {result && (
        <>
          <div className="grid-4">
            <div className="panel">
              <div className="panel-title">Total Return ({barsMode})</div>
              <div className={`stat-val ${result.totalReturn >= 0 ? 'pos' : 'neg'}`}>
                {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn}%
              </div>
              <div className="stat-sub">Final: ${result.finalValue.toLocaleString()} | B&amp;H: {result.benchmarkReturn}%</div>
            </div>
            <div className="panel">
              <div className="panel-title">Sharpe / Sortino / Calmar</div>
              <div className="stat-val">{result.sharpeRatio} / {result.sortino}</div>
              <div className="stat-sub">Calmar: {result.calmar} | Profit Factor: {result.profitFactor}</div>
            </div>
            <div className="panel">
              <div className="panel-title">Max Drawdown</div>
              <div className="stat-val neg">-{result.maxDrawdown}%</div>
              <div className="stat-sub">Expectancy: ${result.expectancy} / trade</div>
            </div>
            <div className="panel">
              <div className="panel-title">Trades &amp; Win Rate</div>
              <div className="stat-val">{result.winRate}%</div>
              <div className="stat-sub">{result.winningTrades}W / {result.losingTrades}L ({result.totalTrades} total)</div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-h2">Strategy Equity Curve vs Buy &amp; Hold</h2>
            </div>
            <EquityCurveSvgChart
              equityCurve={result.equityCurve}
              benchmarkCurve={result.benchmarkCurve}
              initialCapital={Number(capital) || 10000}
            />
          </div>
        </>
      )}

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-h2">Executed Backtest Trades</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Bars</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>PnL</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(result?.trades ?? []).slice(-12).reverse().map((t, idx) => (
                  <tr key={idx}>
                    <td>{t.entryBar} → {t.exitBar} ({t.barsHeld}b)</td>
                    <td>{t.entryPrice}</td>
                    <td>{t.exitPrice}</td>
                    <td className={t.pnl >= 0 ? 'pos' : 'neg'}>{t.pnl >= 0 ? '+' : ''}{t.pnl} ({t.pnlPct}%)</td>
                    <td><span className="badge cyan">{t.reason}</span></td>
                  </tr>
                ))}
                {(!result || result.trades.length === 0) && (
                  <tr><td colSpan={5} className="muted">Execute a backtest to inspect trade fills.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-h2">Persisted Backtest Archive ({history.length})</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Symbol</th>
                  <th>Return</th>
                  <th>MaxDD</th>
                  <th>Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.name}</td>
                    <td>{h.symbol} ({h.timeframe})</td>
                    <td className={h.totalReturn >= 0 ? 'pos' : 'neg'}>{h.totalReturn}%</td>
                    <td className="neg">-{h.maxDrawdown}%</td>
                    <td>{h.sharpe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
