// verify-mt5-mcp.mjs — CLI handshake probe for local MetaTrader 5 (127.0.0.1:22346/mcp) & MetaEditor 5 (127.0.0.1:22345/mcp) MCP servers.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

async function parseRpcBody(res) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  if (!text.trim()) return {};
  if (ct.includes('text/event-stream') || text.startsWith('data:') || text.includes('\ndata:')) {
    for (const block of text.replace(/\r\n/g, '\n').split(/\n\n+/)) {
      const dataLines = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());
      if (!dataLines.length) continue;
      const joined = dataLines.join('\n').trim();
      if (joined && joined !== '[DONE]') {
        try {
          return JSON.parse(joined);
        } catch {
          // continue
        }
      }
    }
  }
  return JSON.parse(text);
}

async function probeEndpoint(label, url, token) {
  console.log(`\n=== ${label} (${url}) ===`);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let initRes;
  try {
    initRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          clientInfo: { name: 'Fable5-CLI-Probe', version: '0.1.0' },
        },
      }),
    });
  } catch (err) {
    console.error(`OFFLINE: ${err instanceof Error ? err.message : String(err)}`);
    console.error('Ensure MetaTrader 5 is running on this PC and Tools -> Options -> MCP -> "Enable internal server" is checked.');
    return false;
  }

  if (initRes.status === 401 || initRes.status === 403) {
    console.error(`AUTH ERROR (HTTP ${initRes.status}): Set MT5_MCP_TOKEN / METAEDITOR_MCP_TOKEN in .env from MT5 -> Tools -> Options -> MCP -> Generate.`);
    return false;
  }

  if (!initRes.ok) {
    console.error(`ERROR (HTTP ${initRes.status}): ${(await initRes.text()).slice(0, 200)}`);
    return false;
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  const initJson = await parseRpcBody(initRes);
  console.log('Server:', initJson?.result?.serverInfo || 'Connected', '| Protocol:', initJson?.result?.protocolVersion || 'ok');

  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => null);

  const listRes = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });

  const listJson = await parseRpcBody(listRes);
  const tools = listJson?.result?.tools || [];
  console.log(`Discovered ${tools.length} tool(s):`);
  for (const t of tools.slice(0, 25)) {
    console.log(`  - ${t.name}${t.description ? `: ${t.description}` : ''}`);
  }
  if (tools.length > 25) console.log(`  ... and ${tools.length - 25} more.`);
  return true;
}

loadLocalEnv();
const mt5Url = process.env.MT5_MCP_URL?.trim() || 'http://127.0.0.1:22346/mcp';
const mt5Token = process.env.MT5_MCP_TOKEN?.trim() || '';
const meUrl = process.env.METAEDITOR_MCP_URL?.trim() || 'http://127.0.0.1:22345/mcp';
const meToken = process.env.METAEDITOR_MCP_TOKEN?.trim() || '';

const okMt5 = await probeEndpoint('MetaTrader 5 Terminal MCP', mt5Url, mt5Token);
const okMe = await probeEndpoint('MetaEditor 5 MCP', meUrl, meToken);

if (!okMt5 && !okMe) process.exit(1);
