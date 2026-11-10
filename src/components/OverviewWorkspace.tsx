// OverviewWorkspace.tsx — F1 Executive Overview: system status, market ticker, source registry, market hours, and audit log. Dependencies: React.
'use client';

import React, { useEffect, useState } from 'react';

export type StatusSummary = {
  database: 'LIVE' | 'LOCAL' | 'OFFLINE';
  storageEngine: string;
  reason: string | null;
  killed: boolean | null;
  killReason: string | null;
  pendingActions: number;
  sources: { id: string; name: string; category: string; status: string; lastSuccess: string | null; lastError: string | null; latencyMs: number | null }[];
  marketSessions: { exchange: string; label: string; open: boolean; schedule: string; localClock: string }[];
  metaapiStatus: string;
  newsShockAlert: boolean;
};

type MarketData = {
  status: 'LIVE' | 'OFFLINE';
  symbol: string;
  venue?: string;
  last?: number;
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
  changePct?: number | null;
  lastSuccess: string | null;
  latencyMs?: number;
  errors: string[];
};

type AuditEntry = {
  id: number;
  actor: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
};

export function OverviewWorkspace({
  status,
  onNavigate,
  onRefreshStatus,
}: {
  status: StatusSummary | null;
  onNavigate: (tabId: string) => void;
  onRefreshStatus: () => Promise<void>;
}) {
  const [market, setMarket] = useState<MarketData | null>(null);
  const [symbol, setSymbol] = useState('BTC/USD');
  const [loading, setLoading] = useState(false);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [paperEq, setPaperEq] = useState<{ equity: number; currency: string; riskScore: number } | null>(null);

  async function refreshMarket(sym = symbol) {
    setLoading(true);
    try {
      const [mRes, aRes, pRes] = await Promise.all([
        fetch(`/api/market?symbol=${encodeURIComponent(sym)}`, { cache: 'no-store' }),
        fetch('/api/audit', { cache: 'no-store' }),
        fetch('/api/paper', { cache: 'no-store' }),
      ]);
      if (mRes.ok) setMarket(await mRes.json());
      if (aRes.ok) {
        const aj = await aRes.json();
        setAudits((aj.logs ?? []).slice(0, 12));
      }
      if (pRes.ok) {
        const pj = await pRes.json();
        if (pj.analytics && pj.active) {
          setPaperEq({
            equity: pj.analytics.equity,
            currency: pj.active.currency,
            riskScore: pj.analytics.compositeRiskScore,
          });
        }
      }
      await onRefreshStatus();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshMarket('BTC/USD');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="grid-4">
        <div className="panel">
          <div className="panel-title">Persistence Engine</div>
          <div className="stat-val" style={{ color: status?.database === 'LIVE' ? 'var(--green)' : status?.database === 'LOCAL' ? 'var(--amber)' : 'var(--red)' }}>
            {status?.database ?? 'CHECKING'}
          </div>
          <div className="stat-sub">Engine: {status?.storageEngine ?? 'detecting'}</div>
        </div>

        <div className="panel">
          <div className="panel-title">Safety &amp; Kill Switch</div>
          <div className="stat-val" style={{ color: status?.killed ? 'var(--red)' : 'var(--green)' }}>
            {status?.killed ? 'ENGAGED' : 'ARMED'}
          </div>
          <div className="stat-sub">Pending Approvals: {status?.pendingActions ?? 0}</div>
        </div>

        <div className="panel">
          <div className="panel-title">Paper Equity &amp; Risk</div>
          <div className="stat-val">{paperEq ? `$${paperEq.equity.toLocaleString()}` : 'n/a'}</div>
          <div className="stat-sub">
            Composite Risk: {paperEq ? `${paperEq.riskScore}/100` : 'n/a'}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">FinBERT Shock / MetaAPI</div>
          <div className="stat-val" style={{ color: status?.newsShockAlert ? 'var(--red)' : 'var(--green)' }}>
            {status?.newsShockAlert ? 'SHOCK ALERT' : 'NOMINAL'}
          </div>
          <div className="stat-sub">MetaAPI Bridge: {status?.metaapiStatus ?? 'NOT_CONFIGURED'}</div>
        </div>
      </div>

      <div className="grid-main-side">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Multi-Venue CCXT Market Snapshot</div>
              <h2 className="panel-h2">{market?.symbol ?? symbol} Spot Feed</h2>
            </div>
            <div className="form-row">
              <select value={symbol} onChange={(e) => { setSymbol(e.target.value); void refreshMarket(e.target.value); }}>
                <option value="BTC/USD">BTC/USD</option>
                <option value="ETH/USD">ETH/USD</option>
                <option value="SOL/USD">SOL/USD</option>
                <option value="BTC/USDT">BTC/USDT</option>
              </select>
              <button className="btn btn-primary" disabled={loading} onClick={() => void refreshMarket(symbol)}>
                {loading ? 'Refreshing...' : 'Refresh Ticker'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, margin: '12px 0 18px' }}>
            <span className="mono" style={{ fontSize: 34, fontWeight: 700 }}>
              {market?.status === 'LIVE' && market.last !== undefined ? `$${market.last.toLocaleString()}` : 'OFFLINE'}
            </span>
            <span className={`badge ${market?.status === 'LIVE' ? 'live' : 'offline'}`}>
              {market?.status ?? 'LOADING'} {market?.venue ? `• ${market.venue.toUpperCase()}` : ''}
            </span>
          </div>

          <div className="grid-3">
            <div>
              <label>Best Bid</label>
              <div className="mono" style={{ fontWeight: 700 }}>{market?.bid ?? 'n/a'}</div>
            </div>
            <div>
              <label>Best Ask</label>
              <div className="mono" style={{ fontWeight: 700 }}>{market?.ask ?? 'n/a'}</div>
            </div>
            <div>
              <label>Latency / 24h Vol</label>
              <div className="mono" style={{ fontWeight: 700 }}>
                {market?.latencyMs ? `${market.latencyMs}ms` : 'n/a'} / {market?.volume ? Number(market.volume).toFixed(0) : 'n/a'}
              </div>
            </div>
          </div>

          {market?.errors && market.errors.length > 0 && (
            <div className="banner-warn" style={{ marginTop: 14, marginBottom: 0 }}>
              <strong>Venue Failover Diagnostics:</strong> {market.errors.join(' | ')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <button className="btn" onClick={() => onNavigate('f2')}>Open Candlestick &amp; CSV Lab (F2)</button>
            <button className="btn" onClick={() => onNavigate('f4')}>Backtest Lab (F4)</button>
            <button className="btn" onClick={() => onNavigate('f5')}>Paper &amp; Action Center (F5)</button>
            <button className="btn btn-primary" onClick={() => onNavigate('f8')}>MT5 EA Library &amp; Upload (F8)</button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Durable Source Registry</div>
              <h2 className="panel-h2">Data &amp; Broker Connectivity</h2>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>Last Success</th>
                </tr>
              </thead>
              <tbody>
                {(status?.sources ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div>{s.name}</div>
                      {s.lastError && <div className="muted" style={{ fontSize: 10 }}>{s.lastError.slice(0, 64)}</div>}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          s.status === 'LIVE' || s.status === 'READY' || s.status === 'CONNECTED'
                            ? 'live'
                            : s.status === 'NOT CONFIGURED' || s.status === 'PENDING'
                              ? 'amber'
                              : s.status === 'AUTH_ERROR'
                                ? 'critical'
                                : 'offline'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td>{s.latencyMs !== null ? `${s.latencyMs}ms` : 'n/a'}</td>
                    <td className="muted">{s.lastSuccess ? new Date(s.lastSuccess).toLocaleTimeString() : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-h2">Global Exchange Market Hours</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Exchange</th>
                  <th>Status</th>
                  <th>Local Clock</th>
                  <th>Schedule</th>
                </tr>
              </thead>
              <tbody>
                {(status?.marketSessions ?? []).map((sess) => (
                  <tr key={sess.exchange}>
                    <td><strong>{sess.label}</strong></td>
                    <td>
                      <span className={`badge ${sess.open ? 'live' : 'amber'}`}>{sess.open ? 'OPEN' : 'CLOSED'}</span>
                    </td>
                    <td>{sess.localClock}</td>
                    <td className="muted">{sess.schedule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-h2">Immutable Safety &amp; Execution Audit Trail</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {audits.length === 0 ? (
                  <tr><td colSpan={4} className="muted">No audit events recorded yet.</td></tr>
                ) : (
                  audits.map((a) => (
                    <tr key={a.id}>
                      <td className="muted">{new Date(a.createdAt).toLocaleTimeString()}</td>
                      <td>{a.actor}</td>
                      <td><span className="badge cyan">{a.action}</span></td>
                      <td className="muted">{a.details ? JSON.stringify(a.details).slice(0, 75) : ''}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
