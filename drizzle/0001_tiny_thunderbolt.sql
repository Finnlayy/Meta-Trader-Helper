CREATE TABLE "candles_cache" (
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
--> statement-breakpoint
CREATE TABLE "ea_audits" (
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
--> statement-breakpoint
CREATE TABLE "journal_notes" (
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
--> statement-breakpoint
CREATE TABLE "mt5_profiles" (
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
--> statement-breakpoint
CREATE TABLE "news_feeds" (
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
--> statement-breakpoint
CREATE TABLE "paper_orders" (
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
--> statement-breakpoint
CREATE TABLE "paper_portfolios" (
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
--> statement-breakpoint
CREATE TABLE "paper_positions" (
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
--> statement-breakpoint
CREATE TABLE "paper_trades" (
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
--> statement-breakpoint
CREATE TABLE "pending_actions" (
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
--> statement-breakpoint
CREATE TABLE "risk_settings" (
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
--> statement-breakpoint
CREATE TABLE "sentiment_events" (
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
--> statement-breakpoint
CREATE TABLE "strategy_backtests" (
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
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
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
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "safety_state" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "category" text DEFAULT 'market' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;