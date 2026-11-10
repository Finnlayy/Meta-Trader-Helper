import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorized, mt5Payload, saveSnapshot, getSnapshot } from '../src/lib/mt5';
const token = 'a'.repeat(32);
const item = { time: 1700000000, open: 2, high: 3, low: 1, close: 2.5, tickVolume: 4 };
test('bridge authentication fails closed', () => {
  assert.equal(authorized(`Bearer ${token}`, token), true);
  assert.equal(authorized(`Bearer ${token}`, undefined), false);
  assert.equal(authorized('Bearer short', 'short'), false);
  assert.equal(authorized(`Bearer ${'b'.repeat(32)}`, token), false);
});
test('validates OHLC bounds and chronological order', () => {
  const payload = { symbol: 'EURUSD', timeframe: 'M1', candles: [item] };
  assert.equal(mt5Payload.safeParse(payload).success, true);
  assert.equal(mt5Payload.safeParse({ ...payload, candles: [{ ...item, high: 1 }] }).success, false);
  assert.equal(mt5Payload.safeParse({ ...payload, candles: [item, item] }).success, false);
  assert.equal(mt5Payload.safeParse({ ...payload, symbol: 'bad"name' }).success, false);
});
test('marks old data stale based on server reception time', () => {
  const time = Date.parse('2025-01-01T00:00:00Z');
  saveSnapshot({ symbol: 'EURUSD', timeframe: 'M1', candles: [item] }, new Date(time));
  assert.equal(getSnapshot(time + 30000).status, 'LIVE');
  assert.equal(getSnapshot(time + 30001).status, 'STALE');
});
