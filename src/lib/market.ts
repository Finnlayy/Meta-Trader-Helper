// market.ts — read-only CCXT ticker acquisition. Dependencies: CCXT, Zod.
import ccxt from 'ccxt';
import { z } from 'zod';

export const marketQuery = z.object({ symbol: z.string().regex(/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/).default('BTC/USD') });
export const venues = ['kraken', 'coinbase', 'okx'] as const;
export async function fetchMarket(symbol: string) {
  const errors: string[] = [];
  for (const venue of venues) {
    const exchange = new ccxt[venue]({ enableRateLimit: true, timeout: 3500 });
    const started = Date.now();
    try {
      const ticker = await exchange.fetchTicker(symbol);
      if (typeof ticker.last !== 'number' || !Number.isFinite(ticker.last)) throw new Error('No valid last price');
      return { status: 'LIVE' as const, venue, symbol, last: ticker.last, bid: ticker.bid ?? null, ask: ticker.ask ?? null, volume: ticker.quoteVolume ?? null, timestamp: ticker.timestamp ?? null, lastSuccess: new Date().toISOString(), latencyMs: Date.now() - started, errors };
    } catch (error: unknown) {
      errors.push(`${venue}: ${error instanceof Error ? error.message : 'request failed'}`);
    }
  }
  return { status: 'OFFLINE' as const, symbol, lastSuccess: null, errors };
}
