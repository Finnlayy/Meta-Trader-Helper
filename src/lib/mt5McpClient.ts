// mt5McpClient.ts — Streamable HTTP & SSE MCP Bridge client for local MetaTrader 5 (127.0.0.1:22346/mcp) and MetaEditor 5 (127.0.0.1:22345/mcp) servers. Dependencies: schema, bootstrap, drizzle-orm.
import { eq } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { auditLog, mcpBridges, sources, type ExternalMcpToolDescriptor } from './schema';

type BridgeTokenStore = Map<string, string>;
type BridgeSessionInfo = {
  endpointUrl: string;
  sessionId: string | null;
  protocolVersion: string;
};

declare global {
  var __fable5McpTokens: BridgeTokenStore | undefined;
  var __fable5McpSessions: Map<string, BridgeSessionInfo> | undefined;
}

function getTokenStore(): BridgeTokenStore {
  if (!globalThis.__fable5McpTokens) {
    globalThis.__fable5McpTokens = new Map<string, string>();
  }
  return globalThis.__fable5McpTokens;
}

function getSessionStore(): Map<string, BridgeSessionInfo> {
  if (!globalThis.__fable5McpSessions) {
    globalThis.__fable5McpSessions = new Map<string, BridgeSessionInfo>();
  }
  return globalThis.__fable5McpSessions;
}

export function getEnvBridgeToken(bridgeId: string): string {
  if (bridgeId === 'mt5-terminal') return process.env.MT5_MCP_TOKEN?.trim() || '';
  if (bridgeId === 'metaeditor') return process.env.METAEDITOR_MCP_TOKEN?.trim() || '';
  return '';
}

export function setBridgeRuntimeToken(bridgeId: string, token: string): void {
  const store = getTokenStore();
  const trimmed = token.trim();
  if (trimmed) {
    store.set(bridgeId, trimmed);
  } else {
    store.delete(bridgeId);
  }
  getSessionStore().delete(bridgeId);
}

export function getEffectiveBridgeToken(bridgeId: string, overrideToken?: string): string {
  if (overrideToken && overrideToken.trim()) return overrideToken.trim();
  const runtime = getTokenStore().get(bridgeId);
  if (runtime) return runtime;
  return getEnvBridgeToken(bridgeId);
}

export function getBridgeTokenSource(bridgeId: string): 'env' | 'session' | 'none' {
  if (getTokenStore().get(bridgeId)) return 'session';
  if (getEnvBridgeToken(bridgeId)) return 'env';
  return 'none';
}

/**
 * Normalizes user-entered addresses such as:
 * - "http://127.0.0.1:22346/mcp"
 * - "127.0.0.1:22346"
 * - "2026.11.10 18:24:34.609\tMCP\tstarted on 127.0.0.1:22346"
 */
export function normalizeMcpEndpoint(rawInput: string): string {
  let trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('MCP endpoint URL cannot be empty.');
  }

  const startedOnMatch = trimmed.match(/\bstarted\s+on\s+((?:https?:\/\/)?(?:(?:[0-9]{1,3}\.){3}[0-9]{1,3}|localhost|[A-Za-z0-9-]+\.[A-Za-z0-9.-]+):\d{2,5}(?:\/[^\s]*)?)/i);
  const ipOrHostMatch = trimmed.match(/((?:https?:\/\/)?(?:(?:[0-9]{1,3}\.){3}[0-9]{1,3}|localhost|[A-Za-z0-9-]+\.[A-Za-z0-9.-]+):\d{2,5}(?:\/[^\s]*)?)/i);
  if (startedOnMatch) {
    trimmed = startedOnMatch[1];
  } else if (/started on|\bMCP\b/i.test(trimmed) && ipOrHostMatch) {
    trimmed = ipOrHostMatch[1];
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid MCP URL: ${rawInput}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// or https:// MCP endpoints are permitted.');
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '/mcp';
  }

  return parsed.toString();
}

type JsonRpcPayload = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export async function parseMcpHttpResponse(
  response: Response,
  expectedId?: string | number,
): Promise<JsonRpcPayload> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const text = await response.text();

  if (!text.trim()) {
    return {};
  }

  if (contentType.includes('text/event-stream') || text.includes('\ndata:') || text.startsWith('data:') || text.startsWith('event:')) {
    const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
    const parsedEvents: JsonRpcPayload[] = [];

    for (const block of blocks) {
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const joined = dataLines.join('\n').trim();
      if (!joined || joined === '[DONE]') continue;
      try {
        const obj = JSON.parse(joined) as JsonRpcPayload;
        parsedEvents.push(obj);
      } catch {
        // Ignore non-JSON SSE heartbeat/status comments
      }
    }

    if (expectedId !== undefined) {
      const exact = parsedEvents.find((ev) => ev.id === expectedId);
      if (exact) return exact;
    }
    const lastPayload = parsedEvents.find((ev) => ev.result !== undefined || ev.error !== undefined) ?? parsedEvents[parsedEvents.length - 1];
    if (lastPayload) return lastPayload;
    throw new Error('SSE MCP stream contained no JSON-RPC payload.');
  }

  try {
    return JSON.parse(text) as JsonRpcPayload;
  } catch {
    throw new Error(`MCP server returned non-JSON body (${response.status}): ${text.slice(0, 180)}`);
  }
}

function classifyMcpConnectionError(err: unknown, endpointUrl: string): { status: 'AUTH_ERROR' | 'OFFLINE'; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/401|unauthorized|forbidden|403/i.test(raw)) {
    return {
      status: 'AUTH_ERROR',
      message: `${raw} — Verify the Bearer API key generated in MetaTrader 5 (Tools -> Options -> MCP -> Generate) and set MT5_MCP_TOKEN in .env or enter it in the Bridge Token field.`,
    };
  }
  const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(endpointUrl);
  if (isLoopback && /ECONNREFUSED|fetch failed|Couldn't connect|ECONNRESET|ETIMEDOUT|aborted/i.test(raw)) {
    return {
      status: 'OFFLINE',
      message: `Cannot reach ${endpointUrl} (${raw}). Make sure Fable 5 is running locally on the same machine as MetaTrader 5, and in MT5 enable Tools -> Options -> MCP -> "Enable internal server".`,
    };
  }
  return {
    status: 'OFFLINE',
    message: raw,
  };
}

async function postJsonRpc(
  endpointUrl: string,
  body: Record<string, unknown>,
  token: string,
  sessionId: string | null,
  timeoutMs = 8000,
): Promise<{ response: Response; sessionId: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const nextSessionId = response.headers.get('mcp-session-id') ?? sessionId;
    return { response, sessionId: nextSessionId };
  } finally {
    clearTimeout(timer);
  }
}

async function establishMcpSession(
  bridgeId: string,
  endpointUrl: string,
  token: string,
): Promise<{
  endpointUrl: string;
  sessionId: string | null;
  protocolVersion: string;
  serverName: string;
  serverVersion: string;
}> {
  const versions = ['2025-03-26', '2024-11-05'];
  const candidateUrls = [endpointUrl];
  try {
    const u = new URL(endpointUrl);
    if (u.pathname === '/mcp') {
      const rootUrl = new URL(endpointUrl);
      rootUrl.pathname = '/';
      candidateUrls.push(rootUrl.toString());
    }
  } catch {
    // ignore
  }

  let lastError: Error | null = null;

  for (const candidate of candidateUrls) {
    for (const protocolVersion of versions) {
      const initReq = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion,
          capabilities: { tools: {} },
          clientInfo: { name: 'Fable5-Terminal', version: '0.1.0' },
        },
      };

      const { response, sessionId } = await postJsonRpc(candidate, initReq, token, null, 6000);
      if (response.status === 401 || response.status === 403) {
        throw new Error(`HTTP ${response.status} Unauthorized`);
      }
      if (response.status === 404 && candidate !== candidateUrls[candidateUrls.length - 1]) {
        lastError = new Error(`HTTP 404 at ${candidate}`);
        break;
      }
      if (!response.ok) {
        const bodySnippet = await response.text().catch(() => '');
        lastError = new Error(`HTTP ${response.status} from ${candidate}${bodySnippet ? `: ${bodySnippet.slice(0, 140)}` : ''}`);
        continue;
      }

      const payload = await parseMcpHttpResponse(response, 1);
      if (payload.error) {
        lastError = new Error(payload.error.message ?? `MCP initialize error (${payload.error.code ?? -32000})`);
        continue;
      }

      const resObj = (payload.result ?? {}) as {
        protocolVersion?: string;
        serverInfo?: { name?: string; version?: string };
      };

      // Best-effort notifications/initialized per MCP Streamable HTTP lifecycle
      await postJsonRpc(
        candidate,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        token,
        sessionId,
        4000,
      ).catch(() => null);

      const sessionInfo: BridgeSessionInfo = {
        endpointUrl: candidate,
        sessionId,
        protocolVersion: resObj.protocolVersion ?? protocolVersion,
      };
      getSessionStore().set(bridgeId, sessionInfo);

      return {
        endpointUrl: candidate,
        sessionId,
        protocolVersion: sessionInfo.protocolVersion,
        serverName: resObj.serverInfo?.name ?? 'MetaTrader 5 MCP Server',
        serverVersion: resObj.serverInfo?.version ?? 'unknown',
      };
    }
  }

  throw lastError ?? new Error(`Failed to initialize MCP session at ${endpointUrl}`);
}

export async function listMcpBridges(db: AppDatabase) {
  const rows = await db.select().from(mcpBridges);
  return rows.map((row) => ({
    ...row,
    tokenSource: getBridgeTokenSource(row.id),
    hasToken: getBridgeTokenSource(row.id) !== 'none',
  }));
}

export async function saveMcpBridgeConfig(
  db: AppDatabase,
  params: {
    id: string;
    endpointUrl: string;
    bearerToken?: string;
    clearToken?: boolean;
    enabled?: boolean;
  },
) {
  const normalizedUrl = normalizeMcpEndpoint(params.endpointUrl);
  if (params.clearToken) {
    setBridgeRuntimeToken(params.id, '');
  } else if (typeof params.bearerToken === 'string' && params.bearerToken.trim().length > 0) {
    setBridgeRuntimeToken(params.id, params.bearerToken);
  }

  const existing = await db.select().from(mcpBridges).where(eq(mcpBridges.id, params.id)).limit(1);
  const hasToken = getBridgeTokenSource(params.id) !== 'none';
  const nextStatus = hasToken ? 'READY' : 'NOT CONFIGURED';

  if (existing.length === 0) {
    await db.insert(mcpBridges).values({
      id: params.id,
      name: params.id === 'metaeditor' ? 'MetaEditor 5 MCP' : 'MetaTrader 5 Terminal MCP',
      endpointUrl: normalizedUrl,
      enabled: params.enabled ?? true,
      status: nextStatus,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(mcpBridges)
      .set({
        endpointUrl: normalizedUrl,
        enabled: params.enabled ?? existing[0].enabled,
        status: existing[0].status === 'CONNECTED' ? 'READY' : nextStatus,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(mcpBridges.id, params.id));
  }

  if (params.id === 'mt5-terminal') {
    await db
      .update(sources)
      .set({
        name: `MetaTrader 5 Local MCP (${normalizedUrl.replace(/^https?:\/\//, '')})`,
        status: nextStatus,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(sources.id, 'mt5:local-mcp'));
  }

  const updated = await db.select().from(mcpBridges).where(eq(mcpBridges.id, params.id)).limit(1);
  return {
    ...updated[0],
    tokenSource: getBridgeTokenSource(params.id),
    hasToken,
  };
}

export async function connectAndDiscoverMcpBridge(
  db: AppDatabase,
  bridgeId: string,
  overrideToken?: string,
) {
  if (overrideToken && overrideToken.trim()) {
    setBridgeRuntimeToken(bridgeId, overrideToken);
  }

  const rows = await db.select().from(mcpBridges).where(eq(mcpBridges.id, bridgeId)).limit(1);
  if (rows.length === 0) {
    throw new Error(`Unknown MCP bridge profile: ${bridgeId}`);
  }
  const bridge = rows[0];
  const token = getEffectiveBridgeToken(bridgeId, overrideToken);
  const started = Date.now();

  try {
    const session = await establishMcpSession(bridgeId, bridge.endpointUrl, token);

    const tools: ExternalMcpToolDescriptor[] = [];
    let cursor: string | undefined;
    let reqId = 2;

    for (let page = 0; page < 10; page++) {
      const listReq = {
        jsonrpc: '2.0',
        id: reqId++,
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      };
      const { response } = await postJsonRpc(session.endpointUrl, listReq, token, session.sessionId, 8000);
      if (response.status === 401 || response.status === 403) {
        throw new Error(`HTTP ${response.status} Unauthorized`);
      }
      if (!response.ok) {
        throw new Error(`tools/list failed with HTTP ${response.status}`);
      }
      const payload = await parseMcpHttpResponse(response, listReq.id);
      if (payload.error) {
        throw new Error(payload.error.message ?? 'tools/list returned JSON-RPC error');
      }
      const resObj = (payload.result ?? {}) as {
        tools?: Array<{
          name: string;
          title?: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
        nextCursor?: string;
      };
      for (const t of resObj.tools ?? []) {
        tools.push({
          name: t.name,
          title: t.title,
          description: t.description ?? '',
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
        });
      }
      if (!resObj.nextCursor) break;
      cursor = resObj.nextCursor;
    }

    const latencyMs = Date.now() - started;
    const now = new Date();
    await db
      .update(mcpBridges)
      .set({
        endpointUrl: session.endpointUrl,
        status: 'CONNECTED',
        protocolVersion: session.protocolVersion,
        serverName: session.serverName,
        serverVersion: session.serverVersion,
        toolCount: tools.length,
        toolsJson: tools,
        lastError: null,
        lastLatencyMs: latencyMs,
        lastConnectedAt: now,
        updatedAt: now,
      })
      .where(eq(mcpBridges.id, bridgeId));

    if (bridgeId === 'mt5-terminal') {
      await db
        .update(sources)
        .set({
          status: 'CONNECTED',
          latencyMs,
          lastSuccess: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(sources.id, 'mt5:local-mcp'));
    }

    await db.insert(auditLog).values({
      actor: 'mt5-mcp-bridge',
      action: 'bridge_connected',
      details: { bridgeId, endpointUrl: session.endpointUrl, toolCount: tools.length, latencyMs },
    });

    const refreshed = await db.select().from(mcpBridges).where(eq(mcpBridges.id, bridgeId)).limit(1);
    return {
      ok: true,
      bridge: {
        ...refreshed[0],
        tokenSource: getBridgeTokenSource(bridgeId),
        hasToken: getBridgeTokenSource(bridgeId) !== 'none',
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const classified = classifyMcpConnectionError(err, bridge.endpointUrl);
    const now = new Date();

    await db
      .update(mcpBridges)
      .set({
        status: classified.status,
        lastError: classified.message,
        lastLatencyMs: latencyMs,
        updatedAt: now,
      })
      .where(eq(mcpBridges.id, bridgeId));

    if (bridgeId === 'mt5-terminal') {
      await db
        .update(sources)
        .set({
          status: classified.status,
          latencyMs,
          lastError: classified.message,
          updatedAt: now,
        })
        .where(eq(sources.id, 'mt5:local-mcp'));
    }

    const refreshed = await db.select().from(mcpBridges).where(eq(mcpBridges.id, bridgeId)).limit(1);
    return {
      ok: false,
      error: classified.message,
      bridge: {
        ...refreshed[0],
        tokenSource: getBridgeTokenSource(bridgeId),
        hasToken: getBridgeTokenSource(bridgeId) !== 'none',
      },
    };
  }
}

export async function callExternalMcpTool(
  db: AppDatabase,
  bridgeId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  overrideToken?: string,
) {
  if (overrideToken && overrideToken.trim()) {
    setBridgeRuntimeToken(bridgeId, overrideToken);
  }
  const rows = await db.select().from(mcpBridges).where(eq(mcpBridges.id, bridgeId)).limit(1);
  if (rows.length === 0) {
    throw new Error(`Unknown MCP bridge profile: ${bridgeId}`);
  }
  const bridge = rows[0];
  const token = getEffectiveBridgeToken(bridgeId, overrideToken);

  let session = getSessionStore().get(bridgeId);
  if (!session || session.endpointUrl !== bridge.endpointUrl) {
    const established = await establishMcpSession(bridgeId, bridge.endpointUrl, token);
    session = {
      endpointUrl: established.endpointUrl,
      sessionId: established.sessionId,
      protocolVersion: established.protocolVersion,
    };
  }

  const callId = Date.now();
  const rpcBody = {
    jsonrpc: '2.0',
    id: callId,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  let { response } = await postJsonRpc(session.endpointUrl, rpcBody, token, session.sessionId, 15000);
  if (response.status === 404 || response.status === 400) {
    // Session expired; re-initialize once and retry
    const reestablished = await establishMcpSession(bridgeId, bridge.endpointUrl, token);
    session = {
      endpointUrl: reestablished.endpointUrl,
      sessionId: reestablished.sessionId,
      protocolVersion: reestablished.protocolVersion,
    };
    ({ response } = await postJsonRpc(session.endpointUrl, rpcBody, token, session.sessionId, 15000));
  }

  if (response.status === 401 || response.status === 403) {
    const diag = classifyMcpConnectionError(new Error(`HTTP ${response.status} Unauthorized`), bridge.endpointUrl);
    await db
      .update(mcpBridges)
      .set({ status: diag.status, lastError: diag.message, updatedAt: new Date() })
      .where(eq(mcpBridges.id, bridgeId));
    throw new Error(diag.message);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`tools/call HTTP ${response.status}: ${errText.slice(0, 200)}`);
  }

  const payload = await parseMcpHttpResponse(response, callId);
  if (payload.error) {
    throw new Error(payload.error.message ?? `Remote MCP tool failed (${payload.error.code ?? -32000})`);
  }

  await db.insert(auditLog).values({
    actor: 'mt5-mcp-bridge',
    action: 'remote_tool_call',
    details: { bridgeId, toolName },
  });

  return payload.result;
}
