// market.test.ts — validate market input boundary. Dependencies: node:test, Zod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketQuery } from '../src/lib/market';
test('accepts a market symbol and rejects invalid input', () => {
  assert.equal(marketQuery.safeParse({ symbol: 'BTC/USD' }).success, true);
  assert.equal(marketQuery.safeParse({ symbol: '../secret' }).success, false);
});
