// Mt5McpNotesWorkspace.tsx — F8 MT5 EA Library & Custom Upload Studio, Module-Aware MQL4/MQL5 Auditor & Generator, MetaAPI Cloud REST, MCP JSON-RPC 2.0 Console, and Trade Journal. Dependencies: React, BacktestWorkspace types.
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EaBacktestHint } from './BacktestWorkspace';

const DEFAULT_EDITOR_SNIPPET = `// MQL5 Static Audit Workbench Snippet
#include <Trade/Trade.mqh>
CTrade trade;
double InpLots = 0.25;
double InpMultiplier = 2.0; // martingale risk

int OnInit() {
   int rsi = iRSI(_Symbol, PERIOD_CURRENT, 14, PRICE_CLOSE);
   return(INIT_SUCCEEDED);
}

void OnTick() {
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   trade.Buy(InpLots, _Symbol, ask, ask - 50 * _Point, ask + 100 * _Point);
   Sleep(500);
}`;

type EaAuditFinding = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  file?: string | null;
  line: number | null;
  recommendation: string;
};

type EaAuditReport = {
  score: number;
  grade: string;
  programType?: string;
  lineCount: number;
  filesAnalyzed?: number;
  resolvedIncludes?: string[];
  missingIncludes?: string[];
  findings: EaAuditFinding[];
  metrics: {
    criticalCount?: number;
    warningCount?: number;
    infoCount?: number;
    magicNumberProtected?: boolean;
    stopLevelChecked?: boolean;
    newBarGated?: boolean;
    lotNormalized?: boolean;
    indicatorCleanup?: boolean;
  };
};

type EaLibrarySummary = {
  id: string;
  name: string;
  slug: string;
  sourceKind: 'library' | 'uploaded' | 'generated' | string;
  category: string;
  entryFileName: string;
  version: string;
  author: string;
  description: string;
  language: string;
  fileCount: number;
  inputsCount: number;
  resolvedIncludes: number;
  totalLocalIncludes: number;
  hasSetPreset: boolean;
  lastAuditScore: number | null;
  lastAuditGrade: string | null;
  filePaths: string[];
  updatedAt: string;
};

type EaProjectFile = {
  path: string;
  name: string;
  kind: 'ea' | 'header' | 'set' | 'other';
  size: number;
  content: string;
};

type EaParsedInput = {
  group: string;
  type: string;
  name: string;
  defaultValue: string;
  comment: string;
  file: string;
};

type EaIncludeRef = {
  includePath: string;
  isSystem: boolean;
  resolved: boolean;
  resolvedPath: string | null;
  sourceFile: string;
};

type EaLibraryDetail = EaLibrarySummary & {
  files: EaProjectFile[];
  inputs: EaParsedInput[];
  includes: EaIncludeRef[];
  lastAudit: EaAuditReport | null;
};

type StagedFile = {
  file: File;
  relPath: string;
};

type McpTool = { name: string; area: string; safety: string; description: string };
type ExternalMcpTool = { name: string; title?: string; description: string; inputSchema: Record<string, unknown> };
type McpBridgeProfile = {
  id: string;
  name: string;
  endpointUrl: string;
  enabled: boolean;
  status: string;
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number;
  toolsJson: ExternalMcpTool[];
  lastError: string | null;
  lastLatencyMs: number | null;
  lastConnectedAt: string | null;
  tokenSource: 'env' | 'session' | 'none';
  hasToken: boolean;
};
type NoteRow = { id: string; title: string; symbol: string; category: string; content: string; updatedAt: string };

export function Mt5McpNotesWorkspace({
  onNotify,
  onStatusChanged,
  onSendToBacktest,
}: {
  onNotify: (msg: string, isError?: boolean) => void;
  onStatusChanged: () => Promise<void>;
  onSendToBacktest?: (hint: EaBacktestHint) => void;
}) {
  // EA Library & Upload state
  const [libraryEas, setLibraryEas] = useState<EaLibrarySummary[]>([]);
  const [libraryStats, setLibraryStats] = useState({ total: 0, libraryCount: 0, uploadedCount: 0, generatedCount: 0 });
  const [filterKind, setFilterKind] = useState<'all' | 'library' | 'uploaded' | 'generated'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEaId, setSelectedEaId] = useState<string>('');
  const [selectedEa, setSelectedEa] = useState<EaLibraryDetail | null>(null);
  const [selectedBacktestHint, setSelectedBacktestHint] = useState<EaBacktestHint | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'files' | 'inputs' | 'audit'>('files');
  const [activeFilePath, setActiveFilePath] = useState<string>('');
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Upload form state
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadCategory, setUploadCategory] = useState('Custom Upload');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // MetaAPI state
  const [accountId, setAccountId] = useState('');
  const [region, setRegion] = useState('london');
  const [server, setServer] = useState('MetaQuotes-Demo');
  const [login, setLogin] = useState('');
  const [magicNumber, setMagicNumber] = useState('505001');
  const [metaStatus, setMetaStatus] = useState<string>('NOT_CONFIGURED');
  const [metaError, setMetaError] = useState<string | null>(null);

  // EA Auditor & Generator state
  const [eaSource, setEaSource] = useState(DEFAULT_EDITOR_SNIPPET);
  const [eaName, setEaName] = useState('Custom_Strategy_Check');
  const [editorLibraryId, setEditorLibraryId] = useState<string>('');
  const [auditReport, setAuditReport] = useState<EaAuditReport | null>(null);
  const [generatedEa, setGeneratedEa] = useState('');

  // MCP Console state (built-in + External Local MT5 / MetaEditor MCP Bridge)
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [selectedTool, setSelectedTool] = useState('mt5.list_ea_library');
  const [toolArgs, setToolArgs] = useState('{}');
  const [mcpOutput, setMcpOutput] = useState<string>('');
  const [bridges, setBridges] = useState<McpBridgeProfile[]>([]);
  const [activeBridgeId, setActiveBridgeId] = useState<'mt5-terminal' | 'metaeditor'>('mt5-terminal');
  const [bridgeEndpoint, setBridgeEndpoint] = useState('http://127.0.0.1:22346/mcp');
  const [bridgeTokenInput, setBridgeTokenInput] = useState('');
  const [bridgeConnecting, setBridgeConnecting] = useState(false);
  const [selectedRemoteTool, setSelectedRemoteTool] = useState('');
  const [remoteToolArgs, setRemoteToolArgs] = useState('{}');
  const [remoteOutput, setRemoteOutput] = useState('');

  // Notes state
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteSym, setNoteSym] = useState('XAUUSD');
  const [noteContent, setNoteContent] = useState('');

  const selectEa = useCallback(async (id: string) => {
    if (!id) return;
    setSelectedEaId(id);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/ea-library?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const detail: EaLibraryDetail = data.ea;
        setSelectedEa(detail);
        setSelectedBacktestHint(data.backtestHint ?? null);
        setActiveFilePath(detail.entryFileName || detail.files[0]?.path || '');
      }
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    const [libRes, mtRes, mcpRes, bridgeRes, nRes] = await Promise.all([
      fetch('/api/ea-library', { cache: 'no-store' }),
      fetch('/api/mt5', { cache: 'no-store' }),
      fetch('/api/mcp', { cache: 'no-store' }),
      fetch('/api/mt5-mcp', { cache: 'no-store' }),
      fetch('/api/notes', { cache: 'no-store' }),
    ]);

    if (libRes.ok) {
      const lj = await libRes.json();
      const eas: EaLibrarySummary[] = lj.eas ?? [];
      setLibraryEas(eas);
      if (lj.stats) setLibraryStats(lj.stats);
      if (eas.length > 0 && !selectedEaId) {
        const preferred = eas.find((e) => e.id === 'drive-scalpsnipper') ?? eas[0];
        void selectEa(preferred.id);
      }
    }

    if (mtRes.ok) {
      const mj = await mtRes.json();
      if (mj.connection) {
        setAccountId(mj.connection.accountId ?? '');
        setRegion(mj.connection.region ?? 'london');
        setServer(mj.connection.server ?? 'MetaQuotes-Demo');
        setLogin(mj.connection.login ?? '');
        setMagicNumber(String(mj.connection.magicNumber ?? 505001));
        setMetaStatus(mj.connection.status ?? 'NOT_CONFIGURED');
        setMetaError(mj.connection.lastError ?? null);
      }
    }

    if (mcpRes.ok) {
      const mcj = await mcpRes.json();
      setMcpTools(mcj.tools ?? []);
    }

    if (bridgeRes.ok) {
      const brj = await bridgeRes.json();
      const loadedBridges: McpBridgeProfile[] = brj.bridges ?? [];
      setBridges(loadedBridges);
      const current = loadedBridges.find((b) => b.id === activeBridgeId) ?? loadedBridges[0];
      if (current) {
        setBridgeEndpoint(current.endpointUrl);
        if (current.toolsJson.length > 0 && !selectedRemoteTool) {
          setSelectedRemoteTool(current.toolsJson[0].name);
        }
      }
    }

    if (nRes.ok) {
      const nj = await nRes.json();
      setNotes(nj.notes ?? []);
    }
  }, [activeBridgeId, selectEa, selectedEaId, selectedRemoteTool]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredEas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return libraryEas.filter((ea) => {
      if (filterKind !== 'all' && ea.sourceKind !== filterKind) return false;
      if (!q) return true;
      return (
        ea.name.toLowerCase().includes(q) ||
        ea.entryFileName.toLowerCase().includes(q) ||
        ea.category.toLowerCase().includes(q) ||
        ea.description.toLowerCase().includes(q)
      );
    });
  }, [libraryEas, filterKind, searchQuery]);

  const activeFile = useMemo(() => {
    if (!selectedEa) return null;
    return selectedEa.files.find((f) => f.path === activeFilePath) ?? selectedEa.files[0] ?? null;
  }, [selectedEa, activeFilePath]);

  function addFilesToStage(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    setStagedFiles((prev) => {
      const map = new Map<string, StagedFile>();
      for (const item of prev) {
        map.set(item.relPath.toLowerCase(), item);
      }
      for (const f of incoming) {
        const webkitRel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
        let relPath = (webkitRel && webkitRel.trim()) || f.name;
        if (webkitRel && webkitRel.includes('/')) {
          const parts = webkitRel.split('/');
          if (parts.length > 1) relPath = parts.slice(1).join('/');
        }
        map.set(relPath.toLowerCase(), { file: f, relPath });
      }
      const merged = Array.from(map.values());
      if (!uploadName.trim()) {
        const main = merged.find((m) => /\.(mq5|mq4)$/i.test(m.file.name)) ?? merged[0];
        if (main) {
          setUploadName(main.file.name.replace(/\.(mq5|mq4|mqh|set|txt|md)$/i, ''));
        }
      }
      return merged;
    });
  }

  async function handleUploadFiles(attachToSelected: boolean) {
    if (stagedFiles.length === 0) {
      onNotify('Select or drop .mq5, .mq4, .mqh, or .set files first', true);
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      for (const item of stagedFiles) {
        form.append('files', item.file);
        form.append('paths', item.relPath);
      }
      if (attachToSelected && selectedEa) {
        form.append('attachToId', selectedEa.id);
      } else {
        form.append('name', uploadName.trim() || stagedFiles[0].file.name.replace(/\.(mq5|mq4|mqh|set)$/i, ''));
        form.append('category', uploadCategory);
        form.append('description', uploadDescription.trim());
      }

      const res = await fetch('/api/ea-library', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error ?? 'EA upload failed', true);
        return;
      }

      const uploadedEa: EaLibraryDetail = data.ea;
      setLibraryEas(data.eas ?? []);
      setSelectedEa(uploadedEa);
      setSelectedEaId(uploadedEa.id);
      setSelectedBacktestHint(data.backtestHint ?? null);
      setActiveFilePath(uploadedEa.entryFileName || uploadedEa.files[0]?.path || '');
      setInspectorTab('audit');
      setStagedFiles([]);
      setUploadName('');
      setUploadDescription('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';

      const skipNote =
        Array.isArray(data.skippedFiles) && data.skippedFiles.length > 0
          ? ` (${data.skippedFiles.length} non-source file(s) skipped)`
          : '';
      onNotify(
        `${attachToSelected ? 'Attached files to' : 'Uploaded'} ${uploadedEa.name}: ${uploadedEa.fileCount} file(s), Audit ${uploadedEa.lastAuditScore ?? '-'} / 100${skipNote}`,
      );
      await loadAll();
    } finally {
      setUploading(false);
    }
  }

  async function handleReauditLibraryEa(id: string) {
    const res = await fetch('/api/ea-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'audit', id }),
    });
    const data = await res.json();
    if (res.ok && data.ea) {
      setSelectedEa(data.ea);
      setLibraryEas(data.eas ?? []);
      setInspectorTab('audit');
      onNotify(`Multi-file audit updated: ${data.ea.name} -> ${data.ea.lastAuditScore}/100 (Grade ${data.ea.lastAuditGrade})`);
    } else {
      onNotify(data.error ?? 'Audit failed', true);
    }
  }

  async function handleRestoreDriveLibrary() {
    const res = await fetch('/api/ea-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restoreLibrary', forceOverwrite: false }),
    });
    const data = await res.json();
    if (res.ok) {
      setLibraryEas(data.eas ?? []);
      onNotify(`Drive library verified (${data.eas?.length ?? 0} total EAs available)`);
    }
  }

  async function handleDeleteEa(ea: EaLibraryDetail) {
    const res = await fetch(`/api/ea-library?id=${encodeURIComponent(ea.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      const remaining: EaLibrarySummary[] = data.eas ?? [];
      setLibraryEas(remaining);
      onNotify(`Deleted ${ea.name} from EA library`);
      if (remaining.length > 0) {
        void selectEa(remaining[0].id);
      } else {
        setSelectedEa(null);
        setSelectedEaId('');
      }
    } else {
      onNotify(data.error ?? 'Delete failed', true);
    }
  }

  function handleLoadIntoAuditor(ea: EaLibraryDetail) {
    const entry = ea.files.find((f) => f.path === ea.entryFileName) ?? ea.files[0];
    if (!entry) return;
    setEaName(ea.name);
    setEaSource(entry.content);
    setEditorLibraryId(ea.id);
    if (ea.lastAudit) setAuditReport(ea.lastAudit);
    onNotify(`Loaded ${entry.path} (+ ${Math.max(0, ea.fileCount - 1)} companion modules) into Auditor Editor`);
  }

  async function handleSaveEditorToLibrary() {
    if (!eaSource.trim() || !eaName.trim()) {
      onNotify('Provide an EA name and source code first', true);
      return;
    }
    const cleanFile = `${eaName.replace(/[^A-Za-z0-9_-]/g, '_')}.mq5`;
    const res = await fetch('/api/ea-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload',
        name: eaName.trim(),
        category: generatedEa ? 'Generated Modular EA' : 'Custom Upload',
        sourceKind: generatedEa ? 'generated' : 'uploaded',
        entryFileName: cleanFile,
        files: [{ path: cleanFile, content: eaSource }],
      }),
    });
    const data = await res.json();
    if (res.ok && data.ea) {
      setLibraryEas(data.eas ?? []);
      setSelectedEa(data.ea);
      setSelectedEaId(data.ea.id);
      setActiveFilePath(data.ea.entryFileName);
      onNotify(`Saved ${data.ea.name} to persistent EA Library`);
      await loadAll();
    } else {
      onNotify(data.error ?? 'Save failed', true);
    }
  }

  async function handleSaveMetaApi() {
    const res = await fetch('/api/mt5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'saveConnection', accountId, region, server, login, magicNumber: Number(magicNumber) }),
    });
    const data = await res.json();
    if (res.ok) {
      setMetaStatus(data.connection.status);
      onNotify('MT5 / MetaAPI profile saved');
      await onStatusChanged();
    }
  }

  async function handleSyncMetaApi() {
    const res = await fetch('/api/mt5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'syncRemote' }),
    });
    const data = await res.json();
    setMetaStatus(data.snapshot?.status ?? 'OFFLINE');
    setMetaError(data.snapshot?.error ?? null);
    onNotify(data.snapshot?.error ? data.snapshot.error : 'MetaAPI account synced', Boolean(data.snapshot?.error));
    await onStatusChanged();
  }

  async function handleAuditEa() {
    const res = await fetch('/api/mt5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'auditEa',
        eaName,
        fileName: `${eaName}.mq5`,
        source: eaSource,
        libraryId: editorLibraryId || undefined,
        save: true,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setAuditReport(data.report);
      onNotify(`MQL5 Audit complete: Score ${data.report.score}/100 (Grade ${data.report.grade})`);
    } else {
      onNotify(data.error ?? 'Audit failed', true);
    }
  }

  async function handleGenerateCleanEa() {
    const res = await fetch('/api/mt5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generateEa',
        eaName: 'Fable5_Modular_EmaRsi_EA',
        magicNumber: Number(magicNumber) || 505001,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setGeneratedEa(data.code);
      setEaSource(data.code);
      setEaName('Fable5_Modular_EmaRsi_EA');
      setEditorLibraryId('');
      setAuditReport(data.selfAudit);
      onNotify(`Generated clean MQL5 EA (Self-Audit Score: ${data.selfAudit.score}/100 Grade ${data.selfAudit.grade})`);
    }
  }

  const activeBridge = useMemo(
    () => bridges.find((b) => b.id === activeBridgeId) ?? null,
    [bridges, activeBridgeId],
  );

  function buildArgsTemplateFromSchema(schema: Record<string, unknown> | undefined): string {
    const props = (schema?.properties ?? {}) as Record<string, { type?: string }>;
    const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
    const obj: Record<string, unknown> = {};
    for (const key of required) {
      const t = props[key]?.type;
      obj[key] = t === 'number' || t === 'integer' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : '';
    }
    return JSON.stringify(obj, null, 2);
  }

  function handleSelectBridgeProfile(nextId: 'mt5-terminal' | 'metaeditor') {
    setActiveBridgeId(nextId);
    const match = bridges.find((b) => b.id === nextId);
    if (match) {
      setBridgeEndpoint(match.endpointUrl);
      setSelectedRemoteTool(match.toolsJson[0]?.name ?? '');
      if (match.toolsJson[0]) {
        setRemoteToolArgs(buildArgsTemplateFromSchema(match.toolsJson[0].inputSchema));
      }
    } else {
      setBridgeEndpoint(nextId === 'metaeditor' ? 'http://127.0.0.1:22345/mcp' : 'http://127.0.0.1:22346/mcp');
      setSelectedRemoteTool('');
    }
    setBridgeTokenInput('');
  }

  async function handleSaveBridgeConfig(clearToken = false) {
    const res = await fetch('/api/mt5-mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveConfig',
        id: activeBridgeId,
        endpointUrl: bridgeEndpoint,
        bearerToken: clearToken ? undefined : bridgeTokenInput || undefined,
        clearToken,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setBridges(data.bridges ?? []);
      if (data.bridge?.endpointUrl) setBridgeEndpoint(data.bridge.endpointUrl);
      if (clearToken || bridgeTokenInput) setBridgeTokenInput('');
      onNotify(clearToken ? 'Cleared runtime session token' : `Saved MCP bridge address: ${data.bridge?.endpointUrl}`);
      await onStatusChanged();
    } else {
      onNotify(data.error ?? 'Failed to save MCP bridge settings', true);
    }
  }

  async function handleConnectBridge() {
    setBridgeConnecting(true);
    try {
      const res = await fetch('/api/mt5-mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'connect',
          id: activeBridgeId,
          endpointUrl: bridgeEndpoint,
          bearerToken: bridgeTokenInput || undefined,
        }),
      });
      const data = await res.json();
      if (data.bridges) setBridges(data.bridges);
      if (data.bridge?.endpointUrl) setBridgeEndpoint(data.bridge.endpointUrl);
      if (bridgeTokenInput && data.ok) setBridgeTokenInput('');

      if (data.ok && data.bridge) {
        const discovered: ExternalMcpTool[] = data.bridge.toolsJson ?? [];
        if (discovered.length > 0) {
          setSelectedRemoteTool(discovered[0].name);
          setRemoteToolArgs(buildArgsTemplateFromSchema(discovered[0].inputSchema));
        }
        onNotify(`Connected to ${data.bridge.serverName || activeBridgeId} (${discovered.length} tool(s) discovered)`);
      } else {
        onNotify(data.error ?? 'MT5 MCP bridge connection failed', true);
      }
      await onStatusChanged();
    } finally {
      setBridgeConnecting(false);
    }
  }

  async function handleCallRemoteMcpTool() {
    if (!selectedRemoteTool) {
      onNotify('Connect & discover MT5 MCP tools first', true);
      return;
    }
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(remoteToolArgs || '{}');
    } catch {
      onNotify('Invalid JSON arguments for remote MT5 MCP tool', true);
      return;
    }

    const res = await fetch('/api/mt5-mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'callTool',
        id: activeBridgeId,
        toolName: selectedRemoteTool,
        arguments: parsedArgs,
        bearerToken: bridgeTokenInput || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setRemoteOutput(JSON.stringify(data.result, null, 2));
      onNotify(`Executed remote MT5 tool: ${selectedRemoteTool}`);
    } else {
      setRemoteOutput(JSON.stringify(data, null, 2));
      onNotify(data.error ?? 'Remote MT5 MCP tool call failed', true);
    }
  }

  async function handleRunMcp() {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolArgs || '{}');
    } catch {
      onNotify('Invalid JSON arguments for MCP tool', true);
      return;
    }
    const res = await fetch('/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: selectedTool, arguments: args },
      }),
    });
    const data = await res.json();
    setMcpOutput(JSON.stringify(data, null, 2));
  }

  async function handleSaveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: noteTitle, symbol: noteSym, content: noteContent }),
    });
    if (res.ok) {
      setNoteTitle('');
      setNoteContent('');
      await loadAll();
      onNotify('Journal thesis note saved');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Section 1: Persistent MT5 EA Library & Custom File Upload Studio */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Synced Google Drive EA Collection &amp; Custom MQL4 / MQL5 Vault</div>
            <h2 className="panel-h2">
              MT5 EA Library &amp; File Upload Studio
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge live">DRIVE LIBRARY: {libraryStats.libraryCount}</span>
            <span className="badge cyan">UPLOADED: {libraryStats.uploadedCount}</span>
            <span className="badge amber">GENERATED: {libraryStats.generatedCount}</span>
            <button type="button" className="btn btn-sm" onClick={() => void handleRestoreDriveLibrary()}>
              Sync Drive Library
            </button>
          </div>
        </div>

        <div className="ea-studio-grid">
          {/* Left column: Library Browser + Custom Uploader */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div className="tab-strip" style={{ marginBottom: 8 }}>
                {(
                  [
                    ['all', `ALL (${libraryStats.total})`],
                    ['library', `DRIVE (${libraryStats.libraryCount})`],
                    ['uploaded', `UPLOADED (${libraryStats.uploadedCount})`],
                    ['generated', `GEN (${libraryStats.generatedCount})`],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={`tab-pill ${filterKind === k ? 'active' : ''}`}
                    onClick={() => setFilterKind(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="field" style={{ marginBottom: 8 }}>
                <label htmlFor="ea-lib-search">Filter EAs by name, file, or category</label>
                <input
                  id="ea-lib-search"
                  aria-label="Filter EAs by name, file, or category"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="ea-list">
                {filteredEas.length === 0 ? (
                  <div className="muted mono" style={{ padding: 12, fontSize: 11 }}>
                    No EAs match the active filter.
                  </div>
                ) : (
                  filteredEas.map((ea) => {
                    const gradeBadgeClass =
                      (ea.lastAuditScore ?? 0) >= 85
                        ? 'live'
                        : (ea.lastAuditScore ?? 0) >= 60
                          ? 'amber'
                          : 'critical';
                    return (
                      <button
                        key={ea.id}
                        type="button"
                        className={`ea-list-item ${selectedEaId === ea.id ? 'active' : ''}`}
                        onClick={() => void selectEa(ea.id)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: 13 }}>{ea.name}</strong>
                          <span className={`badge ${gradeBadgeClass}`}>
                            {ea.lastAuditGrade ?? '-'} {ea.lastAuditScore !== null ? ea.lastAuditScore : 'n/a'}
                          </span>
                        </div>
                        <div className="mono muted" style={{ fontSize: 10 }}>
                          {ea.entryFileName} • {ea.fileCount} file{ea.fileCount === 1 ? '' : 's'}
                          {ea.totalLocalIncludes > 0 ? ` • ${ea.resolvedIncludes}/${ea.totalLocalIncludes} inc` : ''}
                          {ea.hasSetPreset ? ' • .set' : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span className={`badge ${ea.sourceKind === 'library' ? 'live' : ea.sourceKind === 'uploaded' ? 'cyan' : 'amber'}`}>
                            {ea.sourceKind === 'library' ? 'DRIVE' : ea.sourceKind.toUpperCase()}
                          </span>
                          <span className="badge">{ea.category}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Custom EA Upload Dropzone & Metadata Form */}
            <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 12, background: '#0b1013' }}>
              <div className="panel-title" style={{ marginBottom: 6 }}>Upload Your Own MT4 / MT5 EA Files</div>
              <div
                className={`dropzone ${dragOver ? 'over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) addFilesToStage(e.dataTransfer.files);
                }}
              >
                <div className="mono" style={{ fontSize: 11, marginBottom: 8 }}>
                  Drop <strong>.mq5</strong>, <strong>.mq4</strong>, <strong>.mqh</strong>, or <strong>.set</strong> files here
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <input
                    ref={fileInputRef}
                    id="ea-file-picker"
                    type="file"
                    multiple
                    accept=".mq5,.mq4,.mqh,.set,.mqproj,.md,.txt"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.length) addFilesToStage(e.target.files);
                    }}
                  />
                  <input
                    ref={folderInputRef}
                    id="ea-folder-picker"
                    type="file"
                    multiple
                    {...({ webkitdirectory: '' } as Record<string, string>)}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.length) addFilesToStage(e.target.files);
                    }}
                  />
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => fileInputRef.current?.click()}>
                    Choose Files
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => folderInputRef.current?.click()}>
                    Choose EA Folder
                  </button>
                </div>
              </div>

              {stagedFiles.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="mono muted" style={{ fontSize: 10 }}>
                    Staged ({stagedFiles.length} file{stagedFiles.length === 1 ? '' : 's'}):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 88, overflowY: 'auto' }}>
                    {stagedFiles.map((sf) => (
                      <span key={sf.relPath} className="badge cyan" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {sf.relPath}
                        <button
                          type="button"
                          aria-label={`Remove ${sf.relPath}`}
                          style={{ background: 'none', border: 0, padding: 0, fontWeight: 700 }}
                          onClick={() => setStagedFiles((prev) => prev.filter((p) => p.relPath !== sf.relPath))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-row" style={{ marginTop: 10 }}>
                <div className="field">
                  <label htmlFor="up-ea-name">EA Name</label>
                  <input id="up-ea-name" value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
                </div>
                <div style={{ width: 150 }}>
                  <label htmlFor="up-ea-cat">Category</label>
                  <select id="up-ea-cat" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}>
                    <option value="Custom Upload">Custom Upload</option>
                    <option value="ONNX Scalper">ONNX Scalper</option>
                    <option value="Regime AI">Regime AI</option>
                    <option value="Multi-Strategy">Multi-Strategy</option>
                    <option value="Neural & Signal">Neural &amp; Signal</option>
                    <option value="Utility / Script">Utility / Script</option>
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="up-ea-desc">Notes / Strategy Summary</label>
                <input id="up-ea-desc" value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={uploading || stagedFiles.length === 0}
                  onClick={() => void handleUploadFiles(false)}
                >
                  {uploading ? 'Uploading...' : 'Upload New EA & Audit'}
                </button>
                {selectedEa && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={uploading || stagedFiles.length === 0}
                    onClick={() => void handleUploadFiles(true)}
                  >
                    Attach to {selectedEa.name}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right column: Selected EA Multi-File Inspector */}
          <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 14, background: '#0b1013', minHeight: 540 }}>
            {loadingDetail ? (
              <div className="mono muted">Loading EA bundle...</div>
            ) : !selectedEa ? (
              <div className="mono muted">Select an EA from your Drive Library or upload custom .mq5/.mq4/.mqh files to inspect.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="panel-head" style={{ marginBottom: 4 }}>
                  <div>
                    <div className="mono muted" style={{ fontSize: 10 }}>
                      {selectedEa.language.toUpperCase()} • v{selectedEa.version} • {selectedEa.author} • {selectedEa.fileCount} file(s)
                    </div>
                    <h3 style={{ margin: '2px 0 4px', fontSize: 17 }}>{selectedEa.name}</h3>
                    <div className="muted" style={{ fontSize: 12 }}>{selectedEa.description}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      className={`badge ${(selectedEa.lastAuditScore ?? 0) >= 85 ? 'live' : (selectedEa.lastAuditScore ?? 0) >= 60 ? 'amber' : 'critical'}`}
                    >
                      AUDIT GRADE {selectedEa.lastAuditGrade ?? '-'} • {selectedEa.lastAuditScore ?? 0}/100
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleReauditLibraryEa(selectedEa.id)}>
                    Re-Audit Multi-File Project
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => handleLoadIntoAuditor(selectedEa)}>
                    Open in Auditor Editor
                  </button>
                  {onSendToBacktest && selectedBacktestHint && (
                    <button type="button" className="btn btn-sm btn-amber" onClick={() => onSendToBacktest(selectedBacktestHint)}>
                      Send Params → Backtest (F4)
                    </button>
                  )}
                  {activeFile && (
                    <a
                      className="btn btn-sm"
                      href={`/api/ea-library?id=${encodeURIComponent(selectedEa.id)}&download=file&path=${encodeURIComponent(activeFile.path)}`}
                      download={activeFile.name}
                    >
                      Download {activeFile.name}
                    </a>
                  )}
                  {selectedEa.sourceKind !== 'library' && (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void handleDeleteEa(selectedEa)}>
                      Delete EA
                    </button>
                  )}
                </div>

                <div className="tab-strip">
                  <button
                    type="button"
                    className={`tab-pill ${inspectorTab === 'files' ? 'active' : ''}`}
                    onClick={() => setInspectorTab('files')}
                  >
                    Files &amp; Source ({selectedEa.files.length})
                  </button>
                  <button
                    type="button"
                    className={`tab-pill ${inspectorTab === 'inputs' ? 'active' : ''}`}
                    onClick={() => setInspectorTab('inputs')}
                  >
                    Inputs ({selectedEa.inputs.length}) &amp; #includes ({selectedEa.includes.length})
                  </button>
                  <button
                    type="button"
                    className={`tab-pill ${inspectorTab === 'audit' ? 'active' : ''}`}
                    onClick={() => setInspectorTab('audit')}
                  >
                    Multi-File Audit Findings ({selectedEa.lastAudit?.findings.length ?? 0})
                  </button>
                </div>

                {inspectorTab === 'files' && (
                  <div className="ea-source-split">
                    <div className="file-tree">
                      {selectedEa.files.map((f) => (
                        <button
                          key={f.path}
                          type="button"
                          className={`file-tree-btn ${activeFile?.path === f.path ? 'active' : ''}`}
                          onClick={() => setActiveFilePath(f.path)}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
                          <span className="badge" style={{ padding: '1px 4px', fontSize: 9 }}>
                            {f.kind.toUpperCase()}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }} className="mono muted">
                        <span style={{ fontSize: 11 }}>{activeFile?.path}</span>
                        <span style={{ fontSize: 10 }}>
                          {activeFile ? `${activeFile.content.split('\n').length} lines • ${activeFile.size.toLocaleString()} bytes` : ''}
                        </span>
                      </div>
                      <pre className="code-viewer">{activeFile?.content ?? ''}</pre>
                    </div>
                  </div>
                )}

                {inspectorTab === 'inputs' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <div className="panel-title" style={{ marginBottom: 6 }}>
                        #include Dependency Graph ({selectedEa.resolvedIncludes}/{selectedEa.totalLocalIncludes} Local Headers Attached)
                      </div>
                      <div className="table-wrap" style={{ maxHeight: 190, overflowY: 'auto' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Include Target</th>
                              <th>Scope</th>
                              <th>Declared In</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedEa.includes.length === 0 ? (
                              <tr><td colSpan={4} className="muted">No #include directives detected.</td></tr>
                            ) : (
                              selectedEa.includes.map((inc, idx) => (
                                <tr key={`${inc.sourceFile}-${inc.includePath}-${idx}`}>
                                  <td>{inc.includePath}</td>
                                  <td>{inc.isSystem ? 'SYSTEM' : 'LOCAL'}</td>
                                  <td className="muted">{inc.sourceFile}</td>
                                  <td>
                                    <span className={`badge ${inc.resolved ? 'live' : 'amber'}`}>
                                      {inc.isSystem ? 'MT5 STDLIB' : inc.resolved ? 'ATTACHED' : 'MISSING'}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <div className="panel-title" style={{ marginBottom: 6 }}>
                        Parsed MQL Input Parameters ({selectedEa.inputs.length})
                      </div>
                      <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Group</th>
                              <th>Type</th>
                              <th>Parameter</th>
                              <th>Default</th>
                              <th>Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedEa.inputs.length === 0 ? (
                              <tr><td colSpan={5} className="muted">No input declarations parsed.</td></tr>
                            ) : (
                              selectedEa.inputs.map((inp) => (
                                <tr key={`${inp.file}-${inp.name}`}>
                                  <td className="muted">{inp.group}</td>
                                  <td>{inp.type}</td>
                                  <td><strong>{inp.name}</strong></td>
                                  <td className="pos">{inp.defaultValue}</td>
                                  <td className="muted">{inp.comment || inp.file}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {inspectorTab === 'audit' && selectedEa.lastAudit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="badge cyan">TYPE: {(selectedEa.lastAudit.programType ?? 'expert').toUpperCase()}</span>
                      <span className="badge">FILES ANALYZED: {selectedEa.lastAudit.filesAnalyzed ?? selectedEa.fileCount}</span>
                      <span className="badge">TOTAL LINES: {selectedEa.lastAudit.lineCount}</span>
                      <span className={`badge ${selectedEa.lastAudit.metrics.magicNumberProtected ? 'live' : 'amber'}`}>
                        MAGIC ISOLATION: {selectedEa.lastAudit.metrics.magicNumberProtected ? 'PASS' : 'CHECK'}
                      </span>
                      <span className={`badge ${selectedEa.lastAudit.metrics.lotNormalized ? 'live' : 'amber'}`}>
                        LOT NORM: {selectedEa.lastAudit.metrics.lotNormalized ? 'PASS' : 'CHECK'}
                      </span>
                      <span className={`badge ${selectedEa.lastAudit.metrics.newBarGated ? 'live' : 'amber'}`}>
                        NEW BAR: {selectedEa.lastAudit.metrics.newBarGated ? 'PASS' : 'CHECK'}
                      </span>
                    </div>
                    <div className="pre-box" style={{ maxHeight: 330 }}>
                      {selectedEa.lastAudit.findings.length === 0
                        ? 'Zero findings — passes all module-aware MQL5 security and execution safety checks.'
                        : selectedEa.lastAudit.findings
                            .map(
                              (f) =>
                                `[${f.severity.toUpperCase()}] ${f.id} (${f.file ?? selectedEa.entryFileName}:${f.line ?? '-'}): ${f.title}\n  Detail: ${f.detail}\n  Fix: ${f.recommendation}`,
                            )
                            .join('\n\n')}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Local MetaTrader 5 & MetaEditor MCP Bridge (127.0.0.1:22346 / 22345) */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">MetaTrader 5 &amp; MetaEditor Built-in Streamable HTTP MCP Client</div>
            <h2 className="panel-h2">
              Local MT5 Terminal MCP Bridge (127.0.0.1:22346){' '}
              <span
                className={`badge ${
                  activeBridge?.status === 'CONNECTED'
                    ? 'live'
                    : activeBridge?.status === 'READY'
                      ? 'cyan'
                      : activeBridge?.status === 'AUTH_ERROR'
                        ? 'critical'
                        : 'amber'
                }`}
              >
                {activeBridge?.status ?? 'NOT CONFIGURED'}
              </span>
              {activeBridge?.toolCount ? <span className="badge live" style={{ marginLeft: 6 }}>{activeBridge.toolCount} REMOTE TOOLS</span> : null}
            </h2>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`tab-pill ${activeBridgeId === 'mt5-terminal' ? 'active' : ''}`}
              onClick={() => handleSelectBridgeProfile('mt5-terminal')}
            >
              MT5 Terminal (:22346)
            </button>
            <button
              type="button"
              className={`tab-pill ${activeBridgeId === 'metaeditor' ? 'active' : ''}`}
              onClick={() => handleSelectBridgeProfile('metaeditor')}
            >
              MetaEditor 5 (:22345)
            </button>
          </div>
        </div>

        <div className="form-row">
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="bridge-url">MCP Endpoint Address (accepts http://127.0.0.1:22346/mcp, 127.0.0.1:22346, or MT5 log line)</label>
            <input id="bridge-url" value={bridgeEndpoint} onChange={(e) => setBridgeEndpoint(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="bridge-tok">
              Bearer API Key ({activeBridge?.tokenSource === 'env' ? 'loaded from .env' : activeBridge?.tokenSource === 'session' ? 'loaded in session memory' : 'not set'})
            </label>
            <input
              id="bridge-tok"
              type="password"
              value={bridgeTokenInput}
              onChange={(e) => setBridgeTokenInput(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => void handleSaveBridgeConfig(false)}>
              Save Config
            </button>
            {activeBridge?.tokenSource === 'session' && (
              <button type="button" className="btn btn-sm" onClick={() => void handleSaveBridgeConfig(true)}>
                Clear Key
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" disabled={bridgeConnecting} onClick={() => void handleConnectBridge()}>
              {bridgeConnecting ? 'Connecting...' : 'Connect & Discover Tools'}
            </button>
          </div>
        </div>

        {activeBridge?.lastError && (
          <div className="banner-warn" style={{ marginTop: 10, marginBottom: 0 }}>
            <strong>Bridge Status:</strong> {activeBridge.lastError}
          </div>
        )}

        <div style={{ marginTop: 12, padding: 10, border: '1px solid var(--line)', borderRadius: 5, background: '#090d0f' }}>
          <div className="panel-title" style={{ marginBottom: 6 }}>
            After Local Installation — Ready for 127.0.0.1:22346
          </div>
          <div className="mono muted" style={{ fontSize: 11, lineHeight: 1.55 }}>
            1. On your Windows/macOS machine where MT5 prints <code>MCP started on 127.0.0.1:22346</code>, open MT5{' '}
            <strong>Tools → Options → MCP</strong>, enable the internal server, and click <strong>Generate</strong> for an API key.
            <br />
            2. Add to <code>.env</code>: <code>MT5_MCP_URL=http://127.0.0.1:22346/mcp</code> and <code>MT5_MCP_TOKEN=&lt;your-key&gt;</code> (or paste the key above).
            <br />
            3. Run <code>npm run check:mt5-mcp</code> to verify the terminal handshake, or start Fable 5 locally (<code>npm run dev</code>) and click <strong>Connect &amp; Discover Tools</strong>.
          </div>
        </div>

        {activeBridge && activeBridge.toolsJson.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="remote-tool">Discovered MT5 MCP Tool ({activeBridge.toolsJson.length})</label>
                <select
                  id="remote-tool"
                  value={selectedRemoteTool}
                  onChange={(e) => {
                    const name = e.target.value;
                    setSelectedRemoteTool(name);
                    const found = activeBridge.toolsJson.find((t) => t.name === name);
                    if (found) setRemoteToolArgs(buildArgsTemplateFromSchema(found.inputSchema));
                  }}
                >
                  {activeBridge.toolsJson.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} {t.description ? `— ${t.description.slice(0, 64)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="remote-args">Arguments JSON</label>
                <input id="remote-args" value={remoteToolArgs} onChange={(e) => setRemoteToolArgs(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleCallRemoteMcpTool()}>
                  Call MT5 Tool
                </button>
              </div>
            </div>
            {remoteOutput && <div className="pre-box" style={{ marginTop: 10, maxHeight: 210 }}>{remoteOutput}</div>}
          </div>
        )}
      </div>

      {/* Section 3: MetaApiBroker Cloud Adapter */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Fincept MetaApiBroker Adapter (MT4 / MT5 Cloud REST)</div>
            <h2 className="panel-h2">
              MetaTrader 5 Connection Profile <span className={`badge ${metaStatus === 'CONNECTED' ? 'live' : 'amber'}`}>{metaStatus}</span>
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => void handleSaveMetaApi()}>Save Profile</button>
            <button type="button" className="btn btn-primary" onClick={() => void handleSyncMetaApi()}>Test / Sync Remote Account</button>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="mt-acc">MetaAPI Account ID</label>
            <input id="mt-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)} />
          </div>
          <div style={{ width: 130 }}>
            <label htmlFor="mt-reg">Region</label>
            <select id="mt-reg" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="london">london</option>
              <option value="new-york">new-york</option>
              <option value="singapore">singapore</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="mt-srv">Broker Server</label>
            <input id="mt-srv" value={server} onChange={(e) => setServer(e.target.value)} />
          </div>
          <div style={{ width: 120 }}>
            <label htmlFor="mt-log">Login</label>
            <input id="mt-log" value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>
          <div style={{ width: 110 }}>
            <label htmlFor="mt-mag">MagicNumber</label>
            <input id="mt-mag" type="number" value={magicNumber} onChange={(e) => setMagicNumber(e.target.value)} />
          </div>
        </div>
        {metaError && <div className="banner-warn" style={{ marginTop: 10, marginBottom: 0 }}>{metaError}</div>}
      </div>

      {/* Section 3: Interactive MQL5 Static Auditor / Generator + MCP Console & Notes */}
      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Module-Aware MQL4/MQL5 Execution Auditor</div>
              <h2 className="panel-h2">Interactive EA Code Editor &amp; Generator</h2>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm" onClick={() => void handleGenerateCleanEa()}>Generate Clean .mq5</button>
              <button type="button" className="btn btn-sm" onClick={() => void handleSaveEditorToLibrary()}>Save to Library</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleAuditEa()}>Run Static Audit</button>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="ea-name">EA Name {editorLibraryId ? `(Linked to Library ID: ${editorLibraryId})` : ''}</label>
            <input
              id="ea-name"
              value={eaName}
              onChange={(e) => {
                setEaName(e.target.value);
                setEditorLibraryId('');
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="ea-src">MQL4 / MQL5 Source Code (.mq5 / .mq4)</label>
            <textarea id="ea-src" rows={10} value={eaSource} onChange={(e) => setEaSource(e.target.value)} />
          </div>

          {auditReport && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span className={`badge ${auditReport.score >= 80 ? 'live' : auditReport.score >= 55 ? 'amber' : 'critical'}`}>
                  SCORE {auditReport.score}/100 (GRADE {auditReport.grade})
                </span>
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {auditReport.findings.length} findings across {auditReport.filesAnalyzed ?? 1} file(s) / {auditReport.lineCount} lines
                </span>
              </div>
              <div className="pre-box">
                {auditReport.findings.map((f) => `[${f.severity.toUpperCase()}] ${f.id} (${f.file ?? 'editor'}:${f.line ?? '-'}): ${f.title}\n  -> ${f.recommendation}`).join('\n\n') || 'Zero findings — passes all MQL5 safety checks.'}
              </div>
            </div>
          )}
          {generatedEa && <div className="muted mono" style={{ fontSize: 10, marginTop: 6 }}>Generated EA loaded into auditor editor and self-verified. Click Save to Library to persist.</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">Fincept MCP JSON-RPC 2.0 Registry ({mcpTools.length} Tools)</div>
                <h2 className="panel-h2">MCP Tool Console</h2>
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleRunMcp()}>Invoke Tool</button>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="mcp-tool">Registered Tool</label>
                <select id="mcp-tool" value={selectedTool} onChange={(e) => setSelectedTool(e.target.value)}>
                  {mcpTools.map((t) => (
                    <option key={t.name} value={t.name}>{t.name} [{t.safety}]</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="mcp-args">Arguments JSON</label>
                <input id="mcp-args" value={toolArgs} onChange={(e) => setToolArgs(e.target.value)} />
              </div>
            </div>
            {mcpOutput && <div className="pre-box" style={{ marginTop: 10, maxHeight: 190 }}>{mcpOutput}</div>}
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-h2">Operator Trade Journal ({notes.length})</h2>
            </div>
            <form onSubmit={handleSaveNote} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="form-row">
                <div className="field">
                  <label htmlFor="nt-title">Thesis Title</label>
                  <input id="nt-title" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
                </div>
                <div style={{ width: 110 }}>
                  <label htmlFor="nt-sym">Symbol</label>
                  <input id="nt-sym" value={noteSym} onChange={(e) => setNoteSym(e.target.value.toUpperCase())} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="nt-body">Analysis / Post-Trade Review</label>
                <textarea id="nt-body" rows={2} value={noteContent} onChange={(e) => setNoteContent(e.target.value)} />
              </div>
              <div>
                <button type="submit" className="btn btn-sm btn-primary">Save Note</button>
              </div>
            </form>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {notes.slice(0, 4).map((n) => (
                <div key={n.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{n.title}</strong>
                    <span className="badge cyan">{n.symbol || 'NOTE'}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{n.content.slice(0, 120)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
