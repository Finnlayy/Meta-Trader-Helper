# Fable 5 — Quantitative Trading & MT5 Audit Terminal

Fable 5 is an institutional dark-mode trading intelligence, backtesting, paper execution, risk management, FinBERT sentiment, and MetaTrader 5 EA audit terminal built with Next.js 15, React 19, TypeScript, Drizzle ORM, PostgreSQL / embedded PGlite, and CCXT. Many architectural workflows are adapted from `Finnlayy/FinceptTerminal` and `Finnlayy/Strategie-Runner`.

> **Safety Notice**: Fable 5 executes paper accounts locally and requires explicit `METAAPI_TOKEN` or local `MT5_MCP_TOKEN` credentials for external MT4/MT5 connections. Do not expose this app directly to untrusted networks without adding external authentication/TLS termination.

## Implemented Workspaces (`F1`–`F8` & `Ctrl+K`)

- **`F1` Overview & Sources**: Live/Local/Offline persistence health, Kill Switch status, market session clocks (`CRYPTO`, `FOREX`, `NYSE`, `XETRA`, `NSE`), CCXT multi-venue failover ticker (`kraken`, `coinbase`, `okx`), durable `sources` registry, and immutable `audit_log`.
- **`F2` Markets & Indicators**: Durable watchlist CRUD, interactive SVG Candlestick + EMA20/EMA50 + Volume chart, all **29 technical indicators** (`RSI`, `MACD`, `ADX`, `SUPERTREND`, `ICHIMOKU`, `BOLLINGER`, `KELTNER`, `DONCHIAN`, `STOCHASTIC`, `ATR`, `OBV`, `CMF`, `MFI`, etc.), and CSV / MetaTrader tab-export / JSON OHLCV ingestion (`candles_cache`).
- **`F3` Screener & Rules**: Multi-symbol technical scanner with nested `AND`/`OR`/negate/crossing `ConditionEvaluator` rules (`evaluateGroup`) and explicit `LIVE` | `CACHED` | `BENCHMARK` provenance badges.
- **`F4` Backtest Lab**: Next-bar-open backtesting engine with 50-bar warmup, intrabar SL/TP/trailing stops, 4 strategy presets (`rsi_reversion`, `ema_crossover`, `supertrend_momentum`, `bollinger_breakout`), Equity vs Buy & Hold SVG curve, Sharpe/Sortino/Calmar/MaxDD/Profit Factor, and persistent run archive (`strategy_backtests`).
- **`F5` Paper & Action Center**: Paper Trading engine with leverage margin blocking (`CNC`/`MIS`/`NRML`), position netting, reduce-only exits, touch-based `OrderMatcher` (`market`/`limit`/`stop`/`stop_limit`), portfolio risk analytics (`Sharpe`, `Sortino`, 95% Historical VaR/CVaR, HHI, 0–100 Composite Risk Score), and **Semi-Auto Action Center** FIFO approval queue with TTL expiry sweeps.
- **`F6` Risk Core & Safety**: Fail-closed `OrderValidator` policy editor (max order value/qty, daily loss limit, max leverage, max open positions, blocked symbols, sanity caps, reducing-order exemptions), dry-run order risk simulator, and cascading **Kill Switch (`Shift+K`)** that rejects queued actions, cancels resting paper orders (releasing blocked margin), and optionally closes open positions.
- **`F7` FinBERT & Copilot**: RSS/Atom XML feed ingestion (`news_feeds`), `FinBERTRiskScorer` (`tanh(score/3.0)` + rolling 100-entry 3-sigma shock detector), Tier 1–3 source classification, and state-grounded Fable 5 Copilot (`local-quant` or optional OpenAI API) that can propose and queue risk-bounded Action Packets.
- **`F8` MT5 / EA Audit / MCP**: **MT5 EA Library & Custom File Upload Studio** (`/api/ea-library`, `ea_library/`) seeded with your Google Drive MT5 collection (`ScalpSnipper`, `KI_AI_Super_Trader`, `VizionAI ProfitGTX`, `The Architect V2.0`, `KI_AI_TRADER`, `NeuroPro Converter`, `TQA_Analyzer`, `godvisnPredictiveTraining`) plus drag-and-drop multi-file `.mq5`/`.mq4`/`.mqh`/`.set` folder upload (with UTF-16LE/UTF-8 BOM detection, parsed `input` parameters, `#include` dependency resolution, and backtest preset export), **Local MetaTrader 5 & MetaEditor Streamable HTTP MCP Bridge** (`/api/mt5-mcp`, pre-configured for `http://127.0.0.1:22346/mcp` & `http://127.0.0.1:22345/mcp` with `Bearer` token authentication, SSE/JSON parsing, and `npm run check:mt5-mcp`), `MetaApiBroker` REST profile & `[TOKEN_EXPIRED]` classifier (`mt5_profiles`), **Module-Aware MQL4/MQL5 EA Static Auditor**, clean modular `.mq5` Expert Advisor generator, **MCP JSON-RPC 2.0** tool console (18 tools), and operator trade journal (`journal_notes`).

## MT5 Read-Only OHLC Bridge (`mt5/FableBridge.mq5`)

`mt5/FableBridge.mq5` can also publish live OHLC candles from a running MT5 chart to `POST /api/mt5` using Bearer `MT5_BRIDGE_TOKEN` (minimum 32 bytes, verified with `timingSafeEqual`):

1. Configure `MT5_BRIDGE_TOKEN` in `.env` (e.g., `openssl rand -hex 32`) and restart Next.js.
2. Copy `mt5/FableBridge.mq5` into `MQL5/Experts`, compile, allow `WebRequest` for `http://127.0.0.1:3000` in MT5, and attach it with matching `BridgeToken`.
3. Read snapshots via `GET /api/mt5` with `Authorization: Bearer <MT5_BRIDGE_TOKEN>` (`LIVE` / `STALE` after 30s / `OFFLINE`).

## Storage & Local Setup

- **PostgreSQL (`DATABASE_URL` set)**: Connects via `pg` to external PostgreSQL (`LIVE`). Run `npm run db:migrate` to apply migrations (`drizzle/0000_medical_butterfly.sql`, `drizzle/0001_tiny_thunderbolt.sql`, `drizzle/0002_nappy_the_watchers.sql`, `drizzle/0003_zippy_giant_man.sql`).
- **Embedded PGlite (`DATABASE_URL` unset)**: Automatically initializes disk-backed PostgreSQL-compatible storage in `.fable5/pgdata` (`LOCAL`) with idempotent DDL and operational defaults—zero manual setup required.

```bash
npm ci
cp .env.example .env   # optional if using external PostgreSQL / MetaAPI / MT5 Local MCP / OpenAI
npm run check:mt5-mcp  # optional: verify local MetaTrader 5 MCP on http://127.0.0.1:22346/mcp
npm run dev            # starts on http://0.0.0.0:3000
```

## Verification Suite

```bash
npm run typecheck
npm run lint
npm run check:integrity
npm test
npm run build
```
