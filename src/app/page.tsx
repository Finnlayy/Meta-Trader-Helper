// page.tsx — Fable 5 Multi-Workspace Intelligence Terminal (F1-F8 tabs, Ctrl+K command palette, Shift+K cascading kill switch). Dependencies: React, Next.js.
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BacktestWorkspace, type EaBacktestHint } from '../components/BacktestWorkspace';
import { CommandPalette, type PaletteCommand } from '../components/CommandPalette';
import { IntelCopilotWorkspace } from '../components/IntelCopilotWorkspace';
import { MarketsWorkspace } from '../components/MarketsWorkspace';
import { Mt5McpNotesWorkspace } from '../components/Mt5McpNotesWorkspace';
import { OverviewWorkspace, type StatusSummary } from '../components/OverviewWorkspace';
import { PaperActionWorkspace } from '../components/PaperActionWorkspace';
import { RiskWorkspace } from '../components/RiskWorkspace';
import { ScreenerWorkspace } from '../components/ScreenerWorkspace';

type TabId = 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8';

const WORKSPACES: { id: TabId; fkey: string; label: string }[] = [
  { id: 'f1', fkey: 'F1', label: 'Overview & Sources' },
  { id: 'f2', fkey: 'F2', label: 'Markets & Indicators' },
  { id: 'f3', fkey: 'F3', label: 'Screener & Rules' },
  { id: 'f4', fkey: 'F4', label: 'Backtest Lab' },
  { id: 'f5', fkey: 'F5', label: 'Paper & Action Center' },
  { id: 'f6', fkey: 'F6', label: 'Risk Core & Safety' },
  { id: 'f7', fkey: 'F7', label: 'FinBERT & Copilot' },
  { id: 'f8', fkey: 'F8', label: 'MT5 / EA Audit / MCP' },
];

export default function TerminalPage() {
  const [activeTab, setActiveTab] = useState<TabId>('f1');
  const [focusSymbol, setFocusSymbol] = useState<string>('BTC/USDT');
  const [eaBacktestHint, setEaBacktestHint] = useState<EaBacktestHint | null>(null);
  const [status, setStatus] = useState<StatusSummary | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; isError: boolean } | null>(null);
  const [killing, setKilling] = useState(false);

  const notify = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // ignore transient network check
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const triggerKillSwitch = useCallback(async () => {
    setKilling(true);
    try {
      const res = await fetch('/api/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kill', reason: 'Operator Kill Switch hotkey / header bar', squareOffPositions: false }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(`KILL SWITCH ENGAGED: rejected ${data.queuedRejected} queued actions, cancelled ${data.ordersCancelled} resting orders`, true);
        await refreshStatus();
      } else {
        notify(data.error ?? 'Kill switch failed', true);
      }
    } finally {
      setKilling(false);
    }
  }, [notify, refreshStatus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (inField) return;

      if (e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        void triggerKillSwitch();
        return;
      }

      const fMap: Record<string, TabId> = {
        F1: 'f1',
        F2: 'f2',
        F3: 'f3',
        F4: 'f4',
        F5: 'f5',
        F6: 'f6',
        F7: 'f7',
        F8: 'f8',
      };
      if (fMap[e.key]) {
        e.preventDefault();
        setActiveTab(fMap[e.key]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [triggerKillSwitch]);

  const paletteCommands: PaletteCommand[] = [
    ...WORKSPACES.map((w) => ({
      id: `nav-${w.id}`,
      label: `Open Workspace: ${w.label}`,
      shortcut: w.fkey,
      run: () => setActiveTab(w.id),
    })),
    ...['BTC/USD', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'EUR/USD'].map((sym) => ({
      id: `sym-${sym}`,
      label: `Inspect Chart & Indicators: ${sym}`,
      shortcut: 'F2',
      run: () => {
        setFocusSymbol(sym);
        setActiveTab('f2');
      },
    })),
    {
      id: 'act-kill',
      label: 'ENGAGE KILL SWITCH (Stop Entries + Cancel Orders)',
      shortcut: 'Shift+K',
      run: () => void triggerKillSwitch(),
    },
  ];

  const activeWorkspaceMeta = WORKSPACES.find((w) => w.id === activeTab)!;

  return (
    <div className="terminal-shell">
      <header className="topbar">
        <div className="topbar-main">
          <div className="brand-row">
            <div className="mark">
              F<span>5</span>
            </div>
            <div>
              <div className="brand-title">FABLE 5 TERMINAL</div>
              <div className="brand-sub">
                QUANTITATIVE EXECUTION &amp; MQL5 AUDIT WORKBENCH • {activeWorkspaceMeta.fkey} {activeWorkspaceMeta.label.toUpperCase()}
              </div>
            </div>
          </div>

          <div className="session-strip">
            {(status?.marketSessions ?? []).slice(0, 4).map((s) => (
              <span key={s.exchange} className="session-pill" title={s.schedule}>
                <span className={`session-dot ${s.open ? 'open' : 'closed'}`} />
                {s.exchange} {s.localClock}
              </span>
            ))}
          </div>

          <div className="top-actions">
            <span className={`badge ${status?.database === 'LIVE' ? 'live' : status?.database === 'LOCAL' ? 'local' : 'offline'}`}>
              DB: {status?.database ?? 'CHECKING'}
            </span>
            {status && status.pendingActions > 0 && (
              <button className="badge amber" onClick={() => setActiveTab('f5')}>
                QUEUE: {status.pendingActions}
              </button>
            )}
            <button type="button" className="cmd-btn" onClick={() => setPaletteOpen(true)}>
              <span>Commands</span>
              <span className="muted">Ctrl+K</span>
            </button>
            <button
              type="button"
              className={`kill-btn ${status?.killed ? 'active' : ''}`}
              disabled={killing}
              onClick={() => void triggerKillSwitch()}
            >
              {status?.killed ? 'KILL ENGAGED' : 'KILL SWITCH'} [Shift+K]
            </button>
          </div>
        </div>

        <nav className="fkey-bar" aria-label="Terminal Workspaces">
          {WORKSPACES.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`fkey-tab ${activeTab === w.id ? 'active' : ''}`}
              onClick={() => setActiveTab(w.id)}
            >
              <span className="fkey-code">{w.fkey}</span>
              <span>{w.label}</span>
              {w.id === 'f5' && status && status.pendingActions > 0 && (
                <span className="badge amber" style={{ padding: '1px 5px', fontSize: 9 }}>
                  {status.pendingActions}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="workspace-body">
        {status?.killed && (
          <div className="banner-kill">
            <div>
              <strong>KILL SWITCH ENGAGED:</strong> {status.killReason ?? 'New exposure is blocked. Only position-reducing exits are allowed.'}
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => setActiveTab('f6')}>
              Manage / Resume in F6 Risk Core
            </button>
          </div>
        )}

        {status?.newsShockAlert && (
          <div className="banner-warn">
            <strong>FINBERT 3-SIGMA NEWS SHOCK DETECTED:</strong> Abnormal negative news sentiment spike recorded in F7. Review headlines before approving pending Action Center entries.
          </div>
        )}

        {activeTab === 'f1' && (
          <OverviewWorkspace
            status={status}
            onNavigate={(id) => setActiveTab(id as TabId)}
            onRefreshStatus={refreshStatus}
          />
        )}
        {activeTab === 'f2' && <MarketsWorkspace initialSymbol={focusSymbol} onNotify={notify} />}
        {activeTab === 'f3' && (
          <ScreenerWorkspace
            onSelectSymbol={(sym) => {
              setFocusSymbol(sym);
              setActiveTab('f2');
            }}
          />
        )}
        {activeTab === 'f4' && <BacktestWorkspace initialSymbol={focusSymbol} eaHint={eaBacktestHint} onNotify={notify} />}
        {activeTab === 'f5' && (
          <PaperActionWorkspace initialSymbol={focusSymbol} onNotify={notify} onStatusChanged={refreshStatus} />
        )}
        {activeTab === 'f6' && (
          <RiskWorkspace killed={status?.killed ?? false} onNotify={notify} onStatusChanged={refreshStatus} />
        )}
        {activeTab === 'f7' && (
          <IntelCopilotWorkspace initialSymbol={focusSymbol} onNotify={notify} onStatusChanged={refreshStatus} />
        )}
        {activeTab === 'f8' && (
          <Mt5McpNotesWorkspace
            onNotify={notify}
            onStatusChanged={refreshStatus}
            onSendToBacktest={(hint) => {
              setEaBacktestHint(hint);
              setActiveTab('f4');
              notify(`Loaded ${hint.eaName} strategy parameters into F4 Backtest Lab`);
            }}
          />
        )}
      </main>

      <CommandPalette open={paletteOpen} commands={paletteCommands} onClose={() => setPaletteOpen(false)} />

      {toast && (
        <div className={`toast ${toast.isError ? 'error' : ''}`} role="status">
          <span>{toast.msg}</span>
          <button type="button" style={{ background: 'none', border: 0, fontWeight: 700 }} onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
