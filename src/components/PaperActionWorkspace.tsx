// PaperActionWorkspace.tsx — F5 Paper Trading Engine, Portfolio Risk Analytics, Touch OrderMatcher, and Semi-Auto Action Center Queue. Dependencies: React.
'use client';

import React, { useEffect, useState } from 'react';

type Portfolio = {
  id: string;
  name: string;
  currency: string;
  initialBalance: number;
  balance: number;
  leverage: number;
  feeRate: number;
};

type Analytics = {
  equity: number;
  cashBalance: number;
  heldMargin: number;
  unrealizedPnl: number;
  realizedPnl: number;
  todayPnl: number;
  totalReturnPct: number;
  winRatePct: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  var95Pct: number;
  cvar95Pct: number;
  top3ConcentrationPct: number;
  hhiConcentration: number;
  compositeRiskScore: number;
};

type Position = {
  id: string;
  symbol: string;
  side: string;
  product: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  heldMargin: number;
};

type Order = {
  id: string;
  symbol: string;
  side: string;
  orderType: string;
  product: string;
  quantity: number;
  price: number | null;
  stopPrice: number | null;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
};

type ActionPacket = {
  id: string;
  symbol: string;
  exchange: string;
  side: string;
  quantity: number;
  priceType: string;
  price: number | null;
  strategy: string;
  rationale: string;
  status: string;
  rejectionReason: string | null;
  expiresAt: string;
};

export function PaperActionWorkspace({
  initialSymbol,
  onNotify,
  onStatusChanged,
}: {
  initialSymbol: string;
  onNotify: (msg: string, isError?: boolean) => void;
  onStatusChanged: () => Promise<void>;
}) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [active, setActive] = useState<Portfolio | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [actions, setActions] = useState<ActionPacket[]>([]);
  const [actionStats, setActionStats] = useState<{ totalPending: number; totalApproved: number; totalRejected: number }>({
    totalPending: 0,
    totalApproved: 0,
    totalRejected: 0,
  });

  // Order ticket state
  const [symbol, setSymbol] = useState(initialSymbol || 'BTC/USDT');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop' | 'stop_limit'>('market');
  const [product, setProduct] = useState<'CNC' | 'MIS' | 'NRML'>('CNC');
  const [qty, setQty] = useState('0.05');
  const [price, setPrice] = useState('68000');
  const [stopPrice, setStopPrice] = useState('67500');
  const [bypassSemiAuto, setBypassSemiAuto] = useState(false);

  // Tick matcher price tester
  const [tickSymbol, setTickSymbol] = useState(initialSymbol || 'BTC/USDT');
  const [tickPrice, setTickPrice] = useState('68500');

  async function refreshAll(pid = active?.id ?? 'paper-default') {
    const [pRes, aRes] = await Promise.all([
      fetch(`/api/paper?portfolioId=${encodeURIComponent(pid)}`, { cache: 'no-store' }),
      fetch('/api/actions', { cache: 'no-store' }),
    ]);
    if (pRes.ok) {
      const pj = await pRes.json();
      setPortfolios(pj.portfolios ?? []);
      setActive(pj.active ?? null);
      setAnalytics(pj.analytics ?? null);
      setPositions(pj.positions ?? []);
      setOrders(pj.orders ?? []);
    }
    if (aRes.ok) {
      const aj = await aRes.json();
      setActions(aj.actions ?? []);
      if (aj.stats) setActionStats(aj.stats);
    }
    await onStatusChanged();
  }

  useEffect(() => {
    void refreshAll('paper-default');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'placeOrder',
        portfolioId: active?.id ?? 'paper-default',
        symbol,
        side,
        orderType,
        product,
        quantity: Number(qty),
        price: orderType === 'limit' || orderType === 'stop_limit' ? Number(price) : undefined,
        stopPrice: orderType === 'stop' || orderType === 'stop_limit' ? Number(stopPrice) : undefined,
        refPrice: Number(price) || undefined,
        bypassSemiAuto,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      onNotify(
        data.routedToActionCenter
          ? `Queued in Action Center (${data.packet?.id}) for SemiAuto sign-off`
          : `Order ${data.orderRes?.status}: ${data.orderRes?.orderId}`,
      );
      await refreshAll(active?.id ?? 'paper-default');
    } else {
      onNotify(data.error ?? 'Order rejected by Risk Core', true);
    }
  }

  async function handleActionCenter(action: 'approve' | 'reject' | 'approveAll' | 'rejectAll', id?: string) {
    const res = await fetch('/api/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    const data = await res.json();
    if (res.ok) {
      onNotify(`Action Center: ${action} completed`);
    } else {
      onNotify(data.error ?? 'Action Center error', true);
    }
    await refreshAll(active?.id ?? 'paper-default');
  }

  async function handleClosePosition(positionId: string) {
    const res = await fetch('/api/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'closePosition', positionId }),
    });
    const data = await res.json();
    if (res.ok) onNotify('Position closed (reduce-only)');
    else onNotify(data.error ?? 'Close failed', true);
    await refreshAll(active?.id ?? 'paper-default');
  }

  async function handleCancelOrder(orderId: string) {
    await fetch('/api/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancelOrder', orderId }),
    });
    onNotify(`Cancelled order ${orderId}`);
    await refreshAll(active?.id ?? 'paper-default');
  }

  async function handleMatchTicks() {
    const res = await fetch('/api/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'matchTicks',
        portfolioId: active?.id ?? 'paper-default',
        ticks: [{ symbol: tickSymbol.trim().toUpperCase(), last: Number(tickPrice) }],
      }),
    });
    const data = await res.json();
    if (res.ok) {
      onNotify(`Matched ${data.matched?.matchedOrders?.length ?? 0} resting orders, updated ${data.matched?.updatedPositions ?? 0} positions`);
      await refreshAll(active?.id ?? 'paper-default');
    } else {
      onNotify(data.error ?? 'Tick matcher error', true);
    }
  }

  async function handleReset() {
    if (!active) return;
    await fetch('/api/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resetPortfolio', portfolioId: active.id }),
    });
    onNotify(`Reset portfolio ${active.name} to initial balance`);
    await refreshAll(active.id);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="grid-4">
        <div className="panel">
          <div className="panel-title">Paper Portfolio Equity</div>
          <div className="stat-val">${analytics?.equity.toLocaleString() ?? '0'}</div>
          <div className="stat-sub">
            Cash: ${analytics?.cashBalance.toLocaleString() ?? '0'} | Margin: ${analytics?.heldMargin.toLocaleString() ?? '0'}
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">Unrealized / Realized PnL</div>
          <div className={`stat-val ${(analytics?.unrealizedPnl ?? 0) + (analytics?.realizedPnl ?? 0) >= 0 ? 'pos' : 'neg'}`}>
            ${((analytics?.unrealizedPnl ?? 0) + (analytics?.realizedPnl ?? 0)).toFixed(2)}
          </div>
          <div className="stat-sub">
            Return: {analytics?.totalReturnPct ?? 0}% | Win Rate: {analytics?.winRatePct ?? 0}%
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">95% Historical VaR / Sharpe</div>
          <div className="stat-val">{analytics?.var95Pct ?? 0}% / {analytics?.sharpeRatio ?? 0}</div>
          <div className="stat-sub">CVaR95: {analytics?.cvar95Pct ?? 0}% | MaxDD: -{analytics?.maxDrawdownPct ?? 0}%</div>
        </div>
        <div className="panel">
          <div className="panel-title">Composite Risk &amp; Action Queue</div>
          <div className="stat-val" style={{ color: (analytics?.compositeRiskScore ?? 0) > 65 ? 'var(--red)' : 'var(--green)' }}>
            {analytics?.compositeRiskScore ?? 0}/100
          </div>
          <div className="stat-sub">Action Center Pending: {actionStats.totalPending}</div>
        </div>
      </div>

      <div className="grid-main-side">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Risk-Gated Execution Ticket</div>
              <h2 className="panel-h2">Paper Order Entry ({active?.name ?? 'Default'})</h2>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={active?.id ?? 'paper-default'} onChange={(e) => void refreshAll(e.target.value)}>
                {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name} (${p.balance.toFixed(0)})</option>)}
              </select>
              <button className="btn btn-sm btn-danger" onClick={() => void handleReset()}>Reset Account</button>
            </div>
          </div>

          <form onSubmit={submitOrder} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="ord-sym">Symbol</label>
                <input id="ord-sym" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
              <div style={{ width: 100 }}>
                <label htmlFor="ord-side">Side</label>
                <select id="ord-side" value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}>
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>
              </div>
              <div style={{ width: 120 }}>
                <label htmlFor="ord-type">Order Type</label>
                <select id="ord-type" value={orderType} onChange={(e) => setOrderType(e.target.value as 'market' | 'limit' | 'stop' | 'stop_limit')}>
                  <option value="market">MARKET</option>
                  <option value="limit">LIMIT</option>
                  <option value="stop">STOP</option>
                  <option value="stop_limit">STOP_LIMIT</option>
                </select>
              </div>
              <div style={{ width: 95 }}>
                <label htmlFor="ord-prod">Product</label>
                <select id="ord-prod" value={product} onChange={(e) => setProduct(e.target.value as 'CNC' | 'MIS' | 'NRML')}>
                  <option value="CNC">CNC (1x)</option>
                  <option value="MIS">MIS (5x)</option>
                  <option value="NRML">NRML</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label htmlFor="ord-qty">Quantity</label>
                <input id="ord-qty" type="number" step="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ord-price">Ref / Limit Price</label>
                <input id="ord-price" type="number" step="0.0001" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              {(orderType === 'stop' || orderType === 'stop_limit') && (
                <div className="field">
                  <label htmlFor="ord-stop">Stop Trigger</label>
                  <input id="ord-stop" type="number" step="0.0001" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: 0, textTransform: 'none' }}>
                <input type="checkbox" checked={bypassSemiAuto} onChange={(e) => setBypassSemiAuto(e.target.checked)} />
                Execute directly on Paper Engine (skip SemiAuto queue; Risk Core still enforced)
              </label>
              <button type="submit" className={`btn ${side === 'buy' ? 'btn-primary' : 'btn-danger'}`}>
                Submit {side.toUpperCase()} {orderType.toUpperCase()}
              </button>
            </div>
          </form>

          <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
            <div className="panel-title" style={{ marginBottom: 6 }}>Touch-Based OrderMatcher (Mark &amp; Fill Resting Orders)</div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="tick-sym">Tick Symbol</label>
                <input id="tick-sym" value={tickSymbol} onChange={(e) => setTickSymbol(e.target.value.toUpperCase())} />
              </div>
              <div className="field">
                <label htmlFor="tick-px">Incoming Last Price</label>
                <input id="tick-px" type="number" step="0.0001" value={tickPrice} onChange={(e) => setTickPrice(e.target.value)} />
              </div>
              <button type="button" className="btn btn-amber" onClick={() => void handleMatchTicks()}>
                Run Touch Matcher
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Fincept Semi-Auto Action Center</div>
              <h2 className="panel-h2">Approval Queue ({actionStats.totalPending} Pending)</h2>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm btn-primary" onClick={() => void handleActionCenter('approveAll')}>Approve All</button>
              <button className="btn btn-sm btn-danger" onClick={() => void handleActionCenter('rejectAll')}>Reject All</button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order Packet</th>
                  <th>Strategy</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {actions.length === 0 ? (
                  <tr><td colSpan={4} className="muted">No action packets queued yet.</td></tr>
                ) : (
                  actions.slice(0, 15).map((a) => (
                    <tr key={a.id}>
                      <td>
                        <div><strong>{a.side.toUpperCase()} {a.quantity} {a.symbol}</strong> ({a.priceType})</div>
                        <div className="muted" style={{ fontSize: 10 }}>
                          {a.price ? `@ ${a.price}` : 'market'} • Expires {new Date(a.expiresAt).toLocaleTimeString()}
                        </div>
                        {a.rejectionReason && <div className="neg" style={{ fontSize: 10 }}>{a.rejectionReason}</div>}
                      </td>
                      <td>{a.strategy}</td>
                      <td>
                        <span className={`badge ${a.status === 'approved' ? 'live' : a.status === 'pending' ? 'amber' : 'offline'}`}>
                          {a.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        {a.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-primary" onClick={() => void handleActionCenter('approve', a.id)}>Approve</button>
                            <button className="btn btn-sm btn-danger" onClick={() => void handleActionCenter('reject', a.id)}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-h2">Open Paper Positions ({positions.length})</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Qty</th>
                  <th>Entry / Mark</th>
                  <th>uPnL</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr><td colSpan={6} className="muted">No open positions.</td></tr>
                ) : (
                  positions.map((pos) => {
                    const uPnl = pos.side === 'long' ? (pos.currentPrice - pos.entryPrice) * pos.quantity : (pos.entryPrice - pos.currentPrice) * pos.quantity;
                    return (
                      <tr key={pos.id}>
                        <td><strong>{pos.symbol}</strong></td>
                        <td><span className={`badge ${pos.side === 'long' ? 'live' : 'offline'}`}>{pos.side.toUpperCase()}</span></td>
                        <td>{pos.quantity}</td>
                        <td>{pos.entryPrice} / {pos.currentPrice}</td>
                        <td className={uPnl >= 0 ? 'pos' : 'neg'}>{uPnl >= 0 ? '+' : ''}${uPnl.toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-sm btn-danger" onClick={() => void handleClosePosition(pos.id)}>Close</button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-h2">Order Book ({orders.length})</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 12).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.side.toUpperCase()} {o.quantity} {o.symbol}</strong>
                      {o.rejectionReason && <div className="neg" style={{ fontSize: 10 }}>{o.rejectionReason}</div>}
                    </td>
                    <td>{o.orderType} {o.price ? `@ ${o.price}` : ''} {o.stopPrice ? `(stop ${o.stopPrice})` : ''}</td>
                    <td><span className={`badge ${o.status === 'filled' ? 'live' : o.status === 'pending' ? 'amber' : 'offline'}`}>{o.status.toUpperCase()}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {o.status === 'pending' && (
                        <button className="btn btn-sm btn-danger" onClick={() => void handleCancelOrder(o.id)}>Cancel</button>
                      )}
                    </td>
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
