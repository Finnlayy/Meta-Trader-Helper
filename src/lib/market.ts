// market.ts — read-only CCXT ticker/OHLCV acquisition, CSV parser, market hours, and source health persistence. Dependencies: CCXT, Zod, Drizzle.
import ccxt from 'ccxt';
import { z } from 'zod';
import type { AppDatabase } from './bootstrap';
import { sources } from './schema';

export const marketQuery = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/).default('BTC/USD'),
});

export const ohlcvQuery = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/).default('BTC/USD'),
  timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '4h', '1d']).default('1h'),
  limit: z.coerce.number().int().min(10).max(500).default(180),
});

export const venues = ['kraken', 'coinbase', 'okx'] as const;

export type OhlcvBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketSnapshot = {
  status: 'LIVE' | 'OFFLINE';
  symbol: string;
  venue?: string;
  last?: number;
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
  changePct?: number | null;
  timestamp?: number | null;
  lastSuccess: string | null;
  latencyMs?: number;
  errors: string[];
};

async function recordSourceHealth(
  db: AppDatabase | null | undefined,
  sourceId: string,
  name: string,
  status: 'LIVE' | 'OFFLINE',
  latencyMs: number,
  errorMessage: string | null,
) {
  if (!db) return;
  try {
    const now = new Date();
    await db
      .insert(sources)
      .values({
        id: sourceId,
        name,
        category: 'market',
        status,
        lastSuccess: status === 'LIVE' ? now : null,
        lastError: errorMessage,
        latencyMs,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          name,
          status,
          ...(status === 'LIVE' ? { lastSuccess: now } : {}),
          lastError: errorMessage,
          latencyMs,
          updatedAt: now,
        },
      });
  } catch {
    // Non-fatal if source health write fails while DB is offline
  }
}

export async function fetchMarket(symbol: string, db?: AppDatabase | null): Promise<MarketSnapshot> {
  const errors: string[] = [];
  for (const venue of venues) {
    const exchange = new ccxt[venue]({ enableRateLimit: true, timeout: 3500 });
    const started = Date.now();
    try {
      const ticker = await exchange.fetchTicker(symbol);
      const latencyMs = Date.now() - started;
      if (typeof ticker.last !== 'number' || !Number.isFinite(ticker.last)) {
        throw new Error('No valid last price');
      }
      await recordSourceHealth(db, `ccxt:${venue}`, `CCXT / ${venue.toUpperCase()}`, 'LIVE', latencyMs, null);
      return {
        status: 'LIVE',
        venue,
        symbol,
        last: ticker.last,
        bid: ticker.bid ?? null,
        ask: ticker.ask ?? null,
        volume: ticker.quoteVolume ?? null,
        changePct: typeof ticker.percentage === 'number' && Number.isFinite(ticker.percentage) ? ticker.percentage : null,
        timestamp: ticker.timestamp ?? null,
        lastSuccess: new Date().toISOString(),
        latencyMs,
        errors,
      };
    } catch (error: unknown) {
      const latencyMs = Date.now() - started;
      const msg = error instanceof Error ? error.message : 'request failed';
      errors.push(`${venue}: ${msg}`);
      await recordSourceHealth(db, `ccxt:${venue}`, `CCXT / ${venue.toUpperCase()}`, 'OFFLINE', latencyMs, msg);
    }
  }
  return { status: 'OFFLINE', symbol, lastSuccess: null, errors };
}

export async function fetchBatchMarket(symbols: string[], db?: AppDatabase | null): Promise<MarketSnapshot[]> {
  return Promise.all(symbols.map((sym) => fetchMarket(sym, db)));
}

export async function fetchOhlcv(
  symbol: string,
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' = '1h',
  limit = 180,
  db?: AppDatabase | null,
): Promise<{ status: 'LIVE' | 'OFFLINE'; symbol: string; timeframe: string; venue?: string; candles: OhlcvBar[]; errors: string[]; latencyMs?: number }> {
  const errors: string[] = [];
  for (const venue of venues) {
    const exchange = new ccxt[venue]({ enableRateLimit: true, timeout: 4500 });
    const started = Date.now();
    try {
      if (!exchange.has['fetchOHLCV']) {
        throw new Error('OHLCV unsupported');
      }
      const rows = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      const latencyMs = Date.now() - started;
      const candles: OhlcvBar[] = [];
      for (const row of rows) {
        const [ts, o, h, l, c, v] = row;
        if (
          typeof ts === 'number' &&
          typeof o === 'number' &&
          typeof h === 'number' &&
          typeof l === 'number' &&
          typeof c === 'number' &&
          Number.isFinite(c)
        ) {
          candles.push({
            timestamp: ts,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: typeof v === 'number' && Number.isFinite(v) ? v : 0,
          });
        }
      }
      if (candles.length < 2) throw new Error('Insufficient OHLCV bars returned');
      await recordSourceHealth(db, `ccxt:${venue}`, `CCXT / ${venue.toUpperCase()}`, 'LIVE', latencyMs, null);
      return { status: 'LIVE', symbol, timeframe, venue, candles, errors, latencyMs };
    } catch (error: unknown) {
      const latencyMs = Date.now() - started;
      const msg = error instanceof Error ? error.message : 'OHLCV request failed';
      errors.push(`${venue}: ${msg}`);
      await recordSourceHealth(db, `ccxt:${venue}`, `CCXT / ${venue.toUpperCase()}`, 'OFFLINE', latencyMs, msg);
    }
  }
  return { status: 'OFFLINE', symbol, timeframe, candles: [], errors };
}

/**
 * Parse OHLCV candles from CSV (standard header or MetaTrader tab/semicolon export) or JSON array.
 */
export function parseOhlcvPayload(raw: string): { candles: OhlcvBar[]; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { candles: [], error: 'Empty candle payload' };

  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      if (!Array.isArray(arr)) return { candles: [], error: 'JSON root must be an array' };
      const candles: OhlcvBar[] = [];
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (Array.isArray(item) && item.length >= 5) {
          const ts = Number(item[0]);
          const o = Number(item[1]);
          const h = Number(item[2]);
          const l = Number(item[3]);
          const c = Number(item[4]);
          const v = item.length >= 6 ? Number(item[5]) : 0;
          if ([ts, o, h, l, c].every(Number.isFinite)) {
            candles.push({ timestamp: ts, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
          }
        } else if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          const rawTs = rec.timestamp ?? rec.time ?? rec.date;
          const ts = typeof rawTs === 'number' ? rawTs : typeof rawTs === 'string' ? Date.parse(rawTs) : i * 3600000;
          const o = Number(rec.open ?? rec.o);
          const h = Number(rec.high ?? rec.h);
          const l = Number(rec.low ?? rec.l);
          const c = Number(rec.close ?? rec.c);
          const v = Number(rec.volume ?? rec.vol ?? rec.v ?? 0);
          if ([ts, o, h, l, c].every(Number.isFinite)) {
            candles.push({ timestamp: ts, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
          }
        }
      }
      candles.sort((a, b) => a.timestamp - b.timestamp);
      return candles.length >= 2 ? { candles } : { candles: [], error: 'Parsed fewer than 2 valid OHLCV bars from JSON' };
    } catch {
      return { candles: [], error: 'Invalid JSON syntax' };
    }
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { candles: [], error: 'Need at least 2 OHLCV rows' };

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const candles: OhlcvBar[] = [];
  let startIdx = 0;
  const firstCols = lines[0].split(delimiter).map((c) => c.trim().toLowerCase().replace(/[<>]/g, ''));
  const hasHeader = firstCols.some((c) => c.includes('open') || c.includes('close') || c.includes('date') || c.includes('time'));
  if (hasHeader) startIdx = 1;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.trim());
    if (cols.length < 5) continue;
    // Handle MT5 CSV format: <DATE> <TIME> <OPEN> <HIGH> <LOW> <CLOSE> <TICKVOL> ...
    let ts: number;
    let oIdx = 1;
    if (cols.length >= 6 && /^\d{4}\.\d{2}\.\d{2}$/.test(cols[0]) && /^\d{2}:\d{2}(:\d{2})?$/.test(cols[1])) {
      ts = Date.parse(`${cols[0].replace(/\./g, '-')}T${cols[1]}Z`);
      oIdx = 2;
    } else {
      const rawDate = cols[0];
      const num = Number(rawDate);
      ts = Number.isFinite(num) && num > 10000000 ? (num < 1e12 ? num * 1000 : num) : Date.parse(rawDate.replace(/\./g, '-'));
      if (!Number.isFinite(ts)) ts = Date.now() - (lines.length - i) * 3600_000;
    }
    if (cols.length < oIdx + 4) continue;
    const o = Number(cols[oIdx]);
    const h = Number(cols[oIdx + 1]);
    const l = Number(cols[oIdx + 2]);
    const c = Number(cols[oIdx + 3]);
    const v = cols.length > oIdx + 4 ? Number(cols[oIdx + 4]) : 0;
    if ([o, h, l, c].every(Number.isFinite) && o > 0 && h >= l && c > 0) {
      candles.push({
        timestamp: ts,
        open: o,
        high: Math.max(h, o, c),
        low: Math.min(l, o, c),
        close: c,
        volume: Number.isFinite(v) && v >= 0 ? v : 0,
      });
    }
  }
  candles.sort((a, b) => a.timestamp - b.timestamp);
  return candles.length >= 2 ? { candles } : { candles: [], error: 'Parsed fewer than 2 valid OHLCV bars from CSV' };
}

/**
 * Deterministic mathematical test vector generator (seeded LCG + deterministic wave regime)
 * for verifying technical indicators and backtest math offline when live exchange feeds are unreachable.
 */
export function generateDeterministicBenchmarkSeries(opts?: {
  bars?: number;
  startPrice?: number;
  timeframeMs?: number;
  seed?: number;
}): OhlcvBar[] {
  const bars = Math.max(60, Math.min(500, opts?.bars ?? 180));
  const startPrice = opts?.startPrice ?? 50000;
  const stepMs = opts?.timeframeMs ?? 3600_000;
  let seed = (opts?.seed ?? 421337) >>> 0;
  const rand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const endTs = Math.floor(Date.now() / stepMs) * stepMs;
  const startTs = endTs - bars * stepMs;
  const out: OhlcvBar[] = [];
  let price = startPrice;

  for (let i = 0; i < bars; i++) {
    const cycle = Math.sin(i / 11) * 0.008 + Math.cos(i / 27) * 0.004;
    const noise = (rand() - 0.49) * 0.016;
    const open = price;
    const close = Math.max(1, open * (1 + cycle + noise));
    const spread = Math.max(open, close) * (0.003 + rand() * 0.007);
    const high = Math.max(open, close) + spread * rand();
    const low = Math.max(0.5, Math.min(open, close) - spread * rand());
    const volume = Math.round(120 + rand() * 880 + Math.abs(cycle + noise) * 25000);
    out.push({
      timestamp: startTs + i * stepMs,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });
    price = close;
  }
  return out;
}

export type MarketSessionInfo = {
  exchange: string;
  label: string;
  open: boolean;
  schedule: string;
  localClock: string;
};

/**
 * Exchange session schedule check ported from FinceptTerminal MarketHours.h & PaperTrading.cpp.
 */
export function isMarketOpen(exchange: string, now = new Date()): boolean {
  const ex = exchange.trim().toUpperCase();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const utcDay = now.getUTCDay(); // 0=Sun .. 6=Sat

  if (ex === 'NSE' || ex === 'BSE' || ex === 'NFO' || ex === 'BFO') {
    const istDate = new Date(now.getTime() + 330 * 60_000);
    const dow = istDate.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const t = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
    return t >= 9 * 60 + 15 && t <= 15 * 60 + 30;
  }
  if (ex === 'NYSE' || ex === 'NASDAQ' || ex === 'US') {
    const estDate = new Date(now.getTime() - 5 * 3600_000);
    const dow = estDate.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const t = estDate.getUTCHours() * 60 + estDate.getUTCMinutes();
    return t >= 9 * 60 + 30 && t <= 16 * 60;
  }
  if (ex === 'XETRA' || ex === 'EU') {
    const cetDate = new Date(now.getTime() + 60 * 60_000);
    const dow = cetDate.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    const t = cetDate.getUTCHours() * 60 + cetDate.getUTCMinutes();
    return t >= 9 * 60 && t <= 17 * 60 + 30;
  }
  if (ex === 'FOREX' || ex === 'FX' || ex === 'MT5' || ex === 'MT4') {
    if (utcDay === 6) return false;
    if (utcDay === 0 && utcMins < 22 * 60) return false;
    if (utcDay === 5 && utcMins >= 22 * 60) return false;
    return true;
  }
  return true; // CRYPTO / 24-7 venues
}

export function getMarketSessions(now = new Date()): MarketSessionInfo[] {
  const fmtOffset = (offsetMins: number) => {
    const d = new Date(now.getTime() + offsetMins * 60_000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  return [
    { exchange: 'CRYPTO', label: 'Crypto Spot', open: isMarketOpen('CRYPTO', now), schedule: '24/7 UTC', localClock: fmtOffset(0) },
    { exchange: 'FOREX', label: 'Global FX / MT5', open: isMarketOpen('FOREX', now), schedule: 'Sun 22:00 – Fri 22:00 UTC', localClock: fmtOffset(0) },
    { exchange: 'NYSE', label: 'US Equities (EST)', open: isMarketOpen('NYSE', now), schedule: 'Mon–Fri 09:30–16:00 EST', localClock: fmtOffset(-300) },
    { exchange: 'XETRA', label: 'Frankfurt XETRA (CET)', open: isMarketOpen('XETRA', now), schedule: 'Mon–Fri 09:00–17:30 CET', localClock: fmtOffset(60) },
    { exchange: 'NSE', label: 'India NSE / NFO (IST)', open: isMarketOpen('NSE', now), schedule: 'Mon–Fri 09:15–15:30 IST', localClock: fmtOffset(330) },
  ];
}
