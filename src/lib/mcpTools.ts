// mcpTools.ts — MCP-style JSON-RPC 2.0 tool registry & dispatcher ported from FinceptTerminal MCP_TOOLS_GUIDE.md. Dependencies: schema, market, indicators, backtest, paper, actionCenter, risk, sentiment, eaAudit, screener.
import { desc } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { executeKillSwitch, listActionCenterState, queueActionPacket } from './actionCenter';
import { STRATEGY_PRESETS, runBacktest } from './backtest';
import { auditMql5Source } from './eaAudit';
import { computeTechnicalSnapshot } from './indicators';
import { getEaLibraryItem, listEaLibrary } from './eaLibrary';
import { getPaperWorkspace, placePaperOrder } from './paper';
import { evaluatePreTradeRisk, isKillSwitchActive, loadRiskPolicy } from './risk';
import { journalNotes } from './schema';
import { loadSymbolBars, runTechnicalScreener } from './screener';
import { listNewsIntelligence, scoreTextWithFinbertModel } from './sentiment';

export type McpSafetyTier = 'read_only' | 'write_local' | 'write_execution';

export type McpToolSpec = {
  name: string;
  area: string;
  safety: McpSafetyTier;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const MCP_TOOLS: McpToolSpec[] = [
  {
    name: 'market.get_ohlcv',
    area: 'market',
    safety: 'read_only',
    description: 'Fetch OHLCV candles from live CCXT, cached database, or mathematical benchmark series.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', default: 'BTC/USDT' },
        timeframe: { type: 'string', default: '1h' },
        limit: { type: 'number', default: 120 },
      },
    },
  },
  {
    name: 'indicators.snapshot',
    area: 'indicators',
    safety: 'read_only',
    description: 'Compute all 29 Fincept/Fable5 technical indicators for a symbol.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', default: 'BTC/USDT' }, timeframe: { type: 'string', default: '1h' } },
    },
  },
  {
    name: 'screener.run',
    area: 'screener',
    safety: 'read_only',
    description: 'Scan the active watchlist or symbol list and return RSI, MACD, ADX, ATR%, and trend bias.',
    inputSchema: {
      type: 'object',
      properties: { symbols: { type: 'array', items: { type: 'string' } }, timeframe: { type: 'string', default: '1h' } },
    },
  },
  {
    name: 'backtest.run',
    area: 'backtest',
    safety: 'read_only',
    description: 'Run bar-by-bar backtest (next-bar open fills, intrabar SL/TP/trailing) using a preset strategy.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', default: 'BTC/USDT' },
        presetId: { type: 'string', default: 'ema-cross' },
        initialCapital: { type: 'number', default: 10000 },
      },
    },
  },
  {
    name: 'paper.get_portfolio',
    area: 'paper',
    safety: 'read_only',
    description: 'Retrieve active paper portfolio balances, open positions, trades, VaR, Sharpe, and risk score.',
    inputSchema: { type: 'object', properties: { portfolioId: { type: 'string', default: 'paper-default' } } },
  },
  {
    name: 'paper.place_order',
    area: 'paper',
    safety: 'write_execution',
    description: 'Execute a paper order subject to Risk Core validation and Kill Switch enforcement.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side', 'quantity'],
      properties: {
        portfolioId: { type: 'string', default: 'paper-default' },
        symbol: { type: 'string' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        orderType: { type: 'string', enum: ['market', 'limit', 'stop', 'stop_limit'], default: 'market' },
        quantity: { type: 'number' },
        price: { type: 'number' },
      },
    },
  },
  {
    name: 'action.list',
    area: 'action',
    safety: 'read_only',
    description: 'List Semi-Auto Action Center pending, approved, and rejected packets (sweeps expired TTLs).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'action.queue',
    area: 'action',
    safety: 'write_execution',
    description: 'Queue a risk-validated order packet in the Semi-Auto Action Center for operator sign-off.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side', 'quantity'],
      properties: {
        symbol: { type: 'string' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        orderType: { type: 'string', default: 'limit' },
        quantity: { type: 'number' },
        price: { type: 'number' },
        rationale: { type: 'string' },
      },
    },
  },
  {
    name: 'risk.get_policy',
    area: 'risk',
    safety: 'read_only',
    description: 'Inspect current Risk Core limits, SemiAuto TTL, blocked symbols, and Kill Switch status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'risk.evaluate_order',
    area: 'risk',
    safety: 'read_only',
    description: 'Dry-run an order candidate against structural checks and Pre-Trade Risk Core.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side', 'quantity', 'price'],
      properties: {
        symbol: { type: 'string' },
        exchange: { type: 'string', default: 'CRYPTO' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        orderType: { type: 'string', default: 'limit' },
        quantity: { type: 'number' },
        price: { type: 'number' },
      },
    },
  },
  {
    name: 'news.score_text',
    area: 'news',
    safety: 'read_only',
    description: 'Score headline/text using the FinBERT lexicon & 3-sigma shock model.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
  },
  {
    name: 'news.list',
    area: 'news',
    safety: 'read_only',
    description: 'List ingested news intelligence sorted by publication date with sentiment & shock summary.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 25 } } },
  },
  {
    name: 'mt5.audit_ea',
    area: 'mt5',
    safety: 'read_only',
    description: 'Run static MQL5 EA risk/execution audit on raw .mq5 source code.',
    inputSchema: { type: 'object', required: ['source'], properties: { source: { type: 'string' } } },
  },
  {
    name: 'mt5.list_ea_library',
    area: 'mt5',
    safety: 'read_only',
    description: 'List bundled Google Drive EAs and uploaded/generated custom EAs in the MT5 library.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mt5.inspect_ea',
    area: 'mt5',
    safety: 'read_only',
    description: 'Inspect an MT5 EA library project: files, parsed MQL inputs, #include resolution, and multi-file audit score.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  },
  {
    name: 'mt5.audit_library_ea',
    area: 'mt5',
    safety: 'read_only',
    description: 'Run module-aware static audit across an EA project and all attached .mqh files in the library.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
  },
  {
    name: 'notes.list',
    area: 'notes',
    safety: 'read_only',
    description: 'List operator trade journal and thesis notes stored in PostgreSQL/PGlite.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'safety.kill_switch',
    area: 'safety',
    safety: 'write_execution',
    description: 'Engage emergency Kill Switch: blocks new risk, rejects pending actions, cancels resting paper orders.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string' }, squareOffPositions: { type: 'boolean', default: false } },
    },
  },
];

const VALID_TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
function toTimeframe(v: unknown): Timeframe {
  const s = String(v ?? '1h');
  return VALID_TIMEFRAMES.has(s) ? (s as Timeframe) : '1h';
}

export async function dispatchMcpTool(
  db: AppDatabase,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (name) {
    case 'market.get_ohlcv': {
      const symbol = String(args.symbol ?? 'BTC/USDT');
      const timeframe = toTimeframe(args.timeframe);
      const limit = Math.min(500, Math.max(20, Number(args.limit ?? 120)));
      const res = await loadSymbolBars(db, symbol, timeframe, limit, true);
      return { symbol, timeframe, mode: res.mode, count: res.bars.length, bars: res.bars.slice(-50) };
    }
    case 'indicators.snapshot': {
      const symbol = String(args.symbol ?? 'BTC/USDT');
      const timeframe = toTimeframe(args.timeframe);
      const res = await loadSymbolBars(db, symbol, timeframe, 180, true);
      const snapshot = computeTechnicalSnapshot(res.bars);
      return { symbol, timeframe, mode: res.mode, snapshot };
    }
    case 'screener.run': {
      const symbols = Array.isArray(args.symbols) ? args.symbols.map(String) : undefined;
      const timeframe = toTimeframe(args.timeframe);
      return runTechnicalScreener(db, { symbols, timeframe, allowBenchmarkFallback: true });
    }
    case 'backtest.run': {
      const symbol = String(args.symbol ?? 'BTC/USDT');
      const presetId = String(args.presetId ?? 'ema_crossover');
      const preset = STRATEGY_PRESETS[presetId] ?? STRATEGY_PRESETS.ema_crossover;
      const res = await loadSymbolBars(db, symbol, '1h', 250, true);
      const report = runBacktest(res.bars, {
        ...preset,
        symbol,
        timeframe: '1h',
        initialCapital: Number(args.initialCapital ?? preset.initialCapital ?? 10000),
      });
      return { symbol, mode: res.mode, preset: preset.name, report };
    }
    case 'paper.get_portfolio': {
      return getPaperWorkspace(db, String(args.portfolioId ?? 'paper-default'));
    }
    case 'paper.place_order': {
      const symbol = String(args.symbol ?? 'BTC/USDT');
      const price = typeof args.price === 'number' ? args.price : undefined;
      let refPrice = price;
      if (!refPrice) {
        const res = await loadSymbolBars(db, symbol, '1h', 60, true);
        refPrice = res.bars[res.bars.length - 1]?.close;
      }
      return placePaperOrder(db, {
        portfolioId: String(args.portfolioId ?? 'paper-default'),
        symbol,
        side: args.side === 'sell' ? 'sell' : 'buy',
        orderType: (args.orderType as 'market' | 'limit' | 'stop' | 'stop_limit') ?? 'market',
        quantity: Number(args.quantity ?? 0.01),
        price: price ?? null,
        refPrice: refPrice ?? null,
      });
    }
    case 'action.list': {
      return listActionCenterState(db);
    }
    case 'action.queue': {
      return queueActionPacket(db, {
        symbol: String(args.symbol ?? 'BTC/USDT'),
        side: args.side === 'sell' ? 'sell' : 'buy',
        orderType: (args.orderType as 'market' | 'limit' | 'stop' | 'stop_limit') ?? 'limit',
        quantity: Number(args.quantity ?? 0.01),
        price: typeof args.price === 'number' ? args.price : null,
        refPrice: typeof args.price === 'number' ? args.price : null,
        rationale: String(args.rationale ?? 'Queued via MCP tool'),
        strategy: 'mcp-agent',
      });
    }
    case 'risk.get_policy': {
      const [policy, killed] = await Promise.all([loadRiskPolicy(db), isKillSwitchActive(db)]);
      return { policy, killed };
    }
    case 'risk.evaluate_order': {
      const [policy, killed, ws] = await Promise.all([
        loadRiskPolicy(db),
        isKillSwitchActive(db),
        getPaperWorkspace(db, 'paper-default'),
      ]);
      const price = Number(args.price ?? 0);
      return evaluatePreTradeRisk(
        {
          symbol: String(args.symbol ?? ''),
          exchange: String(args.exchange ?? 'CRYPTO'),
          side: args.side === 'sell' ? 'sell' : 'buy',
          orderType: (args.orderType as 'market' | 'limit' | 'stop' | 'stop_limit') ?? 'limit',
          quantity: Number(args.quantity ?? 0),
          price,
        },
        policy,
        {
          refPrice: price,
          buyingPower: ws.active?.balance ?? 0,
          dayPnl: ws.analytics?.todayPnl ?? 0,
          dayPnlKnown: true,
          openPositionCount: ws.positions.length,
          reducesPosition: false,
          killed,
          enforcedAccount: true,
        },
      );
    }
    case 'news.score_text': {
      return scoreTextWithFinbertModel(String(args.text ?? ''));
    }
    case 'news.list': {
      return listNewsIntelligence(db, Math.min(100, Number(args.limit ?? 25)));
    }
    case 'mt5.audit_ea': {
      return auditMql5Source(String(args.source ?? ''));
    }
    case 'mt5.list_ea_library': {
      return listEaLibrary(db);
    }
    case 'mt5.inspect_ea': {
      const ea = await getEaLibraryItem(db, String(args.id ?? ''));
      if (!ea) throw new Error(`EA library item not found: ${String(args.id ?? '')}`);
      return {
        ...ea,
        files: ea.files.map((f) => ({ path: f.path, kind: f.kind, size: f.size })),
      };
    }
    case 'mt5.audit_library_ea': {
      const ea = await getEaLibraryItem(db, String(args.id ?? ''));
      if (!ea) throw new Error(`EA library item not found: ${String(args.id ?? '')}`);
      const entry = ea.files.find((f) => f.path === ea.entryFileName) ?? ea.files[0];
      if (!entry) throw new Error('EA contains no source files.');
      return auditMql5Source(
        entry.content,
        ea.files.filter((f) => f.path !== entry.path).map((f) => ({ path: f.path, content: f.content })),
        entry.path,
      );
    }
    case 'notes.list': {
      return db.select().from(journalNotes).orderBy(desc(journalNotes.updatedAt)).limit(50);
    }
    case 'safety.kill_switch': {
      return executeKillSwitch(db, {
        reason: String(args.reason ?? 'Triggered via MCP safety.kill_switch'),
        squareOffPositions: Boolean(args.squareOffPositions),
        actor: 'mcp-tool',
      });
    }
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}
