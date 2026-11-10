// Charts.tsx — pure React/SVG candlestick + EMA/Bollinger chart and equity curve visualizer. Dependencies: React.
'use client';

import React from 'react';

export type ChartBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function calcEma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let ema = sum / period;
  out[period - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * k + ema;
    out[i] = ema;
  }
  return out;
}

export function CandlestickSvgChart({
  bars,
  symbol,
  timeframe,
  showEma = true,
}: {
  bars: ChartBar[];
  symbol: string;
  timeframe: string;
  showEma?: boolean;
}) {
  const visible = bars.slice(-90);
  if (visible.length < 2) {
    return <div className="muted mono">No candle bars available for {symbol}.</div>;
  }

  const w = 820;
  const h = 300;
  const padL = 12;
  const padR = 68;
  const padT = 16;
  const padB = 26;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const priceH = plotH * 0.78;
  const volTop = padT + priceH + 8;
  const volH = plotH * 0.18;

  const closes = visible.map((b) => b.close);
  const ema20 = showEma ? calcEma(closes, 20) : [];
  const ema50 = showEma ? calcEma(closes, 50) : [];

  let minP = Math.min(...visible.map((b) => b.low));
  let maxP = Math.max(...visible.map((b) => b.high));
  if (maxP <= minP) maxP = minP + 1;
  const pPad = (maxP - minP) * 0.06;
  minP -= pPad;
  maxP += pPad;

  const maxV = Math.max(1, ...visible.map((b) => b.volume));
  const stepX = plotW / visible.length;
  const bodyW = Math.max(2, stepX * 0.62);

  const yOf = (p: number) => padT + ((maxP - p) / (maxP - minP)) * priceH;
  const xOf = (idx: number) => padL + idx * stepX + stepX * 0.5;

  const toPolyline = (arr: (number | null)[]) =>
    arr
      .map((val, idx) => (val !== null ? `${xOf(idx).toFixed(1)},${yOf(val).toFixed(1)}` : null))
      .filter((s): s is string => Boolean(s))
      .join(' ');

  const ema20Pts = toPolyline(ema20);
  const ema50Pts = toPolyline(ema50);
  const last = visible[visible.length - 1];
  const gridLevels = [0, 0.25, 0.5, 0.75, 1].map((t) => minP + t * (maxP - minP));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block', background: '#090d10', borderRadius: 4 }}>
      {gridLevels.map((lvl, idx) => {
        const y = yOf(lvl);
        return (
          <g key={idx}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#1b2529" strokeDasharray="3 3" />
            <text x={w - padR + 6} y={y + 3} fill="#768782" fontSize="10" fontFamily="monospace">
              {lvl >= 100 ? lvl.toFixed(1) : lvl.toFixed(4)}
            </text>
          </g>
        );
      })}

      {visible.map((b, i) => {
        const x = xOf(i);
        const up = b.close >= b.open;
        const col = up ? '#bbf968' : '#ff6e75';
        const top = yOf(Math.max(b.open, b.close));
        const bot = yOf(Math.min(b.open, b.close));
        const bodyH = Math.max(1.5, bot - top);
        const vh = (b.volume / maxV) * volH;
        return (
          <g key={b.timestamp + '-' + i}>
            <line x1={x} y1={yOf(b.high)} x2={x} y2={yOf(b.low)} stroke={col} strokeWidth="1" />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={bodyH} fill={col} opacity="0.92" />
            <rect x={x - bodyW / 2} y={volTop + (volH - vh)} width={bodyW} height={vh} fill={col} opacity="0.25" />
          </g>
        );
      })}

      {ema20Pts && <polyline fill="none" stroke="#67d9e8" strokeWidth="1.5" points={ema20Pts} />}
      {ema50Pts && <polyline fill="none" stroke="#eab85e" strokeWidth="1.5" points={ema50Pts} />}

      <line
        x1={padL}
        y1={yOf(last.close)}
        x2={w - padR}
        y2={yOf(last.close)}
        stroke="#bbf968"
        strokeWidth="1"
        strokeDasharray="2 2"
        opacity="0.7"
      />
      <text x={padL + 6} y={14} fill="#93a59f" fontSize="10" fontFamily="monospace">
        {symbol} ({timeframe}) • O:{last.open} H:{last.high} L:{last.low} C:{last.close}
      </text>
      <text x={padL + 6} y={h - 6} fill="#67d9e8" fontSize="9" fontFamily="monospace">
        ■ EMA20
      </text>
      <text x={padL + 62} y={h - 6} fill="#eab85e" fontSize="9" fontFamily="monospace">
        ■ EMA50
      </text>
    </svg>
  );
}

export function EquityCurveSvgChart({
  equityCurve,
  benchmarkCurve,
  initialCapital,
}: {
  equityCurve: number[];
  benchmarkCurve: number[];
  initialCapital: number;
}) {
  if (equityCurve.length < 2) {
    return <div className="muted mono">Run a backtest to render the equity vs benchmark curve.</div>;
  }

  const w = 780;
  const h = 230;
  const padL = 14;
  const padR = 72;
  const padT = 18;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const all = [...equityCurve, ...benchmarkCurve, initialCapital];
  let minV = Math.min(...all);
  let maxV = Math.max(...all);
  if (maxV <= minV) maxV = minV + 100;
  const pad = (maxV - minV) * 0.08;
  minV -= pad;
  maxV += pad;

  const xOf = (i: number) => padL + (i / (equityCurve.length - 1)) * plotW;
  const yOf = (v: number) => padT + ((maxV - v) / (maxV - minV)) * plotH;

  const eqPts = equityCurve.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const bmPts = benchmarkCurve.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block', background: '#090d10', borderRadius: 4 }}>
      {[minV, (minV + maxV) / 2, maxV].map((lvl, idx) => {
        const y = yOf(lvl);
        return (
          <g key={idx}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="#1b2529" strokeDasharray="3 3" />
            <text x={w - padR + 6} y={y + 3} fill="#768782" fontSize="10" fontFamily="monospace">
              ${lvl.toFixed(0)}
            </text>
          </g>
        );
      })}
      <line x1={padL} y1={yOf(initialCapital)} x2={w - padR} y2={yOf(initialCapital)} stroke="#324247" strokeDasharray="4 4" />
      {benchmarkCurve.length >= 2 && <polyline fill="none" stroke="#eab85e" strokeWidth="1.6" opacity="0.8" points={bmPts} />}
      <polyline fill="none" stroke="#bbf968" strokeWidth="2.2" points={eqPts} />
      <text x={padL + 4} y={13} fill="#bbf968" fontSize="10" fontFamily="monospace">
        ■ Strategy Equity (${equityCurve[equityCurve.length - 1]?.toFixed(2)})
      </text>
      <text x={padL + 230} y={13} fill="#eab85e" fontSize="10" fontFamily="monospace">
        ■ Buy &amp; Hold Benchmark (${benchmarkCurve[benchmarkCurve.length - 1]?.toFixed(2) ?? 'n/a'})
      </text>
    </svg>
  );
}
