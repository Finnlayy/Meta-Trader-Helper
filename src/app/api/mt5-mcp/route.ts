// route.ts — External MetaTrader 5 & MetaEditor Local MCP Streamable HTTP Bridge API. Dependencies: mt5McpClient, http.
import { z } from 'zod';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import {
  callExternalMcpTool,
  connectAndDiscoverMcpBridge,
  listMcpBridges,
  saveMcpBridgeConfig,
} from '../../../lib/mt5McpClient';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const bridges = await listMcpBridges(db);
  return Response.json(
    {
      bridges,
      defaultAddress: 'http://127.0.0.1:22346/mcp',
      defaultMetaEditorAddress: 'http://127.0.0.1:22345/mcp',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('saveConfig'),
    id: z.string().min(1).max(60).default('mt5-terminal'),
    endpointUrl: z.string().min(3).max(300),
    bearerToken: z.string().max(1024).optional(),
    clearToken: z.boolean().optional(),
    enabled: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('connect'),
    id: z.string().min(1).max(60).default('mt5-terminal'),
    endpointUrl: z.string().min(3).max(300).optional(),
    bearerToken: z.string().max(1024).optional(),
  }),
  z.object({
    action: z.literal('callTool'),
    id: z.string().min(1).max(60).default('mt5-terminal'),
    toolName: z.string().min(1).max(120),
    arguments: z.record(z.string(), z.unknown()).optional(),
    bearerToken: z.string().max(1024).optional(),
  }),
]);

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid MT5 MCP bridge payload.' }, { status: 400 });
  }

  const d = parsed.data;
  try {
    if (d.action === 'saveConfig') {
      const bridge = await saveMcpBridgeConfig(db, {
        id: d.id,
        endpointUrl: d.endpointUrl,
        bearerToken: d.bearerToken,
        clearToken: d.clearToken,
        enabled: d.enabled,
      });
      const bridges = await listMcpBridges(db);
      return Response.json({ ok: true, bridge, bridges });
    }

    if (d.action === 'connect') {
      if (d.endpointUrl || d.bearerToken) {
        await saveMcpBridgeConfig(db, {
          id: d.id,
          endpointUrl: d.endpointUrl || (d.id === 'metaeditor' ? 'http://127.0.0.1:22345/mcp' : 'http://127.0.0.1:22346/mcp'),
          bearerToken: d.bearerToken,
        });
      }
      const outcome = await connectAndDiscoverMcpBridge(db, d.id, d.bearerToken);
      const bridges = await listMcpBridges(db);
      return Response.json({ ...outcome, bridges });
    }

    const result = await callExternalMcpTool(db, d.id, d.toolName, d.arguments ?? {}, d.bearerToken);
    const bridges = await listMcpBridges(db);
    return Response.json({ ok: true, result, bridges });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'MT5 MCP bridge call failed.' },
      { status: 400 },
    );
  }
}
