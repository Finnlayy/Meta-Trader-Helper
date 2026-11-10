// IntelCopilotWorkspace.tsx — F7 FinBERT Sentiment & 3-Sigma Shock Monitor, RSS/Atom Feed Engine, and Fable 5 AI Quantitative Copilot. Dependencies: React.
'use client';

import React, { useEffect, useState } from 'react';

type NewsItem = {
  id: string;
  title: string;
  sourceName: string;
  score: number;
  label: string;
  zScore: number;
  shockTriggered: boolean;
  priority: string;
  threatCategory: string;
  sourceFlag: string;
  tickers: string[];
  createdAt: string;
};

type NewsSummary = {
  count: number;
  avgSentiment: number;
  shockCount: number;
  criticalCount: number;
  shockAlert: boolean;
};

type AgentResponse = {
  provider: string;
  reply: string;
  proposal: { symbol: string; side: string; orderType: string; quantity: number; price: number; rationale: string } | null;
  queuedPacket: { id: string } | null;
  queueError: string | null;
};

export function IntelCopilotWorkspace({
  initialSymbol,
  onNotify,
  onStatusChanged,
}: {
  initialSymbol: string;
  onNotify: (msg: string, isError?: boolean) => void;
  onStatusChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [summary, setSummary] = useState<NewsSummary | null>(null);
  const [headlineText, setHeadlineText] = useState('Federal Reserve signals dovish easing while Bitcoin ETF inflows surge to record high');
  const [headlineSource, setHeadlineSource] = useState('Reuters');
  const [lastScore, setLastScore] = useState<Record<string, unknown> | null>(null);
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);

  const [prompt, setPrompt] = useState('Assess BTC/USDT momentum, FinBERT news shock posture, and propose a risk-bounded entry.');
  const [agentSymbol, setAgentSymbol] = useState(initialSymbol || 'BTC/USDT');
  const [agentOutput, setAgentOutput] = useState<AgentResponse | null>(null);
  const [askingAgent, setAskingAgent] = useState(false);

  async function loadNews() {
    const res = await fetch('/api/news', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setSummary(data.summary ?? null);
    }
  }

  useEffect(() => {
    void loadNews();
  }, []);

  async function handleScoreText(save: boolean) {
    const res = await fetch('/api/news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'scoreText', text: headlineText, source: headlineSource, save }),
    });
    const data = await res.json();
    if (res.ok) {
      setLastScore(data.assessment ?? null);
      if (save) {
        setItems(data.items ?? []);
        setSummary(data.summary ?? null);
        await onStatusChanged();
        onNotify(`Scored & stored headline (${data.assessment?.label}, score ${data.assessment?.score})`);
      }
    }
  }

  async function handleRefreshFeeds() {
    setRefreshingFeeds(true);
    try {
      const res = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refreshFeeds' }),
      });
      const data = await res.json();
      if (res.ok) {
        setItems(data.items ?? []);
        setSummary(data.summary ?? null);
        await onStatusChanged();
        onNotify(`RSS refresh ${data.refresh?.status}: ${data.refresh?.ingested ?? 0} articles ingested`);
      }
    } finally {
      setRefreshingFeeds(false);
    }
  }

  async function handleRunAgent(queueProposal: boolean) {
    setAskingAgent(true);
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, symbol: agentSymbol, queueProposal }),
      });
      const data = await res.json();
      if (res.ok) {
        setAgentOutput(data);
        if (data.queuedPacket) {
          onNotify(`Copilot queued Action Packet ${data.queuedPacket.id}`);
          await onStatusChanged();
        } else if (data.queueError) {
          onNotify(data.queueError, true);
        }
      }
    } finally {
      setAskingAgent(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="grid-4">
        <div className="panel">
          <div className="panel-title">FinBERT Mean Sentiment</div>
          <div className={`stat-val ${(summary?.avgSentiment ?? 0) >= 0 ? 'pos' : 'neg'}`}>{summary?.avgSentiment ?? 0}</div>
          <div className="stat-sub">Scale: -1.0 (panic) to +1.0 (euphoria)</div>
        </div>
        <div className="panel">
          <div className="panel-title">3-Sigma Tail Shock State</div>
          <div className="stat-val" style={{ color: summary?.shockAlert ? 'var(--red)' : 'var(--green)' }}>
            {summary?.shockAlert ? 'SHOCK DETECTED' : 'NOMINAL'}
          </div>
          <div className="stat-sub">z &lt; -3.0 &amp; score &lt; -0.65 trigger</div>
        </div>
        <div className="panel">
          <div className="panel-title">Critical Events / Headlines</div>
          <div className="stat-val">{summary?.criticalCount ?? 0} / {summary?.count ?? 0}</div>
          <div className="stat-sub">Auto-classified Tier 1–3 sources</div>
        </div>
        <div className="panel">
          <div className="panel-title">RSS Feed Ingestion</div>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={refreshingFeeds} onClick={() => void handleRefreshFeeds()}>
              {refreshingFeeds ? 'Fetching RSS...' : 'Pull Live RSS Feeds'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">FinBERT Risk Scorer (Strategie-Runner tanh + 3σ)</div>
              <h2 className="panel-h2">Score &amp; Ingest Headline</h2>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field">
              <label htmlFor="fin-src">News Source (Tier-1/2/3 Auto-Classifier)</label>
              <input id="fin-src" value={headlineSource} onChange={(e) => setHeadlineSource(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="fin-txt">Headline / Wire Snippet</label>
              <textarea id="fin-txt" rows={3} value={headlineText} onChange={(e) => setHeadlineText(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => void handleScoreText(false)}>Analyze Only</button>
              <button className="btn btn-primary" onClick={() => void handleScoreText(true)}>Score &amp; Persist Event</button>
            </div>
            {lastScore && <div className="pre-box">{JSON.stringify(lastScore, null, 2)}</div>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">State-Grounded Quantitative Agent</div>
              <h2 className="panel-h2">Fable 5 AI Copilot</h2>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="ag-sym">Focus Symbol</label>
                <input id="ag-sym" value={agentSymbol} onChange={(e) => setAgentSymbol(e.target.value.toUpperCase())} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" disabled={askingAgent} onClick={() => void handleRunAgent(false)}>
                  {askingAgent ? 'Synthesizing...' : 'Run Quant Brief'}
                </button>
                <button className="btn btn-amber" disabled={askingAgent} onClick={() => void handleRunAgent(true)}>
                  Brief + Queue Action
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ag-prompt">Research / Execution Question</label>
              <textarea id="ag-prompt" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </div>
            {agentOutput && <div className="pre-box">{agentOutput.reply}</div>}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-h2">Persisted Sentiment &amp; Threat Feed ({items.length})</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>Source</th>
                <th>Headline</th>
                <th>Score</th>
                <th>Z-Score</th>
                <th>Tickers</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 25).map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className={`badge ${item.priority === 'CRITICAL' ? 'critical' : item.priority === 'HIGH' ? 'amber' : 'cyan'}`}>
                      {item.priority}
                    </span>
                  </td>
                  <td>
                    <div>{item.sourceName}</div>
                    <div className="muted" style={{ fontSize: 9 }}>{item.sourceFlag}</div>
                  </td>
                  <td>{item.title}</td>
                  <td className={item.score >= 0 ? 'pos' : 'neg'}>{item.score} ({item.label})</td>
                  <td className={item.shockTriggered ? 'neg' : ''}>{item.zScore}{item.shockTriggered ? ' SHOCK' : ''}</td>
                  <td>{item.tickers.join(', ') || '—'}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="muted">No sentiment events persisted yet. Score a headline or pull RSS feeds above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
