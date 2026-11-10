// risk.ts — pre-trade structural validator & fail-closed risk core ported from FinceptTerminal OrderValidator.cpp. Dependencies: schema, drizzle-orm.
import type { AppDatabase } from './bootstrap';
import { riskSettings, safetyState } from './schema';
import { eq } from 'drizzle-orm';

export const VALID_EXCHANGES = new Set([
  'CRYPTO',
  'FOREX',
  'FX',
  'MT4',
  'MT5',
  'NYSE',
  'NASDAQ',
  'AMEX',
  'ARCA',
  'BATS',
  'CBOE',
  'LSE',
  'TSX',
  'XETRA',
  'EURONEXT',
  'NSE',
  'BSE',
  'NFO',
  'BFO',
  'MCX',
]);

export const DERIVATIVE_EXCHANGES = new Set(['NFO', 'BFO', 'MCX', 'CDS', 'BCD', 'NCDEX']);
export const SANITY_MAX_QUANTITY = 1_000_000;
export const SANITY_BUYING_POWER_MULTIPLE = 20;

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';

export type OrderCandidate = {
  symbol: string;
  exchange: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  reduceOnly?: boolean;
  leverage?: number;
};

export type RiskPolicy = {
  maxOrderValue: number;
  maxOrderQuantity: number;
  dailyLossLimit: number;
  maxOpenPositions: number;
  maxLeverage: number;
  sanityChecks: boolean;
  killSwitchEnforced: boolean;
  oneClickEnabled: boolean;
  semiAutoMode: boolean;
  pendingTtlMinutes: number;
  blockedSymbols: string[];
};

export type RiskContext = {
  refPrice: number;
  buyingPower: number;
  dayPnl: number;
  dayPnlKnown: boolean;
  openPositionCount: number;
  reducesPosition: boolean;
  killed: boolean;
  enforcedAccount: boolean;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  notional: number;
};

export function validateOrderStructure(order: OrderCandidate): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!order.symbol || order.symbol.trim().length === 0) {
    errors.push('Symbol is required');
  }
  const exch = (order.exchange ?? '').trim().toUpperCase();
  if (!exch) {
    errors.push('Exchange is required');
  } else if (!VALID_EXCHANGES.has(exch)) {
    errors.push(`Invalid exchange: ${order.exchange}`);
  }

  if (order.side !== 'buy' && order.side !== 'sell') {
    errors.push('Side must be buy or sell');
  }

  if (!Number.isFinite(order.quantity) || order.quantity <= 0) {
    errors.push('Quantity must be a positive finite number');
  }

  const price = order.price ?? 0;
  const stopPrice = order.stopPrice ?? 0;

  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(stopPrice) || stopPrice < 0) {
    errors.push('Price / trigger must be finite and not negative');
  }

  if ((order.orderType === 'limit' || order.orderType === 'stop_limit') && price <= 0) {
    errors.push('Limit price > 0 is required for LIMIT / STOP-LIMIT orders');
  }

  if ((order.orderType === 'stop' || order.orderType === 'stop_limit') && stopPrice <= 0) {
    errors.push('Trigger price > 0 is required for STOP / STOP-LIMIT orders');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    notional: price > 0 && Number.isFinite(order.quantity) ? price * order.quantity : 0,
  };
}

export function evaluatePreTradeRisk(
  order: OrderCandidate,
  policy: RiskPolicy,
  ctx: RiskContext,
): ValidationResult {
  const structure = validateOrderStructure(order);
  const errors = [...structure.errors];
  const warnings = [...structure.warnings];

  const sym = order.symbol.trim().toUpperCase();
  const exch = order.exchange.trim().toUpperCase();
  const refPrice = ctx.refPrice > 0 ? ctx.refPrice : order.price ?? order.stopPrice ?? 0;
  const notional = refPrice > 0 && Number.isFinite(order.quantity) ? refPrice * order.quantity : 0;

  if (policy.killSwitchEnforced && ctx.killed && !ctx.reducesPosition) {
    errors.push('KILL_SWITCH_ACTIVE: Operator kill switch is engaged. Only position-reducing exits are permitted.');
  }

  if (policy.sanityChecks) {
    if (order.quantity > SANITY_MAX_QUANTITY) {
      errors.push(
        `Quantity ${order.quantity} exceeds sanity limit (${SANITY_MAX_QUANTITY}) — rejected as probable input typo`,
      );
    }
    if (
      !ctx.reducesPosition &&
      !DERIVATIVE_EXCHANGES.has(exch) &&
      notional > 0 &&
      ctx.buyingPower > 0 &&
      notional > SANITY_BUYING_POWER_MULTIPLE * ctx.buyingPower
    ) {
      errors.push(
        `Order value ${notional.toFixed(2)} exceeds ${SANITY_BUYING_POWER_MULTIPLE}x available buying power ${ctx.buyingPower.toFixed(2)}`,
      );
    }
  }

  if (ctx.enforcedAccount && !ctx.reducesPosition) {
    const blocked = new Set(policy.blockedSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean));
    if (blocked.has(sym) || (exch && blocked.has(`${exch}:${sym}`))) {
      errors.push(`${order.symbol} is on your blocked-symbols list (Risk limits)`);
    }

    if (policy.maxOrderQuantity > 0 && order.quantity > policy.maxOrderQuantity) {
      errors.push(`Quantity ${order.quantity} exceeds max order quantity ${policy.maxOrderQuantity}`);
    }

    if (policy.maxOrderValue > 0) {
      if (notional <= 0) {
        errors.push(`Max order value ${policy.maxOrderValue.toFixed(2)} is configured but no reference price is known (fail closed)`);
      } else if (notional > policy.maxOrderValue) {
        errors.push(`Order value ${notional.toFixed(2)} exceeds max order value ${policy.maxOrderValue.toFixed(2)}`);
      }
    }

    if (policy.maxOpenPositions > 0 && ctx.openPositionCount >= policy.maxOpenPositions) {
      errors.push(`Open positions (${ctx.openPositionCount}) reached cap (${policy.maxOpenPositions})`);
    }

    if (policy.maxLeverage > 0 && (order.leverage ?? 1) > policy.maxLeverage) {
      errors.push(`Requested leverage ${order.leverage}x exceeds max leverage ${policy.maxLeverage}x`);
    }

    if (policy.dailyLossLimit > 0) {
      if (!ctx.dayPnlKnown) {
        errors.push('Daily loss limit is configured but realized day P&L is unavailable (fail closed)');
      } else if (ctx.dayPnl <= -policy.dailyLossLimit) {
        errors.push(
          `Daily loss limit reached: day P&L ${ctx.dayPnl.toFixed(2)} <= -${policy.dailyLossLimit.toFixed(2)}. Only reducing orders allowed.`,
        );
      }
    }
  }

  if (ctx.reducesPosition && errors.length === 0) {
    warnings.push('Position-reducing order: exposure cap exemptions applied so risk cannot trap open positions.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    notional,
  };
}

export async function loadRiskPolicy(db: AppDatabase): Promise<RiskPolicy> {
  const rows = await db.select().from(riskSettings).where(eq(riskSettings.id, 1)).limit(1);
  if (rows.length === 0) {
    return {
      maxOrderValue: 5000,
      maxOrderQuantity: 100,
      dailyLossLimit: 500,
      maxOpenPositions: 10,
      maxLeverage: 5,
      sanityChecks: true,
      killSwitchEnforced: true,
      oneClickEnabled: false,
      semiAutoMode: true,
      pendingTtlMinutes: 5,
      blockedSymbols: [],
    };
  }
  const r = rows[0];
  return {
    maxOrderValue: Math.max(0, r.maxOrderValue),
    maxOrderQuantity: Math.max(0, r.maxOrderQuantity),
    dailyLossLimit: Math.abs(r.dailyLossLimit),
    maxOpenPositions: Math.max(0, r.maxOpenPositions),
    maxLeverage: Math.max(1, r.maxLeverage),
    sanityChecks: r.sanityChecks,
    killSwitchEnforced: r.killSwitchEnforced,
    oneClickEnabled: r.oneClickEnabled,
    semiAutoMode: r.semiAutoMode,
    pendingTtlMinutes: Math.min(240, Math.max(1, r.pendingTtlMinutes)),
    blockedSymbols: Array.isArray(r.blockedSymbols) ? r.blockedSymbols : [],
  };
}

export async function isKillSwitchActive(db: AppDatabase): Promise<boolean> {
  const rows = await db.select().from(safetyState).where(eq(safetyState.id, 1)).limit(1);
  return rows[0]?.killed ?? false;
}

export async function saveRiskPolicy(db: AppDatabase, input: Partial<RiskPolicy>): Promise<RiskPolicy> {
  const current = await loadRiskPolicy(db);
  const next: RiskPolicy = {
    maxOrderValue: input.maxOrderValue !== undefined ? Math.max(0, input.maxOrderValue) : current.maxOrderValue,
    maxOrderQuantity: input.maxOrderQuantity !== undefined ? Math.max(0, input.maxOrderQuantity) : current.maxOrderQuantity,
    dailyLossLimit: input.dailyLossLimit !== undefined ? Math.abs(input.dailyLossLimit) : current.dailyLossLimit,
    maxOpenPositions: input.maxOpenPositions !== undefined ? Math.max(0, Math.floor(input.maxOpenPositions)) : current.maxOpenPositions,
    maxLeverage: input.maxLeverage !== undefined ? Math.max(1, input.maxLeverage) : current.maxLeverage,
    sanityChecks: input.sanityChecks ?? current.sanityChecks,
    killSwitchEnforced: input.killSwitchEnforced ?? current.killSwitchEnforced,
    oneClickEnabled: input.oneClickEnabled ?? current.oneClickEnabled,
    semiAutoMode: input.semiAutoMode ?? current.semiAutoMode,
    pendingTtlMinutes: input.pendingTtlMinutes !== undefined ? Math.min(240, Math.max(1, Math.floor(input.pendingTtlMinutes))) : current.pendingTtlMinutes,
    blockedSymbols: input.blockedSymbols
      ? Array.from(new Set(input.blockedSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean)))
      : current.blockedSymbols,
  };

  await db
    .insert(riskSettings)
    .values({
      id: 1,
      ...next,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: riskSettings.id,
      set: {
        ...next,
        updatedAt: new Date(),
      },
    });

  return next;
}
