// conditions.ts — nested AND/OR/crossing rule evaluator ported from FinceptTerminal ConditionEvaluator.cpp. Dependencies: indicators, market.
import type { OhlcvBar } from './market';
import { computeIndicator } from './indicators';

export type ConditionOperator = '>' | '<' | '>=' | '<=' | '==' | 'crosses_above' | 'crosses_below' | 'rising' | 'falling' | 'between';

export type ConditionNode = {
  type?: 'condition';
  indicator: string;
  params?: Record<string, number>;
  field?: string;
  operator: ConditionOperator;
  value?: number;
  value2?: number;
  compare_mode?: 'value' | 'indicator';
  compare_indicator?: string;
  compare_params?: Record<string, number>;
  compare_field?: string;
  offset?: number;
  compare_offset?: number;
};

export type ConditionGroupNode = {
  type: 'group';
  logic?: 'AND' | 'OR';
  negate?: boolean;
  children: (ConditionNode | ConditionGroupNode)[];
};

export type ConditionDetail = {
  indicator: string;
  field: string;
  operator: string;
  computedValue: number | null;
  targetValue: number | null;
  met: boolean;
  error?: string;
};

export type GroupEvalResult = {
  triggered: boolean;
  logic: 'AND' | 'OR';
  details: ConditionDetail[];
};

const needsPrev = (op: ConditionOperator) =>
  op === 'crosses_above' || op === 'crosses_below' || op === 'rising' || op === 'falling' || op === '==';

function operandValue(
  indicator: string,
  params: Record<string, number> | undefined,
  field: string,
  offset: number,
  candles: OhlcvBar[],
): { value: number; error?: string } {
  const safeOffset = Math.max(0, offset);
  let window = candles;
  if (safeOffset > 0) {
    if (safeOffset >= candles.length) {
      return { value: Number.NaN, error: `Insufficient data for offset ${safeOffset}` };
    }
    window = candles.slice(0, candles.length - safeOffset);
  }
  const res = computeIndicator(indicator, window, params ?? {});
  if (!res.valid) return { value: Number.NaN, error: res.error };
  const v = res.current[field];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { value: Number.NaN, error: `${indicator}.${field} produced non-finite value` };
  }
  return { value: v };
}

export function evaluateCondition(cond: ConditionNode, candles: OhlcvBar[]): ConditionDetail {
  const field = cond.field ?? 'value';
  const op = cond.operator ?? '>';
  const detail: ConditionDetail = {
    indicator: cond.indicator,
    field,
    operator: op,
    computedValue: null,
    targetValue: null,
    met: false,
  };

  const lhsCurr = operandValue(cond.indicator, cond.params, field, cond.offset ?? 0, candles);
  if (lhsCurr.error) {
    detail.error = lhsCurr.error;
    return detail;
  }
  detail.computedValue = lhsCurr.value;

  const prevNeeded = needsPrev(op);
  const lhsPrev = prevNeeded
    ? operandValue(cond.indicator, cond.params, field, (cond.offset ?? 0) + 1, candles).value
    : Number.NaN;

  let rhsCurr: number;
  let rhsPrev: number;

  if (cond.compare_mode === 'indicator' && cond.compare_indicator) {
    const compareField = cond.compare_field ?? 'value';
    const r = operandValue(cond.compare_indicator, cond.compare_params, compareField, cond.compare_offset ?? 0, candles);
    if (r.error) {
      detail.error = r.error;
      return detail;
    }
    rhsCurr = r.value;
    rhsPrev = prevNeeded
      ? operandValue(cond.compare_indicator, cond.compare_params, compareField, (cond.compare_offset ?? 0) + 1, candles).value
      : Number.NaN;
  } else {
    rhsCurr = cond.value ?? 0;
    rhsPrev = cond.value ?? 0;
  }
  detail.targetValue = rhsCurr;

  if (op === 'crosses_above') {
    detail.met = [lhsCurr.value, lhsPrev, rhsCurr, rhsPrev].every(Number.isFinite) && lhsPrev <= rhsPrev && lhsCurr.value > rhsCurr;
  } else if (op === 'crosses_below') {
    detail.met = [lhsCurr.value, lhsPrev, rhsCurr, rhsPrev].every(Number.isFinite) && lhsPrev >= rhsPrev && lhsCurr.value < rhsCurr;
  } else if (op === 'rising') {
    detail.met = Number.isFinite(lhsCurr.value) && Number.isFinite(lhsPrev) && lhsCurr.value > lhsPrev;
  } else if (op === 'falling') {
    detail.met = Number.isFinite(lhsCurr.value) && Number.isFinite(lhsPrev) && lhsCurr.value < lhsPrev;
  } else if (op === 'between') {
    const lo = cond.value ?? 0;
    const hi = cond.value2 ?? 0;
    detail.met = Number.isFinite(lhsCurr.value) && lhsCurr.value >= lo && lhsCurr.value <= hi;
    detail.targetValue = hi;
  } else if (op === '==') {
    const tol = Math.max(1e-9, Math.abs(rhsCurr) * 1e-7);
    const currDiff = lhsCurr.value - rhsCurr;
    const prevDiff = lhsPrev - rhsPrev;
    if (!Number.isFinite(lhsCurr.value) || !Number.isFinite(rhsCurr)) detail.met = false;
    else if (Math.abs(currDiff) <= tol) detail.met = true;
    else if (Number.isFinite(prevDiff) && (prevDiff < 0) !== (currDiff < 0)) detail.met = true;
    else detail.met = false;
  } else if (Number.isFinite(lhsCurr.value) && Number.isFinite(rhsCurr)) {
    if (op === '>') detail.met = lhsCurr.value > rhsCurr;
    else if (op === '<') detail.met = lhsCurr.value < rhsCurr;
    else if (op === '>=') detail.met = lhsCurr.value >= rhsCurr;
    else if (op === '<=') detail.met = lhsCurr.value <= rhsCurr;
  }

  return detail;
}

function isGroupNode(node: ConditionNode | ConditionGroupNode): node is ConditionGroupNode {
  return node.type === 'group' || 'children' in node;
}

export function evaluateGroup(
  children: (ConditionNode | ConditionGroupNode)[],
  logic: 'AND' | 'OR' = 'AND',
  candles: OhlcvBar[],
): GroupEvalResult {
  const result: GroupEvalResult = { triggered: false, logic, details: [] };
  if (!children || children.length === 0) return result;

  const isAnd = logic !== 'OR';
  let overall = isAnd;

  for (const node of children) {
    let met: boolean;
    if (isGroupNode(node)) {
      const sub = evaluateGroup(node.children, node.logic ?? 'AND', candles);
      met = node.negate ? !sub.triggered : sub.triggered;
      result.details.push(...sub.details);
    } else {
      const r = evaluateCondition(node, candles);
      result.details.push(r);
      met = r.met;
    }

    if (isAnd) {
      overall = overall && met;
      if (!overall) break;
    } else {
      overall = overall || met;
      if (overall) break;
    }
  }

  result.triggered = overall;
  return result;
}
