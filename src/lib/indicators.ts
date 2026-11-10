// indicators.ts — 23+ technical indicators ported from FinceptTerminal IndicatorEngine.cpp. Dependencies: none.
import type { OhlcvBar } from './market';

export type IndicatorResult = {
  valid: boolean;
  current: Record<string, number>;
  previous: Record<string, number>;
  series?: Record<string, (number | null)[]>;
  error?: string;
};

export type IndicatorMeta = {
  name: string;
  category: 'Price' | 'Moving Average' | 'Momentum' | 'Trend' | 'Volatility' | 'Volume';
  fields: string[];
  defaultParams: Record<string, number>;
  overlay: boolean;
};

export const INDICATOR_CATALOG: IndicatorMeta[] = [
  { name: 'CLOSE', category: 'Price', fields: ['value'], defaultParams: {}, overlay: true },
  { name: 'OPEN', category: 'Price', fields: ['value'], defaultParams: {}, overlay: true },
  { name: 'HIGH', category: 'Price', fields: ['value'], defaultParams: {}, overlay: true },
  { name: 'LOW', category: 'Price', fields: ['value'], defaultParams: {}, overlay: true },
  { name: 'VOLUME', category: 'Price', fields: ['value'], defaultParams: {}, overlay: false },
  { name: 'VWAP', category: 'Price', fields: ['value'], defaultParams: {}, overlay: true },
  { name: 'SMA', category: 'Moving Average', fields: ['value'], defaultParams: { period: 20 }, overlay: true },
  { name: 'EMA', category: 'Moving Average', fields: ['value'], defaultParams: { period: 20 }, overlay: true },
  { name: 'WMA', category: 'Moving Average', fields: ['value'], defaultParams: { period: 20 }, overlay: true },
  { name: 'DEMA', category: 'Moving Average', fields: ['value'], defaultParams: { period: 20 }, overlay: true },
  { name: 'TEMA', category: 'Moving Average', fields: ['value'], defaultParams: { period: 20 }, overlay: true },
  { name: 'RSI', category: 'Momentum', fields: ['value'], defaultParams: { period: 14 }, overlay: false },
  { name: 'MACD', category: 'Momentum', fields: ['line', 'signal_line', 'histogram'], defaultParams: { fast: 12, slow: 26, signal: 9 }, overlay: false },
  { name: 'STOCHASTIC', category: 'Momentum', fields: ['k', 'd'], defaultParams: { k_period: 14, d_period: 3 }, overlay: false },
  { name: 'CCI', category: 'Momentum', fields: ['value'], defaultParams: { period: 20 }, overlay: false },
  { name: 'WILLIAMS_R', category: 'Momentum', fields: ['value'], defaultParams: { period: 14 }, overlay: false },
  { name: 'MFI', category: 'Momentum', fields: ['value'], defaultParams: { period: 14 }, overlay: false },
  { name: 'ROC', category: 'Momentum', fields: ['value'], defaultParams: { period: 12 }, overlay: false },
  { name: 'ADX', category: 'Trend', fields: ['value', 'plus_di', 'minus_di'], defaultParams: { period: 14 }, overlay: false },
  { name: 'SUPERTREND', category: 'Trend', fields: ['value', 'direction'], defaultParams: { period: 10, multiplier: 3 }, overlay: true },
  { name: 'AROON', category: 'Trend', fields: ['up', 'down'], defaultParams: { period: 14 }, overlay: false },
  { name: 'ICHIMOKU', category: 'Trend', fields: ['tenkan_sen', 'kijun_sen', 'senkou_a', 'senkou_b'], defaultParams: { tenkan: 9, kijun: 26, senkou: 52 }, overlay: true },
  { name: 'ATR', category: 'Volatility', fields: ['value'], defaultParams: { period: 14 }, overlay: false },
  { name: 'BOLLINGER', category: 'Volatility', fields: ['upper', 'middle', 'lower', 'width', 'pct_b'], defaultParams: { period: 20, std_dev: 2 }, overlay: true },
  { name: 'KELTNER', category: 'Volatility', fields: ['upper', 'middle', 'lower'], defaultParams: { period: 20, multiplier: 1.5 }, overlay: true },
  { name: 'DONCHIAN', category: 'Volatility', fields: ['upper', 'lower'], defaultParams: { period: 20 }, overlay: true },
  { name: 'OBV', category: 'Volume', fields: ['value'], defaultParams: {}, overlay: false },
  { name: 'CMF', category: 'Volume', fields: ['value'], defaultParams: { period: 20 }, overlay: false },
  { name: 'VOL_WIN_CHG', category: 'Volume', fields: ['value'], defaultParams: { window: 10 }, overlay: false },
];

const atLeastOne = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return n >= 1 ? n : 1;
};

const finiteDouble = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function firstFinite(src: number[]): number {
  let i = 0;
  while (i < src.length && !Number.isFinite(src[i])) i++;
  return i;
}

export function smaSeries(src: number[], period: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const start = firstFinite(src);
  if (n - start < period) return out;
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += src[i];
  out[start + period - 1] = sum / period;
  for (let i = start + period; i < n; i++) {
    sum += src[i] - src[i - period];
    out[i] = sum / period;
  }
  return out;
}

export function emaSeries(src: number[], period: number): number[] {
  const n = src.length;
  const out = new Array<number>(n).fill(Number.NaN);
  const start = firstFinite(src);
  if (n - start < period) return out;
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += src[i];
  out[start + period - 1] = sum / period;
  const mult = 2 / (period + 1);
  for (let i = start + period; i < n; i++) {
    out[i] = (src[i] - out[i - 1]) * mult + out[i - 1];
  }
  return out;
}

function trueRangeSeries(high: number[], low: number[], close: number[]): number[] {
  const n = high.length;
  const tr = new Array<number>(n).fill(0);
  if (n > 0) tr[0] = high[0] - low[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }
  return tr;
}

const toNullable = (arr: number[]): (number | null)[] =>
  arr.map((v) => (Number.isFinite(v) ? Number(v.toFixed(6)) : null));

const okScalar = (seriesArr: number[]): IndicatorResult => {
  const n = seriesArr.length;
  const curr = seriesArr[n - 1];
  if (!Number.isFinite(curr)) return { valid: false, current: {}, previous: {}, error: 'Insufficient data' };
  const prev = n >= 2 && Number.isFinite(seriesArr[n - 2]) ? seriesArr[n - 2] : curr;
  return {
    valid: true,
    current: { value: curr },
    previous: { value: prev },
    series: { value: toNullable(seriesArr) },
  };
};

const fail = (error: string): IndicatorResult => ({ valid: false, current: {}, previous: {}, error });

export function computeIndicator(
  rawName: string,
  candles: OhlcvBar[],
  params: Record<string, number> = {},
): IndicatorResult {
  if (candles.length < 2) return fail('Insufficient data');
  const name = rawName.trim().toUpperCase();
  const n = candles.length;
  const open = candles.map((c) => c.open);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);
  const vol = candles.map((c) => c.volume);
  const period = atLeastOne(params.period, 14);

  if (name === 'OPEN') return okScalar(open);
  if (name === 'HIGH') return okScalar(high);
  if (name === 'LOW') return okScalar(low);
  if (name === 'CLOSE') return okScalar(close);
  if (name === 'VOLUME') return okScalar(vol);

  if (name === 'VWAP') {
    let num = 0;
    let den = 0;
    const vwap = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const tp = (high[i] + low[i] + close[i]) / 3;
      const v = vol[i] > 0 ? vol[i] : 0;
      num += tp * v;
      den += v;
      vwap[i] = den > 0 ? num / den : close[i];
    }
    return okScalar(vwap);
  }

  if (name === 'SMA') return okScalar(smaSeries(close, period));
  if (name === 'EMA') return okScalar(emaSeries(close, period));

  if (name === 'WMA') {
    if (n < period) return fail('Insufficient data for WMA');
    const denom = (period * (period + 1)) / 2;
    const out = new Array<number>(n).fill(Number.NaN);
    for (let end = period - 1; end < n; end++) {
      let sum = 0;
      for (let i = 0; i < period; i++) sum += close[end - period + 1 + i] * (i + 1);
      out[end] = sum / denom;
    }
    return okScalar(out);
  }

  if (name === 'DEMA') {
    const e1 = emaSeries(close, period);
    const e2 = emaSeries(e1, period);
    const out = e2.map((v, i) => (Number.isFinite(v) ? 2 * e1[i] - v : Number.NaN));
    return okScalar(out);
  }

  if (name === 'TEMA') {
    const e1 = emaSeries(close, period);
    const e2 = emaSeries(e1, period);
    const e3 = emaSeries(e2, period);
    const out = e3.map((v, i) => (Number.isFinite(v) ? 3 * e1[i] - 3 * e2[i] + v : Number.NaN));
    return okScalar(out);
  }

  if (name === 'RSI') {
    if (n < period + 1) return fail('Insufficient data for RSI');
    const gains = new Array<number>(n).fill(0);
    const losses = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      const diff = close[i] - close[i - 1];
      if (diff > 0) gains[i] = diff;
      else losses[i] = -diff;
    }
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;
    const out = new Array<number>(n).fill(Number.NaN);
    const calcRsi = (ag: number, al: number) => (al < 1e-10 ? 100 : 100 - 100 / (1 + ag / al));
    out[period] = calcRsi(avgGain, avgLoss);
    for (let i = period + 1; i < n; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      out[i] = calcRsi(avgGain, avgLoss);
    }
    return okScalar(out);
  }

  if (name === 'MACD') {
    const fast = atLeastOne(params.fast, 12);
    const slow = atLeastOne(params.slow, 26);
    const sig = atLeastOne(params.signal, 9);
    const ef = emaSeries(close, fast);
    const es = emaSeries(close, slow);
    const line = close.map((_, i) => (Number.isFinite(ef[i]) && Number.isFinite(es[i]) ? ef[i] - es[i] : Number.NaN));
    const signalLine = emaSeries(line, sig);
    const histogram = line.map((v, i) => (Number.isFinite(v) && Number.isFinite(signalLine[i]) ? v - signalLine[i] : Number.NaN));
    if (!Number.isFinite(line[n - 1]) || !Number.isFinite(signalLine[n - 1])) return fail('Insufficient data for MACD');
    return {
      valid: true,
      current: { line: line[n - 1], signal_line: signalLine[n - 1], histogram: histogram[n - 1] },
      previous: {
        line: Number.isFinite(line[n - 2]) ? line[n - 2] : line[n - 1],
        signal_line: Number.isFinite(signalLine[n - 2]) ? signalLine[n - 2] : signalLine[n - 1],
        histogram: Number.isFinite(histogram[n - 2]) ? histogram[n - 2] : histogram[n - 1],
      },
      series: { line: toNullable(line), signal_line: toNullable(signalLine), histogram: toNullable(histogram) },
    };
  }

  if (name === 'STOCHASTIC') {
    const kPeriod = atLeastOne(params.k_period, 14);
    const dPeriod = atLeastOne(params.d_period, 3);
    if (n < kPeriod) return fail('Insufficient data for Stochastic');
    const kVals = new Array<number>(n).fill(Number.NaN);
    for (let i = kPeriod - 1; i < n; i++) {
      let hh = high[i];
      let ll = low[i];
      for (let j = 1; j < kPeriod; j++) {
        hh = Math.max(hh, high[i - j]);
        ll = Math.min(ll, low[i - j]);
      }
      const range = hh - ll;
      kVals[i] = range > 1e-10 ? ((close[i] - ll) / range) * 100 : 50;
    }
    const dVals = smaSeries(kVals, dPeriod);
    return {
      valid: true,
      current: { k: kVals[n - 1], d: Number.isFinite(dVals[n - 1]) ? dVals[n - 1] : kVals[n - 1] },
      previous: {
        k: Number.isFinite(kVals[n - 2]) ? kVals[n - 2] : kVals[n - 1],
        d: Number.isFinite(dVals[n - 2]) ? dVals[n - 2] : kVals[n - 1],
      },
      series: { k: toNullable(kVals), d: toNullable(dVals) },
    };
  }

  if (name === 'CCI') {
    if (n < period) return fail('Insufficient data for CCI');
    const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
    const sma = smaSeries(tp, period);
    const out = new Array<number>(n).fill(Number.NaN);
    for (let i = period - 1; i < n; i++) {
      let meanDev = 0;
      for (let j = 0; j < period; j++) meanDev += Math.abs(tp[i - j] - sma[i]);
      meanDev /= period;
      out[i] = meanDev > 1e-10 ? (tp[i] - sma[i]) / (0.015 * meanDev) : 0;
    }
    return okScalar(out);
  }

  if (name === 'WILLIAMS_R') {
    if (n < period) return fail('Insufficient data for Williams %R');
    const out = new Array<number>(n).fill(Number.NaN);
    for (let i = period - 1; i < n; i++) {
      let hh = high[i];
      let ll = low[i];
      for (let j = 1; j < period; j++) {
        hh = Math.max(hh, high[i - j]);
        ll = Math.min(ll, low[i - j]);
      }
      const range = hh - ll;
      out[i] = range > 1e-10 ? ((hh - close[i]) / range) * -100 : -50;
    }
    return okScalar(out);
  }

  if (name === 'MFI') {
    if (n < period + 1) return fail('Insufficient data for MFI');
    const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
    const out = new Array<number>(n).fill(Number.NaN);
    for (let end = period; end < n; end++) {
      let pos = 0;
      let neg = 0;
      for (let i = end - period + 1; i <= end; i++) {
        const mf = tp[i] * vol[i];
        if (tp[i] > tp[i - 1]) pos += mf;
        else if (tp[i] < tp[i - 1]) neg += mf;
      }
      out[end] = neg > 1e-10 ? 100 - 100 / (1 + pos / neg) : 100;
    }
    return okScalar(out);
  }

  if (name === 'ROC') {
    if (n <= period) return fail('Insufficient data for ROC');
    const out = new Array<number>(n).fill(Number.NaN);
    for (let i = period; i < n; i++) {
      const base = close[i - period];
      if (!Number.isFinite(base) || Math.abs(base) < 1e-10) return fail('ROC: zero/invalid reference price');
      out[i] = ((close[i] - base) / base) * 100;
    }
    return okScalar(out);
  }

  if (name === 'ADX') {
    if (n < period * 2 + 1) return fail('Insufficient data for ADX');
    const tr = trueRangeSeries(high, low, close);
    const plusDm = new Array<number>(n).fill(0);
    const minusDm = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      const up = high[i] - high[i - 1];
      const down = low[i - 1] - low[i];
      if (up > down && up > 0) plusDm[i] = up;
      if (down > up && down > 0) minusDm[i] = down;
    }
    let atrSmooth = 0;
    let plusSmooth = 0;
    let minusSmooth = 0;
    for (let i = 1; i <= period; i++) {
      atrSmooth += tr[i];
      plusSmooth += plusDm[i];
      minusSmooth += minusDm[i];
    }
    const dxVals: number[] = [];
    const pdiSeries = new Array<number>(n).fill(Number.NaN);
    const mdiSeries = new Array<number>(n).fill(Number.NaN);
    const adxSeries = new Array<number>(n).fill(Number.NaN);
    const calcDx = () => {
      const pdi = atrSmooth > 1e-10 ? (plusSmooth / atrSmooth) * 100 : 0;
      const mdi = atrSmooth > 1e-10 ? (minusSmooth / atrSmooth) * 100 : 0;
      const sum = pdi + mdi;
      return { pdi, mdi, dx: sum > 1e-10 ? (Math.abs(pdi - mdi) / sum) * 100 : 0 };
    };
    const first = calcDx();
    dxVals.push(first.dx);
    pdiSeries[period] = first.pdi;
    mdiSeries[period] = first.mdi;

    for (let i = period + 1; i < n; i++) {
      atrSmooth = atrSmooth - atrSmooth / period + tr[i];
      plusSmooth = plusSmooth - plusSmooth / period + plusDm[i];
      minusSmooth = minusSmooth - minusSmooth / period + minusDm[i];
      const cur = calcDx();
      dxVals.push(cur.dx);
      pdiSeries[i] = cur.pdi;
      mdiSeries[i] = cur.mdi;
    }
    if (dxVals.length < period) return fail('Insufficient data for ADX');
    let adx = 0;
    for (let i = 0; i < period; i++) adx += dxVals[i];
    adx /= period;
    adxSeries[period * 2 - 1] = adx;
    for (let i = period; i < dxVals.length; i++) {
      adx = (adx * (period - 1) + dxVals[i]) / period;
      adxSeries[period + i] = adx;
    }
    return {
      valid: true,
      current: { value: adxSeries[n - 1], plus_di: pdiSeries[n - 1], minus_di: mdiSeries[n - 1] },
      previous: {
        value: Number.isFinite(adxSeries[n - 2]) ? adxSeries[n - 2] : adxSeries[n - 1],
        plus_di: Number.isFinite(pdiSeries[n - 2]) ? pdiSeries[n - 2] : pdiSeries[n - 1],
        minus_di: Number.isFinite(mdiSeries[n - 2]) ? mdiSeries[n - 2] : mdiSeries[n - 1],
      },
      series: { value: toNullable(adxSeries), plus_di: toNullable(pdiSeries), minus_di: toNullable(mdiSeries) },
    };
  }

  if (name === 'SUPERTREND') {
    const mult = finiteDouble(params.multiplier, 3);
    const atrEma = emaSeries(trueRangeSeries(high, low, close), period);
    if (n < period + 1 || !Number.isFinite(atrEma[n - 1])) return fail('Insufficient data for SuperTrend');
    const upper = new Array<number>(n).fill(Number.NaN);
    const lower = new Array<number>(n).fill(Number.NaN);
    const st = new Array<number>(n).fill(Number.NaN);
    const dir = new Array<number>(n).fill(1);
    const start = period - 1;
    for (let i = start; i < n; i++) {
      if (!Number.isFinite(atrEma[i])) continue;
      const hl2 = (high[i] + low[i]) / 2;
      upper[i] = hl2 + mult * atrEma[i];
      lower[i] = hl2 - mult * atrEma[i];
    }
    for (let i = start + 1; i < n; i++) {
      if (close[i - 1] > upper[i - 1]) lower[i] = Math.max(lower[i], lower[i - 1]);
      if (close[i - 1] < lower[i - 1]) upper[i] = Math.min(upper[i], upper[i - 1]);
      if (close[i] > upper[i]) dir[i] = 1;
      else if (close[i] < lower[i]) dir[i] = -1;
      else dir[i] = dir[i - 1];
      st[i] = dir[i] === 1 ? lower[i] : upper[i];
    }
    return {
      valid: true,
      current: { value: st[n - 1], direction: dir[n - 1] },
      previous: { value: st[n - 2], direction: dir[n - 2] },
      series: { value: toNullable(st), direction: toNullable(dir) },
    };
  }

  if (name === 'AROON') {
    if (n < period + 1) return fail('Insufficient data for Aroon');
    const up = new Array<number>(n).fill(Number.NaN);
    const down = new Array<number>(n).fill(Number.NaN);
    for (let end = period; end < n; end++) {
      let hiIdx = 0;
      let loIdx = 0;
      let hh = high[end];
      let ll = low[end];
      for (let j = 1; j <= period; j++) {
        if (high[end - j] > hh) {
          hh = high[end - j];
          hiIdx = j;
        }
        if (low[end - j] < ll) {
          ll = low[end - j];
          loIdx = j;
        }
      }
      up[end] = ((period - hiIdx) / period) * 100;
      down[end] = ((period - loIdx) / period) * 100;
    }
    return {
      valid: true,
      current: { up: up[n - 1], down: down[n - 1] },
      previous: { up: Number.isFinite(up[n - 2]) ? up[n - 2] : up[n - 1], down: Number.isFinite(down[n - 2]) ? down[n - 2] : down[n - 1] },
      series: { up: toNullable(up), down: toNullable(down) },
    };
  }

  if (name === 'ICHIMOKU') {
    const tenkan = atLeastOne(params.tenkan, 9);
    const kijun = atLeastOne(params.kijun, 26);
    const senkou = atLeastOne(params.senkou, 52);
    if (n < senkou) return fail('Insufficient data for Ichimoku');
    const midpoint = (end: number, p: number) => {
      let hh = high[end];
      let ll = low[end];
      for (let j = 1; j < p; j++) {
        hh = Math.max(hh, high[end - j]);
        ll = Math.min(ll, low[end - j]);
      }
      return (hh + ll) / 2;
    };
    const tsArr = new Array<number>(n).fill(Number.NaN);
    const ksArr = new Array<number>(n).fill(Number.NaN);
    const saArr = new Array<number>(n).fill(Number.NaN);
    const sbArr = new Array<number>(n).fill(Number.NaN);
    for (let i = senkou - 1; i < n; i++) {
      tsArr[i] = midpoint(i, tenkan);
      ksArr[i] = midpoint(i, kijun);
      saArr[i] = (tsArr[i] + ksArr[i]) / 2;
      sbArr[i] = midpoint(i, senkou);
    }
    return {
      valid: true,
      current: { tenkan_sen: tsArr[n - 1], kijun_sen: ksArr[n - 1], senkou_a: saArr[n - 1], senkou_b: sbArr[n - 1] },
      previous: {
        tenkan_sen: Number.isFinite(tsArr[n - 2]) ? tsArr[n - 2] : tsArr[n - 1],
        kijun_sen: Number.isFinite(ksArr[n - 2]) ? ksArr[n - 2] : ksArr[n - 1],
        senkou_a: Number.isFinite(saArr[n - 2]) ? saArr[n - 2] : saArr[n - 1],
        senkou_b: Number.isFinite(sbArr[n - 2]) ? sbArr[n - 2] : sbArr[n - 1],
      },
      series: { tenkan_sen: toNullable(tsArr), kijun_sen: toNullable(ksArr), senkou_a: toNullable(saArr), senkou_b: toNullable(sbArr) },
    };
  }

  if (name === 'ATR') {
    const tr = trueRangeSeries(high, low, close);
    if (n < period + 1) return fail('Insufficient data for ATR');
    let atr = 0;
    for (let i = 0; i < period; i++) atr += tr[i + 1];
    atr /= period;
    const out = new Array<number>(n).fill(Number.NaN);
    out[period] = atr;
    for (let i = period + 1; i < n; i++) {
      atr = (atr * (period - 1) + tr[i]) / period;
      out[i] = atr;
    }
    return okScalar(out);
  }

  if (name === 'BOLLINGER') {
    const sdMult = finiteDouble(params.std_dev, 2);
    if (n < period) return fail('Insufficient data for Bollinger');
    const sma = smaSeries(close, period);
    const upper = new Array<number>(n).fill(Number.NaN);
    const middle = new Array<number>(n).fill(Number.NaN);
    const lower = new Array<number>(n).fill(Number.NaN);
    const width = new Array<number>(n).fill(Number.NaN);
    const pctB = new Array<number>(n).fill(Number.NaN);
    for (let i = period - 1; i < n; i++) {
      const mid = sma[i];
      let sumSq = 0;
      for (let j = 0; j < period; j++) {
        const diff = close[i - j] - mid;
        sumSq += diff * diff;
      }
      const sd = Math.sqrt(sumSq / period);
      const u = mid + sdMult * sd;
      const l = mid - sdMult * sd;
      upper[i] = u;
      middle[i] = mid;
      lower[i] = l;
      width[i] = mid > 1e-10 ? (u - l) / mid : 0;
      pctB[i] = u - l > 1e-10 ? (close[i] - l) / (u - l) : 0.5;
    }
    return {
      valid: true,
      current: { upper: upper[n - 1], middle: middle[n - 1], lower: lower[n - 1], width: width[n - 1], pct_b: pctB[n - 1] },
      previous: {
        upper: Number.isFinite(upper[n - 2]) ? upper[n - 2] : upper[n - 1],
        middle: Number.isFinite(middle[n - 2]) ? middle[n - 2] : middle[n - 1],
        lower: Number.isFinite(lower[n - 2]) ? lower[n - 2] : lower[n - 1],
        width: Number.isFinite(width[n - 2]) ? width[n - 2] : width[n - 1],
        pct_b: Number.isFinite(pctB[n - 2]) ? pctB[n - 2] : pctB[n - 1],
      },
      series: { upper: toNullable(upper), middle: toNullable(middle), lower: toNullable(lower), width: toNullable(width), pct_b: toNullable(pctB) },
    };
  }

  if (name === 'KELTNER') {
    const mult = finiteDouble(params.multiplier, 1.5);
    const ema = emaSeries(close, period);
    const atr = emaSeries(trueRangeSeries(high, low, close), period);
    if (!Number.isFinite(ema[n - 1]) || !Number.isFinite(atr[n - 1])) return fail('Insufficient data for Keltner');
    const upper = ema.map((m, i) => (Number.isFinite(m) && Number.isFinite(atr[i]) ? m + mult * atr[i] : Number.NaN));
    const lower = ema.map((m, i) => (Number.isFinite(m) && Number.isFinite(atr[i]) ? m - mult * atr[i] : Number.NaN));
    return {
      valid: true,
      current: { upper: upper[n - 1], middle: ema[n - 1], lower: lower[n - 1] },
      previous: {
        upper: Number.isFinite(upper[n - 2]) ? upper[n - 2] : upper[n - 1],
        middle: Number.isFinite(ema[n - 2]) ? ema[n - 2] : ema[n - 1],
        lower: Number.isFinite(lower[n - 2]) ? lower[n - 2] : lower[n - 1],
      },
      series: { upper: toNullable(upper), middle: toNullable(ema), lower: toNullable(lower) },
    };
  }

  if (name === 'DONCHIAN') {
    if (n < period) return fail('Insufficient data for Donchian');
    const upper = new Array<number>(n).fill(Number.NaN);
    const lower = new Array<number>(n).fill(Number.NaN);
    for (let end = period - 1; end < n; end++) {
      let hh = high[end];
      let ll = low[end];
      for (let j = 1; j < period; j++) {
        hh = Math.max(hh, high[end - j]);
        ll = Math.min(ll, low[end - j]);
      }
      upper[end] = hh;
      lower[end] = ll;
    }
    return {
      valid: true,
      current: { upper: upper[n - 1], lower: lower[n - 1] },
      previous: {
        upper: Number.isFinite(upper[n - 2]) ? upper[n - 2] : upper[n - 1],
        lower: Number.isFinite(lower[n - 2]) ? lower[n - 2] : lower[n - 1],
      },
      series: { upper: toNullable(upper), lower: toNullable(lower) },
    };
  }

  if (name === 'OBV') {
    const out = new Array<number>(n).fill(0);
    for (let i = 1; i < n; i++) {
      out[i] = out[i - 1] + (close[i] > close[i - 1] ? vol[i] : close[i] < close[i - 1] ? -vol[i] : 0);
    }
    return okScalar(out);
  }

  if (name === 'CMF') {
    if (n < period) return fail('Insufficient data for CMF');
    const out = new Array<number>(n).fill(Number.NaN);
    for (let end = period - 1; end < n; end++) {
      let mfvSum = 0;
      let volSum = 0;
      for (let j = 0; j < period; j++) {
        const idx = end - j;
        const hl = high[idx] - low[idx];
        const mfMult = hl > 1e-10 ? ((close[idx] - low[idx]) - (high[idx] - close[idx])) / hl : 0;
        mfvSum += mfMult * vol[idx];
        volSum += vol[idx];
      }
      out[end] = volSum > 1e-10 ? mfvSum / volSum : 0;
    }
    return okScalar(out);
  }

  if (name === 'VOL_WIN_CHG') {
    const window = atLeastOne(params.window, 10);
    if (n < 2 * window) return fail(`Insufficient data for VOL_WIN_CHG (need ${2 * window} bars)`);
    const out = new Array<number>(n).fill(Number.NaN);
    for (let lastIndex = 2 * window - 1; lastIndex < n; lastIndex++) {
      let sumLast = 0;
      let sumPrev = 0;
      for (let i = lastIndex - window + 1; i <= lastIndex; i++) sumLast += vol[i];
      for (let i = lastIndex - 2 * window + 1; i <= lastIndex - window; i++) sumPrev += vol[i];
      if (sumPrev > 0) out[lastIndex] = (sumLast / sumPrev - 1) * 100;
    }
    return okScalar(out);
  }

  return fail(`Unknown indicator: ${rawName}`);
}

export type TechnicalSnapshot = {
  bars: number;
  lastClose: number;
  changePct: number;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  ema20: number | null;
  ema50: number | null;
  bollingerPctB: number | null;
  supertrendDirection: number | null;
  adx14: number | null;
  atr14: number | null;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  signals: string[];
};

export function computeTechnicalSnapshot(candles: OhlcvBar[]): TechnicalSnapshot {
  const n = candles.length;
  const lastClose = n > 0 ? candles[n - 1].close : 0;
  const firstClose = n > 0 ? candles[0].close : 0;
  const changePct = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  const rsiRes = computeIndicator('RSI', candles, { period: 14 });
  const macdRes = computeIndicator('MACD', candles, { fast: 12, slow: 26, signal: 9 });
  const ema20Res = computeIndicator('EMA', candles, { period: 20 });
  const ema50Res = computeIndicator('EMA', candles, { period: 50 });
  const bbRes = computeIndicator('BOLLINGER', candles, { period: 20, std_dev: 2 });
  const stRes = computeIndicator('SUPERTREND', candles, { period: 10, multiplier: 3 });
  const adxRes = computeIndicator('ADX', candles, { period: 14 });
  const atrRes = computeIndicator('ATR', candles, { period: 14 });

  const rsi14 = rsiRes.valid ? rsiRes.current.value : null;
  const macd = macdRes.valid ? { line: macdRes.current.line, signal: macdRes.current.signal_line, histogram: macdRes.current.histogram } : null;
  const ema20 = ema20Res.valid ? ema20Res.current.value : null;
  const ema50 = ema50Res.valid ? ema50Res.current.value : null;
  const bollingerPctB = bbRes.valid ? bbRes.current.pct_b : null;
  const supertrendDirection = stRes.valid ? stRes.current.direction : null;
  const adx14 = adxRes.valid ? adxRes.current.value : null;
  const atr14 = atrRes.valid ? atrRes.current.value : null;

  let score = 0;
  const signals: string[] = [];

  if (rsi14 !== null) {
    if (rsi14 < 30) {
      score += 1;
      signals.push(`RSI(14)=${rsi14.toFixed(1)} oversold`);
    } else if (rsi14 > 70) {
      score -= 1;
      signals.push(`RSI(14)=${rsi14.toFixed(1)} overbought`);
    }
  }
  if (macd !== null) {
    if (macd.histogram > 0) {
      score += 1;
      signals.push('MACD histogram positive');
    } else if (macd.histogram < 0) {
      score -= 1;
      signals.push('MACD histogram negative');
    }
  }
  if (ema20 !== null && ema50 !== null) {
    if (ema20 > ema50) {
      score += 1;
      signals.push('EMA20 > EMA50 uptrend');
    } else {
      score -= 1;
      signals.push('EMA20 < EMA50 downtrend');
    }
  }
  if (supertrendDirection !== null) {
    if (supertrendDirection > 0) {
      score += 1;
      signals.push('SuperTrend bullish');
    } else {
      score -= 1;
      signals.push('SuperTrend bearish');
    }
  }

  const bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = score >= 2 ? 'BULLISH' : score <= -2 ? 'BEARISH' : 'NEUTRAL';

  return {
    bars: n,
    lastClose,
    changePct,
    rsi14,
    macd,
    ema20,
    ema50,
    bollingerPctB,
    supertrendDirection,
    adx14,
    atr14,
    bias,
    signals,
  };
}
