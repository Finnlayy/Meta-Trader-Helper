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
