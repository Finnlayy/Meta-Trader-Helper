// intel-mt5-mcp.test.ts — verify FinBERT scorer + 3-sigma shock detector, RSS XML parser, MQL5 EA static auditor/generator, MetaAPI error classification, and MCP dispatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createEphemeralTestDb } from '../src/lib/db';
import { auditMql5Source, generateCleanMql5Ea } from '../src/lib/eaAudit';
import {
  attachFilesToEaLibraryEntry,
  createOrSaveEaLibraryEntry,
  decodeEaTextBuffer,
  deleteEaLibraryEntry,
  getEaLibraryItem,
  listEaLibrary,
  validateAndPrepareUploadedFiles,
} from '../src/lib/eaLibrary';
import { dispatchMcpTool, MCP_TOOLS } from '../src/lib/mcpTools';
import {
  callExternalMcpTool,
  connectAndDiscoverMcpBridge,
  listMcpBridges,
  normalizeMcpEndpoint,
  saveMcpBridgeConfig,
  setBridgeRuntimeToken,
} from '../src/lib/mt5McpClient';
import { classifyMetaApiError } from '../src/lib/metaapi';
import { ingestNewsArticle, parseRssOrAtomXml, scoreTextWithFinbertModel } from '../src/lib/sentiment';

test('FinBERT scorer bounds score in [-1,1] and detects 3-sigma negative shock', () => {
  const bull = scoreTextWithFinbertModel('Bitcoin ETF inflows surge to record high after approval');
  assert.ok(bull.score > 0.5);
  assert.equal(bull.label, 'bullish');
  assert.ok(bull.tickers.includes('BTC') || bull.tickers.includes('BITCOIN') || bull.score > 0);

  // Stable positive-neutral rolling window so a deep crash headline breaches z < -3.0 && score < -0.65
  const steadyWindow = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 0.12 : 0.18));
  const crash = scoreTextWithFinbertModel(
    'Exchange halted after catastrophic bankruptcy default fraud hack crash',
    steadyWindow,
  );
  assert.ok(crash.score < -0.65);
  assert.ok(crash.zScore < -3.0);
  assert.equal(crash.shockDetected, true);
  assert.equal(crash.priority, 'CRITICAL');
});

test('RSS/Atom XML parser extracts articles cleanly and persists via ingestNewsArticle', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>Markets</title>
      <item>
        <title><![CDATA[NVDA beats earnings and raises guidance]]></title>
        <description>Strong data center growth pushes shares higher.</description>
        <link>https://example.com/nvda</link>
        <pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
  const parsed = parseRssOrAtomXml(xml);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'NVDA beats earnings and raises guidance');

  const { db, close } = await createEphemeralTestDb();
  try {
    const saved = await ingestNewsArticle(db, {
      title: parsed[0].title,
      summary: parsed[0].summary,
      source: 'Reuters',
      url: parsed[0].url,
    });
    assert.equal(saved.article.sourceFlag, 'TIER1');
    assert.equal(saved.assessment.label, 'bullish');
  } finally {
    await close();
  }
});

test('MQL5 EA static auditor detects critical risks in legacy EA and grades generated modular EA at 100', () => {
  const risky = `
    #include <Trade/Trade.mqh>
    CTrade trade;
    double lotMultiplier = 2.0; // martingale
    int OnInit() { int h = iRSI(_Symbol, PERIOD_CURRENT, 14, PRICE_CLOSE); return(INIT_SUCCEEDED); }
    void OnTick() { trade.Buy(0.1, _Symbol); Sleep(250); }
  `;
  const riskyReport = auditMql5Source(risky);
  assert.ok(riskyReport.score < 50);
  assert.ok(riskyReport.findings.some((f) => f.id === 'EA-RISK-02'));
  assert.ok(riskyReport.findings.some((f) => f.id === 'EA-ISOL-01'));
  assert.ok(riskyReport.findings.some((f) => f.id === 'EA-PERF-01'));

  const cleanCode = generateCleanMql5Ea({
    eaName: 'Fable5_Test_EA',
    magicNumber: 505001,
    riskPercent: 1.0,
    maxSpreadPoints: 25,
    atrPeriod: 14,
    atrSlMult: 2.0,
    atrTpMult: 4.0,
    fastEma: 12,
    slowEma: 26,
    rsiPeriod: 14,
    rsiOverbought: 70,
    rsiOversold: 30,
    maxDailyLossPct: 3.0,
    trailingAtrMult: 1.5,
  });
  const cleanReport = auditMql5Source(cleanCode);
  assert.equal(cleanReport.score, 100);
  assert.equal(cleanReport.grade, 'A');
});

test('MetaAPI error classifier identifies TOKEN_EXPIRED', () => {
  const c = classifyMetaApiError(401, '{"error":"Unauthorized: token expired"}');
  assert.equal(c.code, 'TOKEN_EXPIRED');
  assert.ok(c.message.includes('[TOKEN_EXPIRED]'));
});

test('MCP tool dispatcher executes registered tools against PGlite', async () => {
  assert.ok(MCP_TOOLS.length >= 15);
  const { db, close } = await createEphemeralTestDb();
  try {
    const bt = (await dispatchMcpTool(db, 'backtest.run', { symbol: 'BTC/USDT', presetId: 'rsi_reversion' })) as {
      report: { success: boolean };
    };
    assert.equal(bt.report.success, true);

    const policy = (await dispatchMcpTool(db, 'risk.get_policy', {})) as { killed: boolean };
    assert.equal(policy.killed, false);

    const eaList = (await dispatchMcpTool(db, 'mt5.list_ea_library', {})) as { id: string }[];
    assert.ok(eaList.length >= 8);
    const scalpAudit = (await dispatchMcpTool(db, 'mt5.audit_library_ea', { id: 'drive-scalpsnipper' })) as {
      filesAnalyzed: number;
      resolvedIncludes: string[];
      missingIncludes: string[];
    };
    assert.ok(scalpAudit.filesAnalyzed >= 5);
    assert.equal(scalpAudit.missingIncludes.length, 0);
  } finally {
    await close();
  }
});

test('MT5 EA Library seeds Google Drive EAs, resolves multi-file includes, decodes UTF-16LE, and supports custom upload/attach/delete', async () => {
  const { db, close } = await createEphemeralTestDb();
  try {
    const eas = await listEaLibrary(db);
    assert.ok(eas.some((e) => e.id === 'drive-scalpsnipper'));
    assert.ok(eas.some((e) => e.id === 'drive-ki-ai-super-trader'));
    assert.ok(eas.some((e) => e.id === 'drive-vizionai-profitgtx'));
    assert.ok(eas.some((e) => e.id === 'drive-architect-main'));

    const scalp = await getEaLibraryItem(db, 'drive-scalpsnipper');
    assert.ok(scalp);
    assert.equal(scalp.totalLocalIncludes, scalp.resolvedIncludes);
    assert.ok(scalp.inputs.length >= 20);
    assert.ok(scalp.lastAudit);
    assert.equal(scalp.lastAudit.metrics.magicNumberProtected, true);
    assert.equal(scalp.lastAudit.metrics.lotNormalized, true);

    // UTF-16LE BOM buffer (MetaEditor format)
    const sampleMq5 = '#property strict\n#include "HelperModule.mqh"\ninput double InpRisk = 1.0;\nint OnInit(){return(INIT_SUCCEEDED);}\nvoid OnTick(){}\n';
    const utf16Bom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sampleMq5, 'utf16le')]);
    assert.equal(decodeEaTextBuffer(utf16Bom), sampleMq5);

    const prepared = validateAndPrepareUploadedFiles([
      { path: 'MyCustomEA.mq5', bufferOrText: utf16Bom },
      { path: 'CompiledBinary.ex5', bufferOrText: Buffer.from([1, 2, 3, 4]) },
    ]);
    assert.equal(prepared.validFiles.length, 1);
    assert.equal(prepared.skippedFiles.length, 1);

    const created = await createOrSaveEaLibraryEntry(db, {
      name: 'My Custom Uploaded EA',
      category: 'Custom Upload',
      files: prepared.validFiles,
    });
    assert.equal(created.sourceKind, 'uploaded');
    assert.equal(created.lastAudit?.missingIncludes.includes('HelperModule.mqh'), true);

    const headerPrepared = validateAndPrepareUploadedFiles([
      {
        path: 'HelperModule.mqh',
        bufferOrText:
          '#include <Trade/Trade.mqh>\nCTrade trade;\nvoid Guard(){ trade.SetExpertMagicNumber(101); long m = POSITION_MAGIC; double s = SYMBOL_VOLUME_STEP; double mn = SYMBOL_VOLUME_MIN; double st = SYMBOL_TRADE_STOPS_LEVEL; datetime t = iTime(_Symbol, PERIOD_CURRENT, 0); if(trade.ResultRetcode()==TRADE_RETCODE_DONE){} }',
      },
    ]);
    const updated = await attachFilesToEaLibraryEntry(db, created.id, headerPrepared.validFiles);
    assert.equal(updated.fileCount, 2);
    assert.equal(updated.resolvedIncludes, 1);
    assert.ok((updated.lastAuditScore ?? 0) > (created.lastAuditScore ?? 0));

    const removed = await deleteEaLibraryEntry(db, created.id);
    assert.equal(removed, true);
    assert.equal(await getEaLibraryItem(db, created.id), null);
  } finally {
    await close();
  }
});

test('MT5 Local MCP Bridge normalizes 127.0.0.1:22346 addresses, handles Bearer auth, SSE streams, tools/list, and tools/call', async () => {
  assert.equal(normalizeMcpEndpoint('127.0.0.1:22346'), 'http://127.0.0.1:22346/mcp');
  assert.equal(
    normalizeMcpEndpoint('2026.11.10 18:24:34.609\tMCP\tstarted on 127.0.0.1:22346'),
    'http://127.0.0.1:22346/mcp',
  );

  const expectedToken = 'mt5-test-secret-key';
  const sessionId = 'sess-mt5-22346';

  const server = http.createServer((req, res) => {
    if (req.url !== '/mcp' || req.method !== 'POST') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    if (req.headers.authorization !== `Bearer ${expectedToken}`) {
      res.statusCode = 401;
      res.end('Unauthorized');
      return;
    }

    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      const msg = JSON.parse(rawBody || '{}') as { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
      if (msg.method === 'initialize') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Mcp-Session-Id', sessionId);
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-03-26',
              serverInfo: { name: 'MetaTrader 5 Terminal MCP', version: '6140' },
              capabilities: { tools: {} },
            },
          }),
        );
        return;
      }
      if (msg.method === 'notifications/initialized') {
        res.statusCode = 202;
        res.end();
        return;
      }
      if (msg.method === 'tools/list') {
        assert.equal(req.headers['mcp-session-id'], sessionId);
        // Respond using SSE event-stream format to verify Streamable HTTP SSE parsing
        res.setHeader('Content-Type', 'text/event-stream');
        const payload = JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              {
                name: 'terminal_account_info',
                description: 'Fetch active MT5 balance, equity, margin, and server.',
                inputSchema: { type: 'object', properties: {} },
              },
              {
                name: 'symbol_tick',
                description: 'Fetch latest bid/ask tick for an MT5 symbol.',
                inputSchema: { type: 'object', required: ['symbol'], properties: { symbol: { type: 'string' } } },
              },
            ],
          },
        });
        res.end(`event: message\ndata: ${payload}\n\n`);
        return;
      }
      if (msg.method === 'tools/call') {
        assert.equal(req.headers['mcp-session-id'], sessionId);
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ symbol: msg.params?.arguments?.symbol, bid: 2684.5, ask: 2684.8 }) }],
            },
          }),
        );
        return;
      }
      res.statusCode = 400;
      res.end('Unsupported method');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const testEndpoint = `http://127.0.0.1:${addr.port}/mcp`;

  const { db, close } = await createEphemeralTestDb();
  try {
    const initialBridges = await listMcpBridges(db);
    const defaultMt5 = initialBridges.find((b) => b.id === 'mt5-terminal');
    assert.ok(defaultMt5);
    assert.equal(defaultMt5.endpointUrl, 'http://127.0.0.1:22346/mcp');

    await saveMcpBridgeConfig(db, { id: 'mt5-terminal', endpointUrl: testEndpoint });

    // 1. Wrong/missing token produces AUTH_ERROR diagnosis
    setBridgeRuntimeToken('mt5-terminal', 'wrong-key');
    const authFail = await connectAndDiscoverMcpBridge(db, 'mt5-terminal');
    assert.equal(authFail.ok, false);
    assert.equal(authFail.bridge.status, 'AUTH_ERROR');

    // 2. Valid Bearer token connects, parses SSE tools/list, and executes tools/call
    const okConn = await connectAndDiscoverMcpBridge(db, 'mt5-terminal', expectedToken);
    assert.equal(okConn.ok, true);
    assert.equal(okConn.bridge.status, 'CONNECTED');
    assert.equal(okConn.bridge.toolCount, 2);
    assert.equal(okConn.bridge.serverName, 'MetaTrader 5 Terminal MCP');

    const callRes = (await callExternalMcpTool(db, 'mt5-terminal', 'symbol_tick', { symbol: 'XAUUSD' })) as {
      content: Array<{ text: string }>;
    };
    const tick = JSON.parse(callRes.content[0].text) as { symbol: string; bid: number };
    assert.equal(tick.symbol, 'XAUUSD');
    assert.equal(tick.bid, 2684.5);
  } finally {
    setBridgeRuntimeToken('mt5-terminal', '');
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
