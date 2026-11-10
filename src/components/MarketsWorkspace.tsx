// MarketsWorkspace.tsx — F2 Markets, Watchlist CRUD, Candlestick SVG Chart, 29-Indicator Inspector, and CSV/MT5 OHLCV importer. Dependencies: React, Charts.
'use client';

import React, { useEffect, useState } from 'react';
import { CandlestickSvgChart, type ChartBar } from './Charts';

type WatchlistRow = {
  id: string;
  symbol: string;
  exchange: string;
  assetClass: string;
  displayName: string;
  lastPrice: number | null;
  changePct: number | null;
  venue: string | null;
};

type Snapshot = {
  bars: number;
  lastClose: number;
  changePct: number;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  ema20: number | null;
  ema50: number | null;
  bollingerPctB: number | null;
  supertrendDirection: number | null;
  adx14: number | null;
  atr14: number | null;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  signals: string[];
};

type IndicatorMeta = { name: string; category: string; fields: string[]; defaultParams: Record<string, number> };

export function MarketsWorkspace({
  initialSymbol,
  onNotify,
}: {
  initialSymbol: string;
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [watchlist, setWatchlist] = useState<WatchlistRow[]>([]);
  const [symbol, setSymbol] = useState(initialSymbol || 'BTC/USD');
  const [timeframe, setTimeframe] = useState('1h');
  const [bars, setBars] = useState<ChartBar[]>([]);
  const [mode, setMode] = useState<string>('LOADING');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [catalog, setCatalog] = useState<IndicatorMeta[]>([]);
  const [selectedInd, setSelectedInd] = useState('RSI');
  const [indOutput, setIndOutput] = useState<Record<string, unknown> | null>(null);

  const [newSym, setNewSym] = useState('');
  const [newExch, setNewExch] = useState('CRYPTO');
  const [csvText, setCsvText] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadWatchlist(refreshQuotes = false) {
    const res = await fetch(`/api/watchlist${refreshQuotes ? '?refresh=true' : ''}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setWatchlist(data.items ?? []);
    }
  }

  async function loadCandles(sym = symbol, tf = timeframe) {
    setLoading(true);
    try {
      const res = await fetch(`/api/candles?symbol=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(tf)}&limit=160`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setBars(data.candles ?? []);
        setMode(data.mode ?? 'OFFLINE');
        setSnapshot(data.snapshot ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadIndicatorDetail(ind = selectedInd, sym = symbol, tf = timeframe) {
    const res = await fetch(`/api/indicators?symbol=${encodeURIComponent(sym)}&timeframe=${encodeURIComponent(tf)}&indicator=${encodeURIComponent(ind)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.catalog) setCatalog(data.catalog);
      setIndOutput(data.result ?? null);
    }
  }

  useEffect(() => {
    void loadWatchlist(false);
    void loadCandles(symbol, timeframe);
    void loadIndicatorDetail(selectedInd, symbol, timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddWatchlist(e: React.FormEvent) {
    e.preventDefault();
    if (!newSym.trim()) return;
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: newSym.trim().toUpperCase(), exchange: newExch, assetClass: newExch }),
    });
    if (res.ok) {
      setNewSym('');
      await loadWatchlist(false);
      onNotify(`Added ${newSym.trim().toUpperCase()} to watchlist`);
    } else {
      onNotify('Failed to add symbol', true);
    }
  }

  async function handleDeleteWatchlist(id: string) {
    await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadWatchlist(false);
  }

  async function handleUploadCsv() {
    if (!csvText.trim()) return;
    const res = await fetch('/api/candles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, timeframe, payload: csvText }),
    });
    const data = await res.json();
    if (res.ok) {
      setBars(data.candles ?? []);
      setSnapshot(data.snapshot ?? null);
      setMode('CACHED');
      setCsvText('');
      onNotify(`Imported ${data.imported} OHLCV bars for ${symbol} (${timeframe})`);
    } else {
      onNotify(data.error ?? 'CSV import failed', true);
    }
  }

  return (
    <div className="grid-side-main">
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title">Durable Watchlist</div>
            <h2 className="panel-h2">Symbols ({watchlist.length})</h2>
          </div>
          <button className="btn btn-sm" onClick={() => void loadWatchlist(true)}>Refresh Quotes</button>
        </div>

        <form onSubmit={handleAddWatchlist} className="form-row">
          <div className="field">
            <label htmlFor="wl-symbol">New Symbol</label>
            <input id="wl-symbol" value={newSym} onChange={(e) => setNewSym(e.target.value)} aria-label="New symbol" />
          </div>
          <div style={{ width: 95 }}>
            <label htmlFor="wl-exch">Market</label>
            <select id="wl-exch" value={newExch} onChange={(e) => setNewExch(e.target.value)}>
              <option value="CRYPTO">CRYPTO</option>
              <option value="FX">FX / MT5</option>
              <option value="NYSE">NYSE</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary btn-sm">Add</button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Last</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map((w) => (
                <tr key={w.id} style={{ background: w.symbol === symbol ? 'rgba(187,249,104,0.08)' : undefined }}>
                  <td>
                    <button
                      type="button"
                      style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: w.symbol === symbol ? 'var(--green)' : 'var(--text)', fontWeight: 700 }}
                      onClick={() => {
                        setSymbol(w.symbol);
                        void loadCandles(w.symbol, timeframe);
                        void loadIndicatorDetail(selectedInd, w.symbol, timeframe);
                      }}
                    >
                      {w.symbol}
                    </button>
                    <div className="muted" style={{ fontSize: 9 }}>{w.exchange}</div>
                  </td>
                  <td>{w.lastPrice !== null ? w.lastPrice.toLocaleString() : 'cached'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleDeleteWatchlist(w.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Candlestick &amp; Technical Matrix</div>
              <h2 className="panel-h2">
                {symbol} • <span className={`badge ${mode === 'LIVE' ? 'live' : mode === 'CACHED' ? 'cyan' : 'amber'}`}>{mode}</span>
              </h2>
            </div>
            <div className="form-row">
              <select
                value={timeframe}
                onChange={(e) => {
                  const tf = e.target.value;
                  setTimeframe(tf);
                  void loadCandles(symbol, tf);
                  void loadIndicatorDetail(selectedInd, symbol, tf);
                }}
              >
                {['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
              <button className="btn btn-primary" disabled={loading} onClick={() => void loadCandles(symbol, timeframe)}>
                {loading ? 'Loading...' : 'Reload Bars'}
              </button>
            </div>
          </div>

          <CandlestickSvgChart bars={bars} symbol={symbol} timeframe={timeframe} />

          {snapshot && (
            <div className="grid-4" style={{ marginTop: 14 }}>
              <div>
                <label>Composite Bias</label>
                <span className={`badge ${snapshot.bias === 'BULLISH' ? 'live' : snapshot.bias === 'BEARISH' ? 'offline' : 'amber'}`}>
                  {snapshot.bias}
                </span>
              </div>
              <div>
                <label>RSI(14) / ADX(14)</label>
                <div className="mono">{snapshot.rsi14?.toFixed(2) ?? 'n/a'} / {snapshot.adx14?.toFixed(2) ?? 'n/a'}</div>
              </div>
              <div>
                <label>MACD (Line / Hist)</label>
                <div className="mono">{snapshot.macd ? `${snapshot.macd.line.toFixed(2)} / ${snapshot.macd.histogram.toFixed(2)}` : 'n/a'}</div>
              </div>
              <div>
                <label>ATR(14) / BB %B</label>
                <div className="mono">{snapshot.atr14?.toFixed(3) ?? 'n/a'} / {snapshot.bollingerPctB?.toFixed(2) ?? 'n/a'}</div>
              </div>
            </div>
          )}
        </div>

        <div className="grid-2">
          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">Fincept 29-Indicator Engine</div>
                <h2 className="panel-h2">Indicator Inspector</h2>
              </div>
              <select
                value={selectedInd}
                onChange={(e) => {
                  setSelectedInd(e.target.value);
                  void loadIndicatorDetail(e.target.value, symbol, timeframe);
                }}
              >
                {catalog.map((c) => (
                  <option key={c.name} value={c.name}>{c.name} ({c.category})</option>
                ))}
              </select>
            </div>
            <div className="pre-box">
              {indOutput ? JSON.stringify({ indicator: selectedInd, current: indOutput.current, previous: indOutput.previous, valid: indOutput.valid }, null, 2) : 'Select an indicator.'}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">Offline &amp; MT5 Data Ingestion</div>
                <h2 className="panel-h2">Import OHLCV CSV / JSON</h2>
              </div>
            </div>
            <label htmlFor="csv-import">Paste CSV (timestamp/date,open,high,low,close,volume or MT5 tab export) or JSON array</label>
            <textarea
              id="csv-import"
              rows={5}
              style={{ width: '100%' }}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted mono" style={{ fontSize: 10 }}>Persists to candles_cache for {symbol}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleUploadCsv()}>
                Parse &amp; Persist Candles
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
