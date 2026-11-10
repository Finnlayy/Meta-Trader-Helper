// route.ts — MCP JSON-RPC 2.0 tool catalog & dispatch server endpoint. Dependencies: mcpTools, http.
import { z } from 'zod';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { dispatchMcpTool, MCP_TOOLS } from '../../../lib/mcpTools';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    protocol: 'MCP/JSON-RPC-2.0',
    toolCount: MCP_TOOLS.length,
    tools: MCP_TOOLS,
  });
}

const directCallSchema = z.object({
  tool: z.string().min(2),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

const jsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.enum(['tools/list', 'tools/call']),
  params: z
    .object({
      name: z.string().optional(),
      arguments: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request, false);
  if (originErr) return originErr;

  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const raw = await request.json().catch(() => null);
  const rpc = jsonRpcSchema.safeParse(raw);
  if (rpc.success) {
    const id = rpc.data.id ?? 1;
    if (rpc.data.method === 'tools/list') {
      return Response.json({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
    }
    const toolName = rpc.data.params?.name ?? '';
    try {
      const output = await dispatchMcpTool(db, toolName, rpc.data.params?.arguments ?? {});
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }], data: output },
      });
    } catch (err) {
      return Response.json(
        { jsonrpc: '2.0', id, error: { code: -32602, message: err instanceof Error ? err.message : 'Tool failed' } },
        { status: 400 },
      );
    }
  }

  const direct = directCallSchema.safeParse(raw);
  if (direct.success) {
    try {
      const output = await dispatchMcpTool(db, direct.data.tool, direct.data.arguments ?? {});
      return Response.json({ tool: direct.data.tool, ok: true, result: output });
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Tool failed' }, { status: 400 });
    }
  }

  return Response.json({ error: 'Provide JSON-RPC 2.0 (tools/list | tools/call) or { tool, arguments }.' }, { status: 400 });
}
