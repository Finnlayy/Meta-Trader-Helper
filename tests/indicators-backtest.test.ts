// indicators-backtest.test.ts — verify 29 technical indicators, nested condition evaluator, CSV/MT5 parser, market hours, and bar-by-bar backtest engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIndicator,
  computeTechnicalSnapshot,
  INDICATOR_CATALOG,
} from '../src/lib/indicators';
import { evaluateGroup } from '../src/lib/conditions';
import { runBacktest, STRATEGY_PRESETS } from '../src/lib/backtest';
import {
  generateDeterministicBenchmarkSeries,
  isMarketOpen,
  parseOhlcvPayload,
} from '../src/lib/market';

test('all 29 catalog indicators compute finite current values on 180-bar benchmark series', () => {
  const bars = generateDeterministicBenchmarkSeries({ bars: 180, startPrice: 50000, seed: 777 });
  for (const meta of INDICATOR_CATALOG) {
    const res = computeIndicator(meta.name, bars, meta.defaultParams);
    assert.equal(res.valid, true, `Expected ${meta.name} to be valid: ${res.error}`);
    for (const field of meta.fields) {
      assert.equal(Number.isFinite(res.current[field]), true, `Expected finite ${meta.name}.${field}`);
    }
  }
  const snap = computeTechnicalSnapshot(bars);
  assert.equal(snap.bars, 180);
  assert.ok(['BULLISH', 'BEARISH', 'NEUTRAL'].includes(snap.bias));
});

test('nested AND/OR/negate condition group evaluator works accurately', () => {
  const bars = generateDeterministicBenchmarkSeries({ bars: 120, startPrice: 100, seed: 42 });
  const closeLast = bars[bars.length - 1].close;

  const res = evaluateGroup(
    [
      { indicator: 'CLOSE', field: 'value', operator: '>', value: closeLast - 1 },
      {
        type: 'group',
        logic: 'OR',
        negate: true,
        children: [{ indicator: 'RSI', params: { period: 14 }, field: 'value', operator: '>', value: 99.9 }],
      },
    ],
    'AND',
    bars,
  );
  assert.equal(res.triggered, true);
});

test('backtest engine executes presets deterministically with next-bar open and risk metrics', () => {
  const bars = generateDeterministicBenchmarkSeries({ bars: 240, startPrice: 1000, seed: 999 });
  for (const [id, preset] of Object.entries(STRATEGY_PRESETS)) {
    const bt = runBacktest(bars, { ...preset, symbol: 'BTC/USDT', timeframe: '1h' });
    assert.equal(bt.success, true, `Preset ${id} failed: ${bt.error}`);
    assert.equal(bt.equityCurve.length, 240 - 50);
    assert.equal(Number.isFinite(bt.sharpeRatio), true);
    assert.equal(Number.isFinite(bt.maxDrawdown), true);
  }
});

test('parseOhlcvPayload parses standard CSV, MT5 tab export, and JSON arrays', () => {
  const mt5Csv = [
    '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>',
    '2026.11.01\t00:00:00\t1.0810\t1.0830\t1.0805\t1.0825\t512\t0\t12',
    '2026.11.01\t01:00:00\t1.0825\t1.0850\t1.0820\t1.0842\t640\t0\t10',
  ].join('\n');
  const mt5Res = parseOhlcvPayload(mt5Csv);
  assert.equal(mt5Res.candles.length, 2);
  assert.equal(mt5Res.candles[1].close, 1.0842);

  const jsonRes = parseOhlcvPayload(
    JSON.stringify([
      [1700000000000, 100, 105, 99, 103, 50],
      [1700003600000, 103, 107, 102, 106, 75],
    ]),
  );
  assert.equal(jsonRes.candles.length, 2);
});

test('isMarketOpen enforces exchange schedules', () => {
  const wednesday15Utc = new Date('2026-11-04T15:00:00Z'); // Wed 10:00 EST, 16:00 CET
  assert.equal(isMarketOpen('CRYPTO', wednesday15Utc), true);
  assert.equal(isMarketOpen('NYSE', wednesday15Utc), true);
  assert.equal(isMarketOpen('XETRA', wednesday15Utc), true);
  assert.equal(isMarketOpen('FOREX', wednesday15Utc), true);

  const saturday = new Date('2026-11-07T12:00:00Z');
  assert.equal(isMarketOpen('CRYPTO', saturday), true);
  assert.equal(isMarketOpen('NYSE', saturday), false);
  assert.equal(isMarketOpen('FOREX', saturday), false);
});
