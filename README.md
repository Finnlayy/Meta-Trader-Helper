# Fable 5 — foundation only

This repository is an incomplete foundation, **not a trading system and not safe for real capital**. There is no order execution, risk enforcement, MT5 bridge, authentication, or agent intelligence. The visible kill control only records a request in PostgreSQL and cannot stop external systems. Do not expose this application to an untrusted network.

## Implemented

- Next.js/TypeScript console with explicit unavailable states and a read-only BTC/USD CCXT ticker request, trying Kraken, Coinbase and OKX in order. No exchange credentials or order methods are used.
- PostgreSQL/Drizzle tables and migration for safety state, audit entries and source records. The kill request and audit entry are written atomically. The source records are not yet connected to the market adapter; last success is only held in the browser for the current request.
- Same-origin check for the kill endpoint, a keyboard shortcut (Shift+K), and a source integrity check. There is no login or authorization: the check is not a substitute for authentication.

## Local setup

Use Node.js 22 and PostgreSQL. Run `npm ci`, copy `.env.example` to `.env` and set `DATABASE_URL`, then `npm run db:migrate` and `npm run dev`. Visit http://localhost:3000. The market request requires outbound access to the selected exchanges. The status endpoint reports missing or unreachable PostgreSQL explicitly. There is no seed.

Checks: `npm run typecheck`, `npm run lint`, `npm run check:integrity`, `npm test`, and `npm run build`.

## Missing before production

The requested P0 system is incomplete: durable source registry, watchlist, candles, FinBERT, risk core, agent sequence, action packets, paper engine and meaningful kill enforcement are absent. Also absent are all MT5, MCP/Hermes, approvals, Kanban, journal, learning, knowledge, credentials, and other requested features. The current migration has not been tested against a running database in this environment. Only a market-input boundary test exists; comprehensive risk, execution and integration tests are still required. No MetaEditor or EA is included. The kill record must not be mistaken for a functional protective mechanism.

## MT5 bridge: first read-only step

`mt5/FableBridge.mq5` publishes the latest OHLC candles from a running MT5 terminal to `POST /api/mt5`. This is **not an order bridge**: it does not read accounts or positions, execute orders, enforce risk limits, or implement a kill switch. The latest snapshot lives only in the Next.js server process: it is lost on restart and is not shared between instances. It is not suitable for serverless or multi-instance deployments. `LIVE` indicates recent receipt, not a guarantee that the broker feed or the current candle is fresh. The current (unfinished) candle is included.

1. Configure `MT5_BRIDGE_TOKEN` in `.env` with a unique secret of at least 32 bytes (for example, `openssl rand -hex 32`), then restart Next.js. Keep this token out of source control, browser code, and logs.
2. In MT5/MetaEditor, copy `mt5/FableBridge.mq5` into `MQL5/Experts`, compile it, and attach it to a chart. Set the same token, symbol (empty means chart symbol), timeframe, candle count and interval in the EA inputs. The default URL assumes MT5 (including Wine) and Next.js share the same host.
3. In MT5 under Tools → Options → Expert Advisors, allow WebRequest for the application origin (e.g. `http://127.0.0.1:3000`). Enable the EA. Inspect the Experts/Journal logs if requests fail. MT5 needs a broker connection and available symbol history. Time values are Unix seconds supplied by MT5; verify broker timestamps against the actual feed.
4. Read the latest snapshot from `GET /api/mt5` using `Authorization: Bearer <MT5_BRIDGE_TOKEN>`. The endpoint returns `OFFLINE` before the first successful submission and `STALE` after 30 seconds without one. Payloads must be chronological, unique and have valid OHLC ranges. Only the most recently received symbol/timeframe is retained.

Both endpoints require the token and fail closed when it is missing or too short. The default HTTP URL is appropriate only for a trusted local host: bearer tokens and market data are not encrypted over HTTP. For remote connections use properly configured HTTPS and network access controls. The existing app has no user authentication and its dev server binds all interfaces; do not expose it to untrusted networks. MT5/Wine and the EA have not been tested against a live terminal in this environment.
