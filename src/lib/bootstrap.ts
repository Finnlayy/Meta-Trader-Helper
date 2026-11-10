// bootstrap.ts — idempotent schema initialization and default operational configuration. Dependencies: schema, drizzle-orm.
import type { PGlite } from '@electric-sql/pglite';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';
import { mcpBridges, newsFeeds, paperPortfolios, riskSettings, safetyState, sources, watchlistItems } from './schema';
import { count } from 'drizzle-orm';

export type AppDatabase = NodePgDatabase<typeof schema>;

export const BOOTSTRAP_DDL = `
CREATE TABLE IF NOT EXISTS "safety_state" (
  "id" integer PRIMARY KEY NOT NULL,
  "killed" boolean DEFAULT false NOT NULL,
  "reason" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "safety_state" ADD COLUMN IF NOT EXISTS "reason" text;

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "actor" text NOT NULL,
  "action" text NOT NULL,
  "details" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "details" jsonb;

CREATE TABLE IF NOT EXISTS "sources" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text DEFAULT '' NOT NULL,
  "category" text DEFAULT 'market' NOT NULL,
  "status" text NOT NULL,
  "last_success" timestamp with time zone,
  "last_error" text,
  "latency_ms" integer,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "name" text DEFAULT '' NOT NULL;
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'market' NOT NULL;
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

CREATE TABLE IF NOT EXISTS "watchlist_items" (
  "id" text PRIMARY KEY NOT NULL,
  "symbol" text NOT NULL,
  "exchange" text DEFAULT 'CRYPTO' NOT NULL,
  "asset_class" text DEFAULT 'CRYPTO' NOT NULL,
  "display_name" text DEFAULT '' NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "last_price" double precision,
  "bid" double precision,
  "ask" double precision,
  "change_pct" double precision,
  "volume" double precision,
  "venue" text,
  "last_updated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "candles_cache" (
  "id" text PRIMARY KEY NOT NULL,
  "symbol" text NOT NULL,
  "timeframe" text NOT NULL,
  "timestamp" double precision NOT NULL,
  "open" double precision NOT NULL,
  "high" double precision NOT NULL,
  "low" double precision NOT NULL,
  "close" double precision NOT NULL,
  "volume" double precision DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'ccxt' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "risk_settings" (
  "id" integer PRIMARY KEY NOT NULL,
  "max_order_value" double precision DEFAULT 5000 NOT NULL,
  "max_order_quantity" double precision DEFAULT 100 NOT NULL,
  "daily_loss_limit" double precision DEFAULT 500 NOT NULL,
  "max_open_positions" integer DEFAULT 10 NOT NULL,
  "max_leverage" double precision DEFAULT 5 NOT NULL,
  "sanity_checks" boolean DEFAULT true NOT NULL,
  "kill_switch_enforced" boolean DEFAULT true NOT NULL,
  "one_click_enabled" boolean DEFAULT false NOT NULL,
  "semi_auto_mode" boolean DEFAULT true NOT NULL,
  "pending_ttl_minutes" integer DEFAULT 5 NOT NULL,
  "blocked_symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "paper_portfolios" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "initial_balance" double precision DEFAULT 10000 NOT NULL,
  "balance" double precision DEFAULT 10000 NOT NULL,
  "leverage" double precision DEFAULT 1 NOT NULL,
  "fee_rate" double precision DEFAULT 0.001 NOT NULL,
  "enforce_market_hours" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "paper_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "portfolio_id" text NOT NULL,
  "symbol" text NOT NULL,
  "exchange" text DEFAULT 'CRYPTO' NOT NULL,
  "side" text NOT NULL,
  "order_type" text NOT NULL,
  "product" text DEFAULT 'CNC' NOT NULL,
  "quantity" double precision NOT NULL,
  "price" double precision,
  "stop_price" double precision,
  "filled_qty" double precision DEFAULT 0 NOT NULL,
  "avg_price" double precision,
  "margin_blocked" double precision DEFAULT 0 NOT NULL,
  "reduce_only" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "filled_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "paper_positions" (
  "id" text PRIMARY KEY NOT NULL,
  "portfolio_id" text NOT NULL,
  "symbol" text NOT NULL,
  "exchange" text DEFAULT 'CRYPTO' NOT NULL,
  "side" text NOT NULL,
  "product" text DEFAULT 'CNC' NOT NULL,
  "quantity" double precision NOT NULL,
  "entry_price" double precision NOT NULL,
  "current_price" double precision NOT NULL,
  "held_margin" double precision DEFAULT 0 NOT NULL,
  "realized_pnl" double precision DEFAULT 0 NOT NULL,
  "leverage" double precision DEFAULT 1 NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "paper_trades" (
  "id" text PRIMARY KEY NOT NULL,
  "portfolio_id" text NOT NULL,
  "order_id" text NOT NULL,
  "symbol" text NOT NULL,
  "side" text NOT NULL,
  "price" double precision NOT NULL,
  "quantity" double precision NOT NULL,
  "fee" double precision DEFAULT 0 NOT NULL,
  "pnl" double precision DEFAULT 0 NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "pending_actions" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text DEFAULT 'paper-default' NOT NULL,
  "order_type" text DEFAULT 'placeorder' NOT NULL,
  "symbol" text NOT NULL,
  "exchange" text DEFAULT 'CRYPTO' NOT NULL,
  "side" text NOT NULL,
  "quantity" double precision NOT NULL,
  "price_type" text DEFAULT 'market' NOT NULL,
  "price" double precision,
  "stop_price" double precision,
  "strategy" text DEFAULT 'manual' NOT NULL,
  "rationale" text DEFAULT '' NOT NULL,
  "order_data" jsonb NOT NULL,
  "risk_snapshot" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "rejection_reason" text,
  "broker_order_id" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "news_feeds" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "category" text DEFAULT 'MARKETS' NOT NULL,
  "region" text DEFAULT 'GLOBAL' NOT NULL,
  "source" text NOT NULL,
  "tier" integer DEFAULT 2 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "is_builtin" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sentiment_events" (
  "id" text PRIMARY KEY NOT NULL,
  "source_type" text DEFAULT 'manual' NOT NULL,
  "source_name" text DEFAULT 'OPERATOR' NOT NULL,
  "title" text DEFAULT '' NOT NULL,
  "text_snippet" text NOT NULL,
  "score" double precision NOT NULL,
  "label" text NOT NULL,
  "bullish_mag" double precision DEFAULT 0 NOT NULL,
  "bearish_mag" double precision DEFAULT 0 NOT NULL,
  "z_score" double precision DEFAULT 0 NOT NULL,
  "shock_triggered" boolean DEFAULT false NOT NULL,
  "priority" text DEFAULT 'ROUTINE' NOT NULL,
  "impact" text DEFAULT 'LOW' NOT NULL,
  "threat_level" text DEFAULT 'INFO' NOT NULL,
  "threat_category" text DEFAULT 'general' NOT NULL,
  "source_flag" text DEFAULT 'NONE' NOT NULL,
  "tickers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "link" text,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "strategy_backtests" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "symbol" text NOT NULL,
  "timeframe" text DEFAULT '1h' NOT NULL,
  "initial_capital" double precision DEFAULT 10000 NOT NULL,
  "position_size_pct" double precision DEFAULT 95 NOT NULL,
  "stop_loss_pct" double precision DEFAULT 0 NOT NULL,
  "take_profit_pct" double precision DEFAULT 0 NOT NULL,
  "trailing_stop_pct" double precision DEFAULT 0 NOT NULL,
  "entry_logic" text DEFAULT 'AND' NOT NULL,
  "exit_logic" text DEFAULT 'OR' NOT NULL,
  "entry_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "exit_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "total_trades" integer DEFAULT 0 NOT NULL,
  "win_rate" double precision DEFAULT 0 NOT NULL,
  "total_return" double precision DEFAULT 0 NOT NULL,
  "max_drawdown" double precision DEFAULT 0 NOT NULL,
  "sharpe" double precision DEFAULT 0 NOT NULL,
  "sortino" double precision DEFAULT 0 NOT NULL,
  "calmar" double precision DEFAULT 0 NOT NULL,
  "profit_factor" double precision DEFAULT 0 NOT NULL,
  "result_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "journal_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "symbol" text DEFAULT '' NOT NULL,
  "category" text DEFAULT 'thesis' NOT NULL,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "content" text NOT NULL,
  "linked_ref" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "mt5_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "platform" text DEFAULT 'mt5' NOT NULL,
  "region" text DEFAULT 'new-york-server' NOT NULL,
  "server" text NOT NULL,
  "login" text NOT NULL,
  "account_type" text DEFAULT 'demo' NOT NULL,
  "metaapi_account_id" text DEFAULT '' NOT NULL,
  "magic_number" integer DEFAULT 505001 NOT NULL,
  "status" text DEFAULT 'NOT CONFIGURED' NOT NULL,
  "last_error" text,
  "last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ea_audits" (
  "id" text PRIMARY KEY NOT NULL,
  "ea_name" text NOT NULL,
  "file_name" text NOT NULL,
  "language" text DEFAULT 'de' NOT NULL,
  "overall_score" double precision NOT NULL,
  "critical_issues" integer DEFAULT 0 NOT NULL,
  "grammar_issues" integer DEFAULT 0 NOT NULL,
  "structure_issues" integer DEFAULT 0 NOT NULL,
  "integrity_issues" integer DEFAULT 0 NOT NULL,
  "findings_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ea_library" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "source_kind" text DEFAULT 'uploaded' NOT NULL,
  "category" text DEFAULT 'Custom EA' NOT NULL,
  "entry_file_name" text NOT NULL,
  "version" text DEFAULT '1.00' NOT NULL,
  "author" text DEFAULT 'User' NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "language" text DEFAULT 'mql5' NOT NULL,
  "file_count" integer DEFAULT 1 NOT NULL,
  "files_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "inputs_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "includes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_audit_score" double precision,
  "last_audit_grade" text,
  "last_audit_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "mcp_bridges" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "endpoint_url" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "status" text DEFAULT 'NOT CONFIGURED' NOT NULL,
  "protocol_version" text,
  "server_name" text,
  "server_version" text,
  "tool_count" integer DEFAULT 0 NOT NULL,
  "tools_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_error" text,
  "last_latency_ms" integer,
  "last_connected_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
`;

export const BUILTIN_RSS_FEEDS = [
  { id: 'sec-press', name: 'SEC Press Releases', url: 'https://www.sec.gov/news/pressreleases.rss', category: 'REGULATORY', region: 'US', source: 'SEC', tier: 1 },
  { id: 'fed-press', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'REGULATORY', region: 'US', source: 'FEDERAL RESERVE', tier: 1 },
  { id: 'ecb-press', name: 'ECB Press', url: 'https://www.ecb.europa.eu/rss/press.html', category: 'REGULATORY', region: 'EU', source: 'ECB', tier: 1 },
  { id: 'boe-news', name: 'Bank of England', url: 'https://www.bankofengland.co.uk/rss/news', category: 'REGULATORY', region: 'UK', source: 'BOE', tier: 1 },
  { id: 'bloomberg-mkts', name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', category: 'MARKETS', region: 'GLOBAL', source: 'BLOOMBERG', tier: 2 },
  { id: 'marketwatch', name: 'MarketWatch', url: 'https://feeds.marketwatch.com/marketwatch/topstories/', category: 'MARKETS', region: 'US', source: 'MARKETWATCH', tier: 2 },
  { id: 'cnbc-finance', name: 'CNBC Finance', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', category: 'MARKETS', region: 'US', source: 'CNBC', tier: 2 },
  { id: 'fxstreet', name: 'FXStreet News', url: 'https://www.fxstreet.com/rss/news', category: 'MARKETS', region: 'GLOBAL', source: 'FXSTREET', tier: 2 },
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'CRYPTO', region: 'GLOBAL', source: 'COINDESK', tier: 2 },
  { id: 'cointelegraph', name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss', category: 'CRYPTO', region: 'GLOBAL', source: 'COINTELEGRAPH', tier: 2 },
  { id: 'oilprice', name: 'OilPrice.com', url: 'https://oilprice.com/rss/main', category: 'ENERGY', region: 'GLOBAL', source: 'OILPRICE', tier: 2 },
  { id: 'bbc-business', name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'MARKETS', region: 'GLOBAL', source: 'BBC', tier: 2 },
] as const;

export const DEFAULT_SOURCES = [
  { id: 'ccxt:kraken', name: 'CCXT / Kraken', category: 'market', status: 'PENDING' },
  { id: 'ccxt:coinbase', name: 'CCXT / Coinbase', category: 'market', status: 'PENDING' },
  { id: 'ccxt:okx', name: 'CCXT / OKX', category: 'market', status: 'PENDING' },
  { id: 'sentiment:lexicon', name: 'FinBERT Risk & Sentiment Engine', category: 'intelligence', status: 'READY' },
  { id: 'news:rss', name: 'Global Financial RSS Wire', category: 'news', status: 'PENDING' },
  { id: 'mt5:metaapi', name: 'MetaTrader / MetaAPI Bridge', category: 'broker', status: 'NOT CONFIGURED' },
  { id: 'mt5:local-mcp', name: 'MetaTrader 5 Local MCP (127.0.0.1:22346)', category: 'mt5', status: 'READY' },
  { id: 'mt5:ea-auditor', name: 'MQL5 EA Static Auditor', category: 'mt5', status: 'READY' },
  { id: 'mt5:ea-library', name: 'MT5 EA Library & Upload Vault', category: 'mt5', status: 'READY' },
] as const;

export const DEFAULT_MCP_BRIDGES = [
  {
    id: 'mt5-terminal',
    name: 'MetaTrader 5 Terminal MCP',
    endpointUrl: process.env.MT5_MCP_URL?.trim() || 'http://127.0.0.1:22346/mcp',
    enabled: true,
    status: process.env.MT5_MCP_TOKEN?.trim() ? 'READY' : 'NOT CONFIGURED',
  },
  {
    id: 'metaeditor',
    name: 'MetaEditor 5 MCP',
    endpointUrl: process.env.METAEDITOR_MCP_URL?.trim() || 'http://127.0.0.1:22345/mcp',
    enabled: true,
    status: process.env.METAEDITOR_MCP_TOKEN?.trim() ? 'READY' : 'NOT CONFIGURED',
  },
] as const;

export const DEFAULT_WATCHLIST = [
  { id: 'wl-btc-usd', symbol: 'BTC/USD', exchange: 'CRYPTO', assetClass: 'CRYPTO', displayName: 'Bitcoin / US Dollar', pinned: true },
  { id: 'wl-eth-usd', symbol: 'ETH/USD', exchange: 'CRYPTO', assetClass: 'CRYPTO', displayName: 'Ethereum / US Dollar', pinned: true },
  { id: 'wl-sol-usd', symbol: 'SOL/USD', exchange: 'CRYPTO', assetClass: 'CRYPTO', displayName: 'Solana / US Dollar', pinned: false },
  { id: 'wl-eur-usd', symbol: 'EUR/USD', exchange: 'FOREX', assetClass: 'FOREX', displayName: 'Euro / US Dollar', pinned: false },
] as const;

export async function runBootstrapSql(pglite: PGlite) {
  await pglite.exec(BOOTSTRAP_DDL);
}

export async function ensureInitialOperationalDefaults(db: AppDatabase) {
  await db.insert(safetyState).values({ id: 1, killed: false, reason: null }).onConflictDoNothing();
  await db.insert(riskSettings).values({ id: 1 }).onConflictDoNothing();

  for (const src of DEFAULT_SOURCES) {
    await db.insert(sources).values({
      id: src.id,
      name: src.name,
      category: src.category,
      status: src.status,
    }).onConflictDoNothing();
  }

  for (const bridge of DEFAULT_MCP_BRIDGES) {
    await db.insert(mcpBridges).values({
      id: bridge.id,
      name: bridge.name,
      endpointUrl: bridge.endpointUrl,
      enabled: bridge.enabled,
      status: bridge.status,
    }).onConflictDoNothing();
  }

  for (const feed of BUILTIN_RSS_FEEDS) {
    await db.insert(newsFeeds).values({
      id: feed.id,
      name: feed.name,
      url: feed.url,
      category: feed.category,
      region: feed.region,
      source: feed.source,
      tier: feed.tier,
      enabled: true,
      isBuiltin: true,
    }).onConflictDoNothing();
  }

  const [{ value: portfolioCount }] = await db.select({ value: count() }).from(paperPortfolios);
  if (Number(portfolioCount) === 0) {
    await db.insert(paperPortfolios).values({
      id: 'paper-default',
      name: 'Fable 5 Primary Paper Desk',
      currency: 'USD',
      initialBalance: 10000,
      balance: 10000,
      leverage: 2,
      feeRate: 0.001,
      enforceMarketHours: false,
    }).onConflictDoNothing();
  }

  const [{ value: watchCount }] = await db.select({ value: count() }).from(watchlistItems);
  if (Number(watchCount) === 0) {
    for (const item of DEFAULT_WATCHLIST) {
      await db.insert(watchlistItems).values({
        id: item.id,
        symbol: item.symbol,
        exchange: item.exchange,
        assetClass: item.assetClass,
        displayName: item.displayName,
        pinned: item.pinned,
      }).onConflictDoNothing();
    }
  }
}
