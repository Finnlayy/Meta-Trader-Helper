// RiskWorkspace.tsx — F6 Pre-Trade Risk Core Policy Editor, Dry-Run Order Simulator, Emergency Kill Switch Console, and Safety Audits. Dependencies: React.
'use client';

import React, { useEffect, useState } from 'react';

type RiskPolicy = {
  maxOrderValue: number;
  maxOrderQuantity: number;
  dailyLossLimit: number;
  maxOpenPositions: number;
  maxLeverage: number;
  sanityChecks: boolean;
  killSwitchEnforced: boolean;
  oneClickEnabled: boolean;
  semiAutoMode: boolean;
  pendingTtlMinutes: number;
  blockedSymbols: string[];
};

export function RiskWorkspace({
  killed,
  onNotify,
  onStatusChanged,
}: {
  killed: boolean | null;
  onNotify: (msg: string, isError?: boolean) => void;
  onStatusChanged: () => Promise<void>;
}) {
  const [policy, setPolicy] = useState<RiskPolicy>({
    maxOrderValue: 5000,
    maxOrderQuantity: 100,
    dailyLossLimit: 500,
    maxOpenPositions: 10,
    maxLeverage: 5,
    sanityChecks: true,
    killSwitchEnforced: true,
    oneClickEnabled: false,
    semiAutoMode: true,
    pendingTtlMinutes: 5,
    blockedSymbols: [],
  });
  const [blockedText, setBlockedText] = useState('');
  const [drySym, setDrySym] = useState('BTC/USDT');
  const [drySide, setDrySide] = useState<'buy' | 'sell'>('buy');
  const [dryQty, setDryQty] = useState('2');
  const [dryPrice, setDryPrice] = useState('68000');
  const [dryResult, setDryResult] = useState<{ valid: boolean; errors: string[]; warnings: string[]; notional: number } | null>(null);

  const [killReason, setKillReason] = useState('Operator initiated risk lockdown');
  const [squareOff, setSquareOff] = useState(false);
  const [resumeReason, setResumeReason] = useState('Risk metrics verified; resuming paper operations');

  async function loadRisk() {
    const res = await fetch('/api/risk', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.policy) {
        setPolicy(data.policy);
        setBlockedText((data.policy.blockedSymbols ?? []).join(', '));
      }
    }
  }

  useEffect(() => {
    void loadRisk();
  }, []);

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    const blockedSymbols = blockedText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const res = await fetch('/api/risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updatePolicy', ...policy, blockedSymbols }),
    });
    if (res.ok) {
      const data = await res.json();
      setPolicy(data.policy);
      onNotify('Pre-Trade Risk Core policy saved & audited');
    } else {
      onNotify('Failed to update risk policy', true);
    }
  }

  async function handleDryRun() {
    const res = await fetch('/api/risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'dryRun',
        symbol: drySym,
        side: drySide,
        orderType: 'limit',
        quantity: Number(dryQty),
        price: Number(dryPrice),
      }),
    });
    const data = await res.json();
    if (res.ok) setDryResult(data.evaluation);
  }

  async function handleKillToggle(mode: 'kill' | 'resume') {
    const res = await fetch('/api/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        mode === 'kill'
          ? { action: 'kill', reason: killReason, squareOffPositions: squareOff }
          : { action: 'resume', reason: resumeReason },
      ),
    });
    const data = await res.json();
    if (res.ok) {
      onNotify(
        mode === 'kill'
          ? `Kill Switch ENGAGED: rejected ${data.queuedRejected} actions, cancelled ${data.ordersCancelled} resting orders, closed ${data.positionsClosed} positions`
          : 'Kill Switch cleared and trading resumed',
      );
      await onStatusChanged();
    } else {
      onNotify(data.error ?? 'Kill switch operation failed', true);
    }
  }

  return (
    <div className="grid-main-side">
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Fincept OrderValidator Pre-Trade Risk Core (Fail-Closed)</div>
            <h2 className="panel-h2">Account &amp; Strategy Risk Limits</h2>
          </div>
        </div>

        <form onSubmit={handleSavePolicy} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="rk-val">Max Order Value ($)</label>
              <input id="rk-val" type="number" value={policy.maxOrderValue} onChange={(e) => setPolicy({ ...policy, maxOrderValue: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="rk-qty">Max Order Quantity</label>
              <input id="rk-qty" type="number" value={policy.maxOrderQuantity} onChange={(e) => setPolicy({ ...policy, maxOrderQuantity: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="rk-dd">Daily Loss Limit ($)</label>
              <input id="rk-dd" type="number" value={policy.dailyLossLimit} onChange={(e) => setPolicy({ ...policy, dailyLossLimit: Number(e.target.value) })} />
            </div>
          </div>

          <div className="grid-3">
            <div className="field">
              <label htmlFor="rk-pos">Max Open Positions</label>
              <input id="rk-pos" type="number" value={policy.maxOpenPositions} onChange={(e) => setPolicy({ ...policy, maxOpenPositions: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="rk-lev">Max Leverage (x)</label>
              <input id="rk-lev" type="number" value={policy.maxLeverage} onChange={(e) => setPolicy({ ...policy, maxLeverage: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="rk-ttl">SemiAuto TTL (Minutes)</label>
              <input id="rk-ttl" type="number" min={1} max={240} value={policy.pendingTtlMinutes} onChange={(e) => setPolicy({ ...policy, pendingTtlMinutes: Number(e.target.value) })} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="rk-blk">Blocked Symbols (comma-separated, e.g. DOGE/USDT, XAUUSD)</label>
            <input id="rk-blk" value={blockedText} onChange={(e) => setBlockedText(e.target.value)} />
          </div>

          <div className="grid-2">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
              <input type="checkbox" checked={policy.semiAutoMode} onChange={(e) => setPolicy({ ...policy, semiAutoMode: e.target.checked })} />
              SemiAuto Mode (route entries to Action Center)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
              <input type="checkbox" checked={policy.sanityChecks} onChange={(e) => setPolicy({ ...policy, sanityChecks: e.target.checked })} />
              Sanity Checks (1M qty &amp; 20x buying-power cap)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
              <input type="checkbox" checked={policy.killSwitchEnforced} onChange={(e) => setPolicy({ ...policy, killSwitchEnforced: e.target.checked })} />
              Enforce Kill Switch (block non-reducing entries)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
              <input type="checkbox" checked={policy.oneClickEnabled} onChange={(e) => setPolicy({ ...policy, oneClickEnabled: e.target.checked })} />
              Allow One-Click Paper Orders
            </label>
          </div>

          <div>
            <button type="submit" className="btn btn-primary">Save Risk Policy</button>
          </div>
        </form>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Cascading Emergency Control</div>
              <h2 className="panel-h2">Kill Switch Console</h2>
            </div>
            <span className={`badge ${killed ? 'killed' : 'live'}`}>{killed ? 'ENGAGED' : 'ARMED'}</span>
          </div>

          {!killed ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label htmlFor="ks-reason">Kill Switch Reason</label>
                <input id="ks-reason" value={killReason} onChange={(e) => setKillReason(e.target.value)} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
                <input type="checkbox" checked={squareOff} onChange={(e) => setSquareOff(e.target.checked)} />
                Square-off all open paper positions on trigger
              </label>
              <button type="button" className="btn btn-danger" onClick={() => void handleKillToggle('kill')}>
                ENGAGE KILL SWITCH (Reject Queue + Cancel Resting Orders)
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field">
                <label htmlFor="ks-resume">Operator Resume Justification</label>
                <input id="ks-resume" value={resumeReason} onChange={(e) => setResumeReason(e.target.value)} />
              </div>
              <button type="button" className="btn btn-primary" onClick={() => void handleKillToggle('resume')}>
                Clear Kill Switch &amp; Resume
              </button>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Pre-Trade Dry-Run Simulator</div>
              <h2 className="panel-h2">Test Order Against Risk Core</h2>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => void handleDryRun()}>Validate Order</button>
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="dry-sym">Symbol</label>
              <input id="dry-sym" value={drySym} onChange={(e) => setDrySym(e.target.value.toUpperCase())} />
            </div>
            <div style={{ width: 90 }}>
              <label htmlFor="dry-side">Side</label>
              <select id="dry-side" value={drySide} onChange={(e) => setDrySide(e.target.value as 'buy' | 'sell')}>
                <option value="buy">BUY</option>
                <option value="sell">SELL</option>
              </select>
            </div>
            <div style={{ width: 90 }}>
              <label htmlFor="dry-qty">Qty</label>
              <input id="dry-qty" type="number" value={dryQty} onChange={(e) => setDryQty(e.target.value)} />
            </div>
            <div style={{ width: 110 }}>
              <label htmlFor="dry-px">Price ($)</label>
              <input id="dry-px" type="number" value={dryPrice} onChange={(e) => setDryPrice(e.target.value)} />
            </div>
          </div>

          {dryResult && (
            <div className="pre-box" style={{ marginTop: 10 }}>
              {JSON.stringify(dryResult, null, 2)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
