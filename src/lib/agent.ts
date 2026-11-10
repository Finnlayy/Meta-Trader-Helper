// agent.ts — Fable 5 AI Copilot & Quantitative Research Synthesizer (inspects live DB state, FinBERT news risk, and optionally queries configured LLM API). Dependencies: schema, market, indicators, sentiment, paper, risk, screener.
import { desc, eq } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { getPaperWorkspace } from './paper';
import { isKillSwitchActive, loadRiskPolicy } from './risk';
import { auditLog, journalNotes, pendingActions } from './schema';
import { loadSymbolBars } from './screener';
import { computeTechnicalSnapshot } from './indicators';
import { listNewsIntelligence } from './sentiment';

export type AgentProposal = {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  quantity: number;
  price: number;
  rationale: string;
};

export type AgentResponse = {
  provider: 'local-quant' | 'openai';
  reply: string;
  contextSummary: {
    symbol: string;
    sourceMode: 'LIVE' | 'CACHED' | 'BENCHMARK';
    lastClose: number | null;
    rsi14: number | null;
    trend: string;
    newsSentimentAvg: number;
    shockAlert: boolean;
    killSwitchActive: boolean;
    paperEquity: number | null;
    pendingActionCount: number;
  };
  proposal: AgentProposal | null;
  timestamp: string;
};

export async function runTerminalAgent(
  db: AppDatabase,
  input: { prompt: string; symbol?: string; allowBenchmarkFallback?: boolean },
): Promise<AgentResponse> {
  const symbol = (input.symbol ?? 'BTC/USDT').trim().toUpperCase();
  const [{ bars, mode }, newsIntel, paperWs, policy, killed, pendingRows, recentNotes] = await Promise.all([
    loadSymbolBars(db, symbol, '1h', 160, input.allowBenchmarkFallback ?? true),
    listNewsIntelligence(db, 20),
    getPaperWorkspace(db, 'paper-default'),
    loadRiskPolicy(db),
    isKillSwitchActive(db),
    db.select().from(pendingActions).where(eq(pendingActions.status, 'pending')),
    db.select().from(journalNotes).orderBy(desc(journalNotes.updatedAt)).limit(5),
  ]);

  const snapshot = bars.length >= 20 ? computeTechnicalSnapshot(bars) : null;
  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : null;

  let trend = 'NEUTRAL';
  if (snapshot?.ema20 && snapshot?.ema50 && lastClose) {
    if (lastClose > snapshot.ema20 && snapshot.ema20 > snapshot.ema50) trend = 'BULLISH';
    else if (lastClose < snapshot.ema20 && snapshot.ema20 < snapshot.ema50) trend = 'BEARISH';
  }

  const contextSummary = {
    symbol,
    sourceMode: mode,
    lastClose: lastClose !== null ? Number(lastClose.toFixed(4)) : null,
    rsi14: snapshot?.rsi14 !== null && snapshot?.rsi14 !== undefined ? Number(snapshot.rsi14.toFixed(2)) : null,
    trend,
    newsSentimentAvg: newsIntel.summary.avgSentiment,
    shockAlert: newsIntel.summary.shockAlert,
    killSwitchActive: killed,
    paperEquity: paperWs.analytics?.equity ?? null,
    pendingActionCount: pendingRows.length,
  };

  let proposal: AgentProposal | null = null;
  if (!killed && !newsIntel.summary.shockAlert && lastClose && lastClose > 0 && snapshot?.rsi14 !== null && snapshot?.rsi14 !== undefined) {
    const qty = Number(Math.min(policy.maxOrderQuantity || 1, Math.max(0.01, (policy.maxOrderValue * 0.25) / lastClose)).toFixed(4));
    if (trend === 'BULLISH' && snapshot.rsi14 < 68) {
      proposal = {
        symbol,
        side: 'buy',
        orderType: 'limit',
        quantity: qty,
        price: Number((lastClose * 0.997).toFixed(4)),
        rationale: `${symbol} ${trend} structure (EMA20 > EMA50), RSI14=${snapshot.rsi14.toFixed(1)}, FinBERT avg=${newsIntel.summary.avgSentiment.toFixed(2)}`,
      };
    } else if (trend === 'BEARISH' && snapshot.rsi14 > 32) {
      proposal = {
        symbol,
        side: 'sell',
        orderType: 'limit',
        quantity: qty,
        price: Number((lastClose * 1.003).toFixed(4)),
        rationale: `${symbol} ${trend} structure (EMA20 < EMA50), RSI14=${snapshot.rsi14.toFixed(1)}, FinBERT avg=${newsIntel.summary.avgSentiment.toFixed(2)}`,
      };
    }
  }

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const sysPrompt = [
        'You are the Fable 5 Quantitative Terminal Copilot.',
        'Ground every claim ONLY in the live terminal snapshot JSON provided below. Never invent prices.',
        'If the kill switch is active or a FinBERT news shock is active, prioritize risk reduction and refuse new entries.',
        `Context JSON: ${JSON.stringify({ contextSummary, snapshot, policy, recentNotes: recentNotes.map((n) => n.title) })}`,
      ].join('\n');

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: input.prompt },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const replyText = json.choices?.[0]?.message?.content?.trim();
        if (replyText) {
          await db.insert(auditLog).values({
            actor: 'copilot-openai',
            action: 'agent_query',
            details: { symbol, prompt: input.prompt.slice(0, 180) },
          });
          return {
            provider: 'openai',
            reply: replyText,
            contextSummary,
            proposal,
            timestamp: new Date().toISOString(),
          };
        }
      }
    } catch {
      // Fall through cleanly to local quantitative synthesizer
    }
  }

  const lines: string[] = [
    `[Fable 5 Quant Copilot — ${symbol} (${mode} data)]`,
    `Prompt: "${input.prompt}"`,
    '',
    `1. Market Regime & Technicals:`,
    `   • Last Close: ${lastClose !== null ? lastClose.toFixed(4) : 'Unavailable'}`,
    `   • Trend Bias: ${trend} | EMA20=${snapshot?.ema20?.toFixed(2) ?? 'n/a'} vs EMA50=${snapshot?.ema50?.toFixed(2) ?? 'n/a'}`,
    `   • Momentum: RSI(14)=${snapshot?.rsi14?.toFixed(2) ?? 'n/a'} | MACD Hist=${snapshot?.macd?.histogram?.toFixed(4) ?? 'n/a'} | ADX(14)=${snapshot?.adx14?.toFixed(2) ?? 'n/a'}`,
    `   • Volatility & Regimes: ATR(14)=${snapshot?.atr14?.toFixed(4) ?? 'n/a'} | Bollinger %B=${snapshot?.bollingerPctB?.toFixed(3) ?? 'n/a'} | SuperTrend=${snapshot?.supertrendDirection ?? 'n/a'}`,
    '',
    `2. News & FinBERT Risk Overlay:`,
    `   • Rolling Headlines (${newsIntel.summary.count}): Mean Sentiment=${newsIntel.summary.avgSentiment.toFixed(3)} | Critical=${newsIntel.summary.criticalCount}`,
    `   • 3-Sigma Shock Flag: ${newsIntel.summary.shockAlert ? 'ACTIVE SHOCK DETECTED — halt new risk!' : 'Nominal (no negative tail shock)'}`,
    '',
    `3. Portfolio, Risk & Safety Posture:`,
    `   • Kill Switch: ${killed ? 'ENGAGED (new risk blocked)' : 'ARMED / READY'}`,
    `   • Paper Equity: ${paperWs.analytics ? `${paperWs.analytics.equity.toFixed(2)} ${paperWs.active?.currency ?? 'USD'} (MaxDD ${paperWs.analytics.maxDrawdownPct}%, Composite Risk ${paperWs.analytics.compositeRiskScore}/100)` : 'n/a'}`,
    `   • Risk Caps: MaxOrder=$${policy.maxOrderValue} | MaxQty=${policy.maxOrderQuantity} | DailyLoss=$${policy.dailyLossLimit} | SemiAuto=${policy.semiAutoMode ? 'ON' : 'OFF'}`,
    `   • Pending Action Queue: ${pendingRows.length} awaiting operator sign-off`,
  ];

  if (proposal) {
    lines.push(
      '',
      `4. Actionable Semi-Auto Proposal:`,
      `   • ${proposal.side.toUpperCase()} ${proposal.quantity} ${proposal.symbol} @ ${proposal.price} (${proposal.orderType.toUpperCase()})`,
      `   • Rationale: ${proposal.rationale}`,
    );
  } else {
    lines.push(
      '',
      `4. Actionable Proposal: None issued (${killed ? 'Kill switch active' : newsIntel.summary.shockAlert ? 'FinBERT shock lock' : 'No high-conviction setup / neutral momentum'}).`,
    );
  }

  await db.insert(auditLog).values({
    actor: 'copilot-local',
    action: 'agent_query',
    details: { symbol, mode, prompt: input.prompt.slice(0, 180) },
  });

  return {
    provider: 'local-quant',
    reply: lines.join('\n'),
    contextSummary,
    proposal,
    timestamp: new Date().toISOString(),
  };
}
