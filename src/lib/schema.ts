// schema.ts — durable PostgreSQL / Drizzle ORM schema for Fable 5 Intelligence Terminal. Dependencies: Drizzle ORM.
import { boolean, doublePrecision, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const safetyState = pgTable('safety_state', {
  id: integer('id').primaryKey(),
  killed: boolean('killed').notNull().default(false),
  reason: text('reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  category: text('category').notNull().default('market'),
  status: text('status').notNull(),
  lastSuccess: timestamp('last_success', { withTimezone: true }),
  lastError: text('last_error'),
  latencyMs: integer('latency_ms'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const watchlistItems = pgTable('watchlist_items', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull().default('CRYPTO'),
  assetClass: text('asset_class').notNull().default('CRYPTO'),
  displayName: text('display_name').notNull().default(''),
  notes: text('notes').notNull().default(''),
  pinned: boolean('pinned').notNull().default(false),
  lastPrice: doublePrecision('last_price'),
  bid: doublePrecision('bid'),
  ask: doublePrecision('ask'),
  changePct: doublePrecision('change_pct'),
  volume: doublePrecision('volume'),
  venue: text('venue'),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const candlesCache = pgTable('candles_cache', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  timeframe: text('timeframe').notNull(),
  timestamp: doublePrecision('timestamp').notNull(),
  open: doublePrecision('open').notNull(),
  high: doublePrecision('high').notNull(),
  low: doublePrecision('low').notNull(),
  close: doublePrecision('close').notNull(),
  volume: doublePrecision('volume').notNull().default(0),
  source: text('source').notNull().default('ccxt'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskSettings = pgTable('risk_settings', {
  id: integer('id').primaryKey(),
  maxOrderValue: doublePrecision('max_order_value').notNull().default(5000),
  maxOrderQuantity: doublePrecision('max_order_quantity').notNull().default(100),
  dailyLossLimit: doublePrecision('daily_loss_limit').notNull().default(500),
  maxOpenPositions: integer('max_open_positions').notNull().default(10),
  maxLeverage: doublePrecision('max_leverage').notNull().default(5),
  sanityChecks: boolean('sanity_checks').notNull().default(true),
  killSwitchEnforced: boolean('kill_switch_enforced').notNull().default(true),
  oneClickEnabled: boolean('one_click_enabled').notNull().default(false),
  semiAutoMode: boolean('semi_auto_mode').notNull().default(true),
  pendingTtlMinutes: integer('pending_ttl_minutes').notNull().default(5),
  blockedSymbols: jsonb('blocked_symbols').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paperPortfolios = pgTable('paper_portfolios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('USD'),
  initialBalance: doublePrecision('initial_balance').notNull().default(10000),
  balance: doublePrecision('balance').notNull().default(10000),
  leverage: doublePrecision('leverage').notNull().default(1),
  feeRate: doublePrecision('fee_rate').notNull().default(0.001),
  enforceMarketHours: boolean('enforce_market_hours').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paperOrders = pgTable('paper_orders', {
  id: text('id').primaryKey(),
  portfolioId: text('portfolio_id').notNull(),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull().default('CRYPTO'),
  side: text('side').notNull(),
  orderType: text('order_type').notNull(),
  product: text('product').notNull().default('CNC'),
  quantity: doublePrecision('quantity').notNull(),
  price: doublePrecision('price'),
  stopPrice: doublePrecision('stop_price'),
  filledQty: doublePrecision('filled_qty').notNull().default(0),
  avgPrice: doublePrecision('avg_price'),
  marginBlocked: doublePrecision('margin_blocked').notNull().default(0),
  reduceOnly: boolean('reduce_only').notNull().default(false),
  status: text('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  filledAt: timestamp('filled_at', { withTimezone: true }),
});

export const paperPositions = pgTable('paper_positions', {
  id: text('id').primaryKey(),
  portfolioId: text('portfolio_id').notNull(),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull().default('CRYPTO'),
  side: text('side').notNull(),
  product: text('product').notNull().default('CNC'),
  quantity: doublePrecision('quantity').notNull(),
  entryPrice: doublePrecision('entry_price').notNull(),
  currentPrice: doublePrecision('current_price').notNull(),
  heldMargin: doublePrecision('held_margin').notNull().default(0),
  realizedPnl: doublePrecision('realized_pnl').notNull().default(0),
  leverage: doublePrecision('leverage').notNull().default(1),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const paperTrades = pgTable('paper_trades', {
  id: text('id').primaryKey(),
  portfolioId: text('portfolio_id').notNull(),
  orderId: text('order_id').notNull(),
  symbol: text('symbol').notNull(),
  side: text('side').notNull(),
  price: doublePrecision('price').notNull(),
  quantity: doublePrecision('quantity').notNull(),
  fee: doublePrecision('fee').notNull().default(0),
  pnl: doublePrecision('pnl').notNull().default(0),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

export const pendingActions = pgTable('pending_actions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().default('paper-default'),
  orderType: text('order_type').notNull().default('placeorder'),
  symbol: text('symbol').notNull(),
  exchange: text('exchange').notNull().default('CRYPTO'),
  side: text('side').notNull(),
  quantity: doublePrecision('quantity').notNull(),
  priceType: text('price_type').notNull().default('market'),
  price: doublePrecision('price'),
  stopPrice: doublePrecision('stop_price'),
  strategy: text('strategy').notNull().default('manual'),
  rationale: text('rationale').notNull().default(''),
  orderData: jsonb('order_data').$type<Record<string, unknown>>().notNull(),
  riskSnapshot: jsonb('risk_snapshot').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  brokerOrderId: text('broker_order_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const newsFeeds = pgTable('news_feeds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  category: text('category').notNull().default('MARKETS'),
  region: text('region').notNull().default('GLOBAL'),
  source: text('source').notNull(),
  tier: integer('tier').notNull().default(2),
  enabled: boolean('enabled').notNull().default(true),
  isBuiltin: boolean('is_builtin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sentimentEvents = pgTable('sentiment_events', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull().default('manual'),
  sourceName: text('source_name').notNull().default('OPERATOR'),
  title: text('title').notNull().default(''),
  textSnippet: text('text_snippet').notNull(),
  score: doublePrecision('score').notNull(),
  label: text('label').notNull(),
  bullishMag: doublePrecision('bullish_mag').notNull().default(0),
  bearishMag: doublePrecision('bearish_mag').notNull().default(0),
  zScore: doublePrecision('z_score').notNull().default(0),
  shockTriggered: boolean('shock_triggered').notNull().default(false),
  priority: text('priority').notNull().default('ROUTINE'),
  impact: text('impact').notNull().default('LOW'),
  threatLevel: text('threat_level').notNull().default('INFO'),
  threatCategory: text('threat_category').notNull().default('general'),
  sourceFlag: text('source_flag').notNull().default('NONE'),
  tickers: jsonb('tickers').$type<string[]>().notNull().default([]),
  link: text('link'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const strategyBacktests = pgTable('strategy_backtests', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  timeframe: text('timeframe').notNull().default('1h'),
  initialCapital: doublePrecision('initial_capital').notNull().default(10000),
  positionSizePct: doublePrecision('position_size_pct').notNull().default(95),
  stopLossPct: doublePrecision('stop_loss_pct').notNull().default(0),
  takeProfitPct: doublePrecision('take_profit_pct').notNull().default(0),
  trailingStopPct: doublePrecision('trailing_stop_pct').notNull().default(0),
  entryLogic: text('entry_logic').notNull().default('AND'),
  exitLogic: text('exit_logic').notNull().default('OR'),
  entryConditions: jsonb('entry_conditions').$type<Record<string, unknown>[]>().notNull().default([]),
  exitConditions: jsonb('exit_conditions').$type<Record<string, unknown>[]>().notNull().default([]),
  totalTrades: integer('total_trades').notNull().default(0),
  winRate: doublePrecision('win_rate').notNull().default(0),
  totalReturn: doublePrecision('total_return').notNull().default(0),
  maxDrawdown: doublePrecision('max_drawdown').notNull().default(0),
  sharpe: doublePrecision('sharpe').notNull().default(0),
  sortino: doublePrecision('sortino').notNull().default(0),
  calmar: doublePrecision('calmar').notNull().default(0),
  profitFactor: doublePrecision('profit_factor').notNull().default(0),
  resultJson: jsonb('result_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journalNotes = pgTable('journal_notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  symbol: text('symbol').notNull().default(''),
  category: text('category').notNull().default('thesis'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  content: text('content').notNull(),
  linkedRef: text('linked_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mt5Profiles = pgTable('mt5_profiles', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  platform: text('platform').notNull().default('mt5'),
  region: text('region').notNull().default('new-york-server'),
  server: text('server').notNull(),
  login: text('login').notNull(),
  accountType: text('account_type').notNull().default('demo'),
  metaapiAccountId: text('metaapi_account_id').notNull().default(''),
  magicNumber: integer('magic_number').notNull().default(505001),
  status: text('status').notNull().default('NOT CONFIGURED'),
  lastError: text('last_error'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const eaAudits = pgTable('ea_audits', {
  id: text('id').primaryKey(),
  eaName: text('ea_name').notNull(),
  fileName: text('file_name').notNull(),
  language: text('language').notNull().default('de'),
  overallScore: doublePrecision('overall_score').notNull(),
  criticalIssues: integer('critical_issues').notNull().default(0),
  grammarIssues: integer('grammar_issues').notNull().default(0),
  structureIssues: integer('structure_issues').notNull().default(0),
  integrityIssues: integer('integrity_issues').notNull().default(0),
  findingsJson: jsonb('findings_json').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EaProjectFile = {
  path: string;
  name: string;
  kind: 'ea' | 'header' | 'set' | 'other';
  size: number;
  content: string;
};

export type EaParsedInput = {
  group: string;
  type: string;
  name: string;
  defaultValue: string;
  comment: string;
  file: string;
};

export type EaIncludeRef = {
  includePath: string;
  isSystem: boolean;
  resolved: boolean;
  resolvedPath: string | null;
  sourceFile: string;
};

export const eaLibrary = pgTable('ea_library', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  sourceKind: text('source_kind').notNull().default('uploaded'),
  category: text('category').notNull().default('Custom EA'),
  entryFileName: text('entry_file_name').notNull(),
  version: text('version').notNull().default('1.00'),
  author: text('author').notNull().default('User'),
  description: text('description').notNull().default(''),
  language: text('language').notNull().default('mql5'),
  fileCount: integer('file_count').notNull().default(1),
  filesJson: jsonb('files_json').$type<EaProjectFile[]>().notNull().default([]),
  inputsJson: jsonb('inputs_json').$type<EaParsedInput[]>().notNull().default([]),
  includesJson: jsonb('includes_json').$type<EaIncludeRef[]>().notNull().default([]),
  lastAuditScore: doublePrecision('last_audit_score'),
  lastAuditGrade: text('last_audit_grade'),
  lastAuditJson: jsonb('last_audit_json').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExternalMcpToolDescriptor = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export const mcpBridges = pgTable('mcp_bridges', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  endpointUrl: text('endpoint_url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  status: text('status').notNull().default('NOT CONFIGURED'),
  protocolVersion: text('protocol_version'),
  serverName: text('server_name'),
  serverVersion: text('server_version'),
  toolCount: integer('tool_count').notNull().default(0),
  toolsJson: jsonb('tools_json').$type<ExternalMcpToolDescriptor[]>().notNull().default([]),
  lastError: text('last_error'),
  lastLatencyMs: integer('last_latency_ms'),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
