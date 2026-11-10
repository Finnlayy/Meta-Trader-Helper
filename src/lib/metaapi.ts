// metaapi.ts — MetaAPI Cloud REST adapter for MT4/MT5 accounts ported from FinceptTerminal MetaApiBroker.cpp. Dependencies: schema.
import { eq } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { auditLog, mt5Profiles, sources } from './schema';

export type MetaApiStatus = 'CONNECTED' | 'TOKEN_EXPIRED' | 'NOT_CONFIGURED' | 'OFFLINE';

export type MetaApiConfig = {
  id: string;
  label: string;
  accountId: string;
  region: string;
  platform: 'mt4' | 'mt5';
  server: string;
  login: string;
  accountType: string;
  magicNumber: number;
  hasToken: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
};

export type MetaApiRemoteSnapshot = {
  status: MetaApiStatus;
  accountInfo: Record<string, unknown> | null;
  positions: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  error: string | null;
};

function getEffectiveToken(): string | null {
  const fromEnv = process.env.METAAPI_TOKEN?.trim();
  return fromEnv || null;
}

export function classifyMetaApiError(status: number, bodyText: string): { code: MetaApiStatus; message: string } {
  const lower = bodyText.toLowerCase();
  if (status === 401 || status === 403 || lower.includes('token') || lower.includes('expired') || lower.includes('unauthorized')) {
    return {
      code: 'TOKEN_EXPIRED',
      message: `[TOKEN_EXPIRED] MetaAPI authentication rejected (HTTP ${status}). Update METAAPI_TOKEN environment variable.`,
    };
  }
  return {
    code: 'OFFLINE',
    message: `MetaAPI request failed (HTTP ${status}): ${bodyText.slice(0, 220)}`,
  };
}

export async function getMetaApiConnection(db: AppDatabase): Promise<MetaApiConfig> {
  const rows = await db.select().from(mt5Profiles).where(eq(mt5Profiles.id, 'default')).limit(1);
  const envAccountId = process.env.METAAPI_ACCOUNT_ID?.trim() ?? '';
  const hasToken = Boolean(getEffectiveToken());
  const row = rows[0];

  if (!row) {
    return {
      id: 'default',
      label: 'Primary MT5 Terminal',
      accountId: envAccountId,
      region: 'london',
      platform: 'mt5',
      server: 'MetaQuotes-Demo',
      login: '',
      accountType: 'demo',
      magicNumber: 505001,
      hasToken,
      status: envAccountId && hasToken ? 'CONFIGURED' : 'NOT_CONFIGURED',
      lastError: null,
      lastCheckedAt: null,
    };
  }

  const effectiveAccountId = row.metaapiAccountId || envAccountId;
  return {
    id: row.id,
    label: row.label,
    accountId: effectiveAccountId,
    region: row.region,
    platform: row.platform === 'mt4' ? 'mt4' : 'mt5',
    server: row.server,
    login: row.login,
    accountType: row.accountType,
    magicNumber: row.magicNumber,
    hasToken,
    status: effectiveAccountId && hasToken ? row.status : 'NOT_CONFIGURED',
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt,
  };
}

export async function saveMetaApiConnection(
  db: AppDatabase,
  input: {
    label?: string;
    accountId?: string;
    region?: string;
    platform?: 'mt4' | 'mt5';
    server?: string;
    login?: string;
    accountType?: 'demo' | 'live';
    magicNumber?: number;
  },
) {
  const existing = await db.select().from(mt5Profiles).where(eq(mt5Profiles.id, 'default')).limit(1);
  const prev = existing[0];
  const accountId = (input.accountId ?? prev?.metaapiAccountId ?? '').trim();
  const region = (input.region ?? prev?.region ?? 'london').trim().toLowerCase() || 'london';
  const platform = (input.platform ?? prev?.platform) === 'mt4' ? 'mt4' : 'mt5';
  const server = (input.server ?? prev?.server ?? 'MetaQuotes-Demo').trim();
  const login = (input.login ?? prev?.login ?? '').trim();
  const accountType = (input.accountType ?? prev?.accountType) === 'live' ? 'live' : 'demo';
  const magicNumber = input.magicNumber ?? prev?.magicNumber ?? 505001;
  const hasToken = Boolean(getEffectiveToken());

  await db
    .insert(mt5Profiles)
    .values({
      id: 'default',
      label: input.label?.trim() || prev?.label || 'Primary MT5 Terminal',
      platform,
      region,
      server,
      login,
      accountType,
      metaapiAccountId: accountId,
      magicNumber,
      status: accountId && hasToken ? 'CONFIGURED' : 'NOT CONFIGURED',
      lastError: null,
    })
    .onConflictDoUpdate({
      target: mt5Profiles.id,
      set: {
        label: input.label?.trim() || prev?.label || 'Primary MT5 Terminal',
        platform,
        region,
        server,
        login,
        accountType,
        metaapiAccountId: accountId,
        magicNumber,
        status: accountId && hasToken ? 'CONFIGURED' : 'NOT CONFIGURED',
        lastError: null,
      },
    });

  await db.insert(auditLog).values({
    actor: 'operator',
    action: 'metaapi_profile_saved',
    details: { accountId, region, platform, server, accountType, magicNumber },
  });

  return getMetaApiConnection(db);
}

export async function syncMetaApiAccount(db: AppDatabase): Promise<MetaApiRemoteSnapshot> {
  const cfg = await getMetaApiConnection(db);
  const token = getEffectiveToken();

  if (!cfg.accountId || !token) {
    await db
      .insert(sources)
      .values({
        id: 'mt5:metaapi',
        name: 'MetaTrader / MetaAPI Bridge',
        category: 'broker',
        status: 'NOT CONFIGURED',
        lastError: 'Missing MetaAPI accountId or METAAPI_TOKEN env var',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sources.id,
        set: {
          status: 'NOT CONFIGURED',
          lastError: 'Missing MetaAPI accountId or METAAPI_TOKEN env var',
          updatedAt: new Date(),
        },
      });
    return {
      status: 'NOT_CONFIGURED',
      accountInfo: null,
      positions: [],
      orders: [],
      error: 'MetaAPI is NOT CONFIGURED. Set METAAPI_TOKEN in environment and save your MetaAPI Account ID.',
    };
  }

  const baseUrl = `https://mt-client-api-v1.${cfg.region}.agiliumtrade.ai/users/current/accounts/${encodeURIComponent(cfg.accountId)}`;
  const headers = { 'auth-token': token, Accept: 'application/json' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const [accRes, posRes, ordRes] = await Promise.all([
      fetch(`${baseUrl}/account-information`, { headers, signal: controller.signal }),
      fetch(`${baseUrl}/positions`, { headers, signal: controller.signal }),
      fetch(`${baseUrl}/orders`, { headers, signal: controller.signal }),
    ]);
    clearTimeout(timer);

    if (!accRes.ok) {
      const text = await accRes.text();
      const classified = classifyMetaApiError(accRes.status, text);
      await db
        .update(mt5Profiles)
        .set({ status: classified.code, lastError: classified.message, lastCheckedAt: new Date() })
        .where(eq(mt5Profiles.id, 'default'));
      await db
        .update(sources)
        .set({ status: 'OFFLINE', lastError: classified.message, updatedAt: new Date() })
        .where(eq(sources.id, 'mt5:metaapi'));
      return { status: classified.code, accountInfo: null, positions: [], orders: [], error: classified.message };
    }

    const accountInfo = (await accRes.json()) as Record<string, unknown>;
    const positions = posRes.ok ? ((await posRes.json()) as Record<string, unknown>[]) : [];
    const orders = ordRes.ok ? ((await ordRes.json()) as Record<string, unknown>[]) : [];
    const now = new Date();

    await db
      .update(mt5Profiles)
      .set({ status: 'LIVE', lastError: null, lastCheckedAt: now })
      .where(eq(mt5Profiles.id, 'default'));

    await db
      .update(sources)
      .set({ status: 'LIVE', lastSuccess: now, lastError: null, updatedAt: now })
      .where(eq(sources.id, 'mt5:metaapi'));

    return { status: 'CONNECTED', accountInfo, positions, orders, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MetaAPI network unreachable';
    await db
      .update(mt5Profiles)
      .set({ status: 'OFFLINE', lastError: message, lastCheckedAt: new Date() })
      .where(eq(mt5Profiles.id, 'default'));
    await db
      .update(sources)
      .set({ status: 'OFFLINE', lastError: message, updatedAt: new Date() })
      .where(eq(sources.id, 'mt5:metaapi'));
    return { status: 'OFFLINE', accountInfo: null, positions: [], orders: [], error: message };
  }
}
