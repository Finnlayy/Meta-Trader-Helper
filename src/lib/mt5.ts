// MT5 data boundary. State is process-local and deliberately not used for trading.
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';

const candle = z.object({
  time: z.number().int().positive(),
  open: z.number().finite().positive(), high: z.number().finite().positive(),
  low: z.number().finite().positive(), close: z.number().finite().positive(),
  tickVolume: z.number().int().nonnegative(),
}).strict().refine(c => c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close) && c.low <= c.high, 'Invalid OHLC range');
export const mt5Payload = z.object({
  symbol: z.string().min(1).max(64).regex(/^[A-Za-z0-9._#-]+$/),
  timeframe: z.enum(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1']),
  candles: z.array(candle).min(1).max(500),
}).strict().refine(p => p.candles.every((c, i, a) => i === 0 || c.time > a[i - 1].time), 'Candles must be ordered by time without duplicates');
export type Mt5Payload = z.infer<typeof mt5Payload>;
export function authorized(header: string | null, token: string | undefined): boolean {
  if (!token || Buffer.byteLength(token) < 32 || !header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
type Snapshot = Mt5Payload & { receivedAt: string };
// globalThis retains the latest snapshot during Next.js development hot reloads.
const state = globalThis as typeof globalThis & { mt5Snapshot?: Snapshot };
export function saveSnapshot(payload: Mt5Payload, now = new Date()): Snapshot {
  return state.mt5Snapshot = { ...payload, receivedAt: now.toISOString() };
}
export function getSnapshot(now = Date.now()) {
  const snapshot = state.mt5Snapshot;
  if (!snapshot) return { status: 'OFFLINE' as const, snapshot: null };
  const ageMs = Math.max(0, now - Date.parse(snapshot.receivedAt));
  return { status: ageMs <= 30000 ? 'LIVE' as const : 'STALE' as const, ageMs, snapshot };
}
