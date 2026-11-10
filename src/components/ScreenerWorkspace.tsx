// ScreenerWorkspace.tsx — F3 Multi-Asset Screener & Nested Condition Evaluator. Dependencies: React.
'use client';

import React, { useEffect, useState } from 'react';

type ScreenerRow = {
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
};

export function ScreenerWorkspace({
  onSelectSymbol,
}: {
  onSelectSymbol: (symbol: string) => void;
}) {
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [timeframe, setTimeframe] = useState('1h');
  const [customSymbols, setCustomSymbols] = useState('BTC/USDT, ETH/USDT, SOL/USDT, EUR/USD');
  const [indicator, setIndicator] = useState('RSI');
  const [operator, setOperator] = useState('<');
  const [threshold, setThreshold] = useState('55');
  const [loading, setLoading] = useState(false);

  async function runScan(useFilter = true) {
    setLoading(true);
    try {
      const symbols = customSymbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const filter = useFilter
        ? {
            type: 'group',
            logic: 'AND',
            children: [
              {
                indicator,
                params: indicator === 'RSI' || indicator === 'ADX' ? { period: 14 } : { period: 20 },
                field: 'value',
                operator,
                value: Number(threshold) || 0,
              },
            ],
          }
        : null;

      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: symbols.length ? symbols : undefined, timeframe, filter }),
      });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runScan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Fincept ConditionEvaluator Screener</div>
            <h2 className="panel-h2">Multi-Symbol Regime &amp; Signal Scanner</h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={loading} onClick={() => void runScan(false)}>Scan All</button>
            <button className="btn btn-primary" disabled={loading} onClick={() => void runScan(true)}>
              {loading ? 'Scanning...' : 'Apply Rule Filter'}
            </button>
          </div>
        </div>

        <div className="form-row">
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="scr-syms">Symbol Universe (comma-separated)</label>
            <input id="scr-syms" value={customSymbols} onChange={(e) => setCustomSymbols(e.target.value)} />
          </div>
          <div style={{ width: 100 }}>
            <label htmlFor="scr-tf">Timeframe</label>
            <select id="scr-tf" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
              {['15m', '1h', '4h', '1d'].map((tf) => <option key={tf} value={tf}>{tf}</option>)}
            </select>
          </div>
          <div style={{ width: 130 }}>
            <label htmlFor="scr-ind">Indicator</label>
            <select id="scr-ind" value={indicator} onChange={(e) => setIndicator(e.target.value)}>
              <option value="RSI">RSI(14)</option>
              <option value="ADX">ADX(14)</option>
              <option value="CCI">CCI(20)</option>
              <option value="MFI">MFI(14)</option>
            </select>
          </div>
          <div style={{ width: 110 }}>
            <label htmlFor="scr-op">Operator</label>
            <select id="scr-op" value={operator} onChange={(e) => setOperator(e.target.value)}>
              <option value="<">&lt;</option>
              <option value=">">&gt;</option>
              <option value="<=">&lt;=</option>
              <option value=">=">&gt;=</option>
            </select>
          </div>
          <div style={{ width: 100 }}>
            <label htmlFor="scr-val">Threshold</label>
            <input id="scr-val" type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Source</th>
                <th>Close</th>
                <th>Bar Δ%</th>
                <th>RSI(14)</th>
                <th>MACD Hist</th>
                <th>ADX(14)</th>
                <th>ATR%</th>
                <th>Bias</th>
                <th>Rule Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td>
                    <button
                      type="button"
                      style={{ background: 'none', border: 0, color: 'var(--green)', fontWeight: 700, padding: 0 }}
                      onClick={() => onSelectSymbol(r.symbol)}
                    >
                      {r.symbol}
                    </button>
                  </td>
                  <td><span className={`badge ${r.sourceMode === 'LIVE' ? 'live' : r.sourceMode === 'CACHED' ? 'cyan' : 'amber'}`}>{r.sourceMode}</span></td>
                  <td>{r.close}</td>
                  <td className={r.changePct >= 0 ? 'pos' : 'neg'}>{r.changePct >= 0 ? '+' : ''}{r.changePct}%</td>
                  <td>{r.rsi14 ?? 'n/a'}</td>
                  <td className={(r.macdHist ?? 0) >= 0 ? 'pos' : 'neg'}>{r.macdHist ?? 'n/a'}</td>
                  <td>{r.adx14 ?? 'n/a'}</td>
                  <td>{r.atrPct !== null ? `${r.atrPct}%` : 'n/a'}</td>
                  <td><span className={`badge ${r.trendBias === 'BULLISH' ? 'live' : r.trendBias === 'BEARISH' ? 'offline' : 'amber'}`}>{r.trendBias}</span></td>
                  <td><span className={`badge ${r.matched ? 'live' : 'amber'}`}>{r.matched ? 'MATCH' : 'SKIP'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
