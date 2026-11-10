// eaAudit.ts — Module-aware MT4/MT5 Expert Advisor (.mq5/.mq4/.mqh) static security/execution auditor & clean modular EA generator. Zero external runtime dependencies.
import type { EaIncludeRef, EaParsedInput, EaProjectFile } from './schema';

export type AuditSeverity = 'critical' | 'warning' | 'info';

export type EaCompanionFile = {
  path: string;
  content: string;
};

export type EaAuditFinding = {
  id: string;
  severity: AuditSeverity;
  title: string;
  detail: string;
  file?: string | null;
  line: number | null;
  recommendation: string;
};

export type EaProgramType = 'expert' | 'indicator' | 'script' | 'header';

export type EaAuditReport = {
  score: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  programType: EaProgramType;
  lineCount: number;
  filesAnalyzed: number;
  hasOnInit: boolean;
  hasOnTick: boolean;
  hasOnDeinit: boolean;
  usesCTrade: boolean;
  resolvedIncludes: string[];
  missingIncludes: string[];
  findings: EaAuditFinding[];
  metrics: {
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    magicNumberProtected: boolean;
    stopLevelChecked: boolean;
    newBarGated: boolean;
    lotNormalized: boolean;
    indicatorCleanup: boolean;
  };
};

type FileCorpusEntry = {
  path: string;
  content: string;
  lines: string[];
};

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function baseName(p: string): string {
  const norm = normalizeRelPath(p);
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function findLocation(
  corpus: FileCorpusEntry[],
  pattern: RegExp,
): { file: string | null; line: number | null } {
  for (const entry of corpus) {
    for (let i = 0; i < entry.lines.length; i++) {
      if (pattern.test(entry.lines[i])) {
        return { file: entry.path, line: i + 1 };
      }
    }
  }
  return { file: null, line: null };
}

function detectProgramType(entryCode: string, entryFileName = 'StrategyEA.mq5'): EaProgramType {
  if (/\.mqh$/i.test(entryFileName) && !/\bOn(?:Init|Tick|Start|Calculate)\s*\(/i.test(entryCode)) {
    return 'header';
  }
  if (/#property\s+indicator_/i.test(entryCode) || /\bint\s+OnCalculate\s*\(/i.test(entryCode)) {
    return 'indicator';
  }
  if (/\bvoid\s+OnStart\s*\(/i.test(entryCode) && !/\bvoid\s+OnTick\s*\(/i.test(entryCode)) {
    return 'script';
  }
  return 'expert';
}

function extractDirectIncludes(code: string): Array<{ includePath: string; isSystem: boolean }> {
  const results: Array<{ includePath: string; isSystem: boolean }> = [];
  const regex = /^\s*#include\s+(<([^>]+)>|"([^"]+)")/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    if (match[2]) {
      results.push({ includePath: normalizeRelPath(match[2]), isSystem: true });
    } else if (match[3]) {
      results.push({ includePath: normalizeRelPath(match[3]), isSystem: false });
    }
  }
  return results;
}

function resolveLocalInclude(
  includePath: string,
  companionMap: Map<string, string>,
  companionBaseMap: Map<string, string>,
): string | null {
  const norm = normalizeRelPath(includePath);
  if (companionMap.has(norm)) return norm;
  const lowerNorm = norm.toLowerCase();
  for (const existing of companionMap.keys()) {
    if (existing.toLowerCase() === lowerNorm) return existing;
    if (existing.toLowerCase().endsWith(`/${lowerNorm}`)) return existing;
  }
  const bn = baseName(norm).toLowerCase();
  return companionBaseMap.get(bn) ?? null;
}

export function parseEaMetadata(
  files: EaProjectFile[],
  entryFileName?: string,
): {
  entryFile: EaProjectFile | null;
  version: string;
  author: string;
  description: string;
  language: 'mql5' | 'mql4';
  programType: EaProgramType;
  inputs: EaParsedInput[];
  includes: EaIncludeRef[];
} {
  const entry =
    files.find((f) => entryFileName && normalizeRelPath(f.path).toLowerCase() === normalizeRelPath(entryFileName).toLowerCase()) ??
    files.find((f) => /\.(mq5|mq4)$/i.test(f.name)) ??
    files[0] ??
    null;

  const entryCode = entry?.content ?? '';
  const allCode = files.map((f) => f.content).join('\n');

  const verMatch = allCode.match(/#property\s+version\s+"([^"]+)"/i);
  const copyMatch = allCode.match(/#property\s+copyright\s+"([^"]+)"/i);
  const descMatches = Array.from(entryCode.matchAll(/#property\s+description\s+"([^"]*)"/gi))
    .map((m) => m[1].trim())
    .filter(Boolean);

  const isMq4 =
    (entry ? /\.mq4$/i.test(entry.name) : false) ||
    (/\bint\s+start\s*\(/i.test(entryCode) && !/\bvoid\s+OnTick\s*\(/i.test(entryCode));

  const companionMap = new Map<string, string>();
  const companionBaseMap = new Map<string, string>();
  for (const f of files) {
    const norm = normalizeRelPath(f.path);
    companionMap.set(norm, f.content);
    const bn = baseName(norm).toLowerCase();
    if (!companionBaseMap.has(bn)) {
      companionBaseMap.set(bn, norm);
    }
  }

  const inputs: EaParsedInput[] = [];
  const seenInputs = new Set<string>();
  const includes: EaIncludeRef[] = [];
  const seenIncludes = new Set<string>();

  for (const f of files) {
    const normPath = normalizeRelPath(f.path);
    const lines = f.content.replace(/\r\n/g, '\n').split('\n');
    let currentGroup = 'General';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const groupMatch = line.match(/^input\s+group\s+"([^"]+)"/i);
      if (groupMatch) {
        currentGroup = groupMatch[1].trim();
        continue;
      }

      const incMatch = line.match(/^#include\s+(<([^>]+)>|"([^"]+)")/);
      if (incMatch) {
        const isSystem = Boolean(incMatch[2]);
        const includePath = normalizeRelPath(incMatch[2] || incMatch[3]);
        const dedupeKey = `${normPath}::${includePath}`;
        if (!seenIncludes.has(dedupeKey)) {
          seenIncludes.add(dedupeKey);
          const resolvedPath = isSystem
            ? includePath
            : resolveLocalInclude(includePath, companionMap, companionBaseMap);
          includes.push({
            includePath,
            isSystem,
            resolved: isSystem || resolvedPath !== null,
            resolvedPath: isSystem ? null : resolvedPath,
            sourceFile: normPath,
          });
        }
        continue;
      }

      const inputMatch = line.match(
        /^(?:s?input|extern)\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);\s*(?:\/\/\s*(.*))?$/,
      );
      if (inputMatch) {
        const [, type, name, defaultValue, comment = ''] = inputMatch;
        if (!seenInputs.has(name)) {
          seenInputs.add(name);
          inputs.push({
            group: currentGroup,
            type: type.trim(),
            name: name.trim(),
            defaultValue: defaultValue.trim(),
            comment: comment.trim(),
            file: normPath,
          });
        }
      }
    }
  }

  return {
    entryFile: entry,
    version: verMatch?.[1]?.trim() || '1.00',
    author: copyMatch?.[1]?.trim() || 'User',
    description: descMatches.join(' — ') || '',
    language: isMq4 ? 'mql4' : 'mql5',
    programType: detectProgramType(entryCode, entry?.name),
    inputs,
    includes,
  };
}

export function auditMql5Source(
  source: string,
  companionFiles: EaCompanionFile[] = [],
  entryFileName = 'StrategyEA.mq5',
): EaAuditReport {
  const entryNorm = normalizeRelPath(entryFileName);
  const entryCode = source.replace(/\r\n/g, '\n');

  const companionMap = new Map<string, string>();
  const companionBaseMap = new Map<string, string>();
  for (const cf of companionFiles) {
    const norm = normalizeRelPath(cf.path);
    if (norm === entryNorm) continue;
    companionMap.set(norm, cf.content.replace(/\r\n/g, '\n'));
    const bn = baseName(norm).toLowerCase();
    if (!companionBaseMap.has(bn)) {
      companionBaseMap.set(bn, norm);
    }
  }

  const corpus: FileCorpusEntry[] = [
    { path: entryNorm, content: entryCode, lines: entryCode.split('\n') },
  ];
  const visitedPaths = new Set<string>([entryNorm]);
  const resolvedIncludes: string[] = [];
  const missingIncludes: string[] = [];

  const queue: string[] = [entryCode];
  while (queue.length > 0) {
    const nextCode = queue.shift()!;
    for (const inc of extractDirectIncludes(nextCode)) {
      if (inc.isSystem) continue;
      const resolvedPath = resolveLocalInclude(inc.includePath, companionMap, companionBaseMap);
      if (resolvedPath) {
        if (!resolvedIncludes.includes(inc.includePath)) {
          resolvedIncludes.push(inc.includePath);
        }
        if (!visitedPaths.has(resolvedPath)) {
          visitedPaths.add(resolvedPath);
          const content = companionMap.get(resolvedPath) ?? '';
          corpus.push({ path: resolvedPath, content, lines: content.split('\n') });
          queue.push(content);
        }
      } else if (!missingIncludes.includes(inc.includePath)) {
        missingIncludes.push(inc.includePath);
      }
    }
  }

  // Also include any uploaded .mqh companion files not directly referenced yet so multi-file checks inspect them too.
  for (const [path, content] of companionMap.entries()) {
    if (!visitedPaths.has(path) && /\.mqh$/i.test(path)) {
      visitedPaths.add(path);
      corpus.push({ path, content, lines: content.split('\n') });
    }
  }

  const combinedCode = corpus.map((c) => c.content).join('\n');
  const totalLines = corpus.reduce((sum, c) => sum + c.lines.length, 0);
  const programType = detectProgramType(entryCode, entryFileName);
  const findings: EaAuditFinding[] = [];

  const hasOnInit =
    /\bint\s+(?:OnInit|init)\s*\(/i.test(combinedCode);
  const hasOnTick =
    /\b(?:void|int)\s+(?:OnTick|start)\s*\(/i.test(combinedCode);
  const hasOnDeinit =
    /\b(?:void|int)\s+(?:OnDeinit|deinit)\s*\(/i.test(combinedCode);
  const hasOnStart = /\bvoid\s+OnStart\s*\(/i.test(combinedCode);
  const hasOnCalculate = /\bint\s+OnCalculate\s*\(/i.test(combinedCode);
  const usesCTrade = /\bCTrade\b/.test(combinedCode);

  const magicNumberProtected =
    (/SetExpertMagicNumber\s*\(/.test(combinedCode) && /POSITION_MAGIC|DEAL_MAGIC|Magic/i.test(combinedCode)) ||
    (/\bMagic/i.test(combinedCode) && (/POSITION_MAGIC|OrderMagicNumber\s*\(/.test(combinedCode)));

  const stopLevelChecked =
    /SYMBOL_TRADE_STOPS_LEVEL/.test(combinedCode) ||
    /SYMBOL_TRADE_FREEZE_LEVEL/.test(combinedCode) ||
    /MODE_STOPLEVEL/.test(combinedCode);

  const newBarGated =
    /\biTime\s*\(/.test(combinedCode) ||
    /SeriesInfoInteger\s*\([^)]*SERIES_LASTBAR_DATE/.test(combinedCode) ||
    /\bIsNewBar\s*\(/i.test(combinedCode) ||
    /\bBars\b/.test(combinedCode);

  const lotNormalized =
    (/SYMBOL_VOLUME_STEP/.test(combinedCode) &&
      (/SYMBOL_VOLUME_MIN/.test(combinedCode) || /SYMBOL_VOLUME_MAX/.test(combinedCode))) ||
    (/MODE_LOTSTEP/.test(combinedCode) && /MODE_MINLOT/.test(combinedCode));

  const usesIndicatorHandles = /\bi(?:MA|RSI|ATR|MACD|Bands|Stochastic|ADX|Custom)\s*\(/.test(combinedCode);
  const indicatorCleanup = !usesIndicatorHandles || /IndicatorRelease\s*\(/.test(combinedCode);

  // Stub check (empty OnStart / OnTick / OnCalculate or explicit stub copyright)
  const isStub =
    /Generated stub/i.test(entryCode) ||
    /\bvoid\s+OnStart\s*\(\s*\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*\}/m.test(entryCode) ||
    /\bint\s+OnCalculate\s*\([^)]*\)\s*\{[\s\S]{0,120}\breturn\s*\(\s*rates_total\s*\)\s*;\s*\}/m.test(entryCode);

  if (isStub) {
    findings.push({
      id: 'EA-STUB-01',
      severity: 'warning',
      title: 'Minimal stub implementation detected',
      detail: `${entryNorm} defines skeleton lifecycle callbacks without active strategy, indicator, or execution logic.`,
      file: entryNorm,
      line: 1,
      recommendation: 'Complete signal evaluation and risk validation before attaching to a live or demo chart.',
    });
  }

  if (missingIncludes.length > 0) {
    const loc = findLocation(corpus, new RegExp(`#include\\s+"${missingIncludes[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    findings.push({
      id: 'EA-INC-01',
      severity: 'warning',
      title: `${missingIncludes.length} local #include module(s) not attached in workspace`,
      detail: `Missing local header files: ${missingIncludes.slice(0, 8).join(', ')}${missingIncludes.length > 8 ? ` (+${missingIncludes.length - 8} more)` : ''}. Static verification only inspects attached headers.`,
      file: loc.file ?? entryNorm,
      line: loc.line,
      recommendation: 'Upload or attach the missing .mqh files to run complete cross-module risk and execution analysis.',
    });
  }

  if (programType === 'expert') {
    if (!hasOnInit || !hasOnTick) {
      findings.push({
        id: 'EA-STRUCT-01',
        severity: 'critical',
        title: 'Missing mandatory MQL5 lifecycle entry points',
        detail: 'An Expert Advisor must define both int OnInit() and void OnTick() handlers.',
        file: entryNorm,
        line: 1,
        recommendation: 'Implement OnInit() with INIT_SUCCEEDED/INIT_PARAMETERS_INCORRECT validation and OnTick().',
      });
    }

    if (!usesCTrade && !/\bOrderSend\s*\(/.test(combinedCode)) {
      findings.push({
        id: 'EA-EXEC-01',
        severity: 'warning',
        title: 'No order execution API detected',
        detail: 'Neither <Trade\\Trade.mqh> CTrade nor OrderSend() was found across analyzed files.',
        file: entryNorm,
        line: null,
        recommendation: 'Include <Trade\\Trade.mqh> and use CTrade for structured retcode inspection.',
      });
    }

    if (usesCTrade && !/ResultRetcode\s*\(/.test(combinedCode)) {
      const loc = findLocation(corpus, /\bCTrade\b/);
      findings.push({
        id: 'EA-EXEC-02',
        severity: 'critical',
        title: 'Missing CTrade retcode & error verification',
        detail: 'CTrade calls without checking trade.ResultRetcode() == TRADE_RETCODE_DONE silently mask broker rejections and requotes.',
        file: loc.file,
        line: loc.line,
        recommendation: 'Inspect trade.ResultRetcode() and log trade.ResultRetcodeDescription() on every execution failure.',
      });
    } else if (!usesCTrade && /\bOrderSend\s*\(/.test(combinedCode) && !/\bretcode\b/i.test(combinedCode)) {
      const loc = findLocation(corpus, /\bOrderSend\s*\(/);
      findings.push({
        id: 'EA-EXEC-02',
        severity: 'warning',
        title: 'OrderSend() without MqlTradeResult.retcode verification',
        detail: 'Direct OrderSend() calls should inspect result.retcode against TRADE_RETCODE_DONE / TRADE_RETCODE_PLACED.',
        file: loc.file,
        line: loc.line,
        recommendation: 'Check if(!OrderSend(req, res) || res.retcode != TRADE_RETCODE_DONE) and handle rejections explicitly.',
      });
    }

    if (!magicNumberProtected) {
      let loc = findLocation(corpus, /Magic|PositionSelect|PositionGetTicket|OrderSend/i);
      if (!loc.file) loc = { file: entryNorm, line: null };
      findings.push({
        id: 'EA-ISOL-01',
        severity: 'critical',
        title: 'Incomplete MagicNumber position isolation',
        detail: 'Both SetExpertMagicNumber(InpMagic) and POSITION_MAGIC filtering are required so the EA never closes manual or other-EA positions.',
        file: loc.file,
        line: loc.line,
        recommendation: 'Filter every PositionSelectByTicket loop by PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==InpMagic.',
      });
    }

    if (!lotNormalized) {
      const loc = findLocation(corpus, /\b(?:lot|volume)\b/i);
      findings.push({
        id: 'EA-RISK-01',
        severity: 'critical',
        title: 'Missing broker volume step / min / max normalization',
        detail: 'Unnormalized lot sizes fail with TRADE_RETCODE_INVALID_VOLUME on live accounts with non-0.01 step sizes.',
        file: loc.file,
        line: loc.line,
        recommendation: 'Clamp lots to [SYMBOL_VOLUME_MIN, SYMBOL_VOLUME_MAX] and align to SYMBOL_VOLUME_STEP using MathRound(lots / step) * step.',
      });
    }

    if (!stopLevelChecked) {
      const loc = findLocation(corpus, /\b(?:sl|tp|StopLoss|TakeProfit)\b/i);
      findings.push({
        id: 'EA-STOP-01',
        severity: 'warning',
        title: 'No SYMBOL_TRADE_STOPS_LEVEL distance guard',
        detail: 'SL/TP distances closer than broker StopsLevel + Spread trigger error 10016 (TRADE_RETCODE_INVALID_STOPS).',
        file: loc.file,
        line: loc.line,
        recommendation: 'Enforce minDist = (SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) + spread) * _Point before Buy/Sell/PositionModify.',
      });
    }

    if (!newBarGated && hasOnTick) {
      const loc = findLocation(corpus, /void\s+OnTick/);
      findings.push({
        id: 'EA-SIGNAL-01',
        severity: 'warning',
        title: 'Tick-level evaluation without new-bar gate',
        detail: 'Running indicator crossovers on every tick without an iTime() bar lock risks multiple entries or repainting on bar 0.',
        file: loc.file,
        line: loc.line,
        recommendation: 'Evaluate entry signals on closed bar 1 once per bar using static datetime lastBarTime = iTime(_Symbol, PERIOD_CURRENT, 0).',
      });
    }

    const martingaleLoc = findLocation(corpus, /\b(?:martingale|lot_?multiplier|MathPow\s*\([^,]+,\s*loss)/i);
    if (martingaleLoc.line !== null) {
      findings.push({
        id: 'EA-RISK-02',
        severity: 'critical',
        title: 'Martingale / exponential lot escalation detected',
        detail: 'Exponential lot doubling or dynamic loss multipliers create tail blow-up risk and violate prop/account drawdown limits.',
        file: martingaleLoc.file,
        line: martingaleLoc.line,
        recommendation: 'Use fixed fractional equity risk (RiskPercent * Equity / StopDistanceValue) with a hard DailyLossCap.',
      });
    }

    if (!/SYMBOL_ASK/.test(combinedCode) && !/SymbolInfoDouble\s*\([^)]*SYMBOL_SPREAD|SYMBOL_ASK/.test(combinedCode)) {
      findings.push({
        id: 'EA-SPRD-01',
        severity: 'info',
        title: 'No explicit max-spread filter found',
        detail: 'During rollover or illiquid news spikes, wide spreads can immediately stop out tight setups.',
        file: entryNorm,
        line: null,
        recommendation: 'Add input int InpMaxSpreadPoints = 30 and reject new entries when current spread exceeds InpMaxSpreadPoints.',
      });
    }
  } else if (programType === 'script') {
    if (!hasOnStart) {
      findings.push({
        id: 'EA-STRUCT-01',
        severity: 'critical',
        title: 'Missing void OnStart() handler in MQL5 Script',
        detail: 'MQL5 Scripts require void OnStart() as the primary entry point.',
        file: entryNorm,
        line: 1,
        recommendation: 'Define void OnStart() with file/resource cleanup.',
      });
    }
    const opensFile = /\bFileOpen\s*\(/.test(combinedCode);
    if (opensFile && !/\bFileClose\s*\(/.test(combinedCode)) {
      const loc = findLocation(corpus, /\bFileOpen\s*\(/);
      findings.push({
        id: 'EA-MEM-02',
        severity: 'critical',
        title: 'FileOpen() without corresponding FileClose()',
        detail: 'Unclosed file handles lock MQL5/Files artifacts across terminal restarts.',
        file: loc.file,
        line: loc.line,
        recommendation: 'Ensure every FileOpen() branch closes the handle via FileClose() before returning.',
      });
    }
  } else if (programType === 'indicator') {
    if (!hasOnInit || !hasOnCalculate) {
      findings.push({
        id: 'EA-STRUCT-01',
        severity: 'critical',
        title: 'Missing OnInit() or OnCalculate() handler in Custom Indicator',
        detail: 'Custom Indicators require both OnInit() buffer setup and OnCalculate().',
        file: entryNorm,
        line: 1,
        recommendation: 'Implement OnInit() with SetIndexBuffer() and OnCalculate().',
      });
    }
  }

  const sleepLoc = findLocation(corpus, /\bSleep\s*\(/);
  if (sleepLoc.line !== null) {
    findings.push({
      id: 'EA-PERF-01',
      severity: 'warning',
      title: 'Blocking Sleep() inside EA execution path',
      detail: 'Sleep() stalls Strategy Tester and prevents timely trailing stop updates during fast markets.',
      file: sleepLoc.file,
      line: sleepLoc.line,
      recommendation: 'Replace blocking Sleep() calls with EventSetTimer() or GetTickCount64() non-blocking cooldowns.',
    });
  }

  if (!indicatorCleanup) {
    const loc = findLocation(corpus, /\bi(?:MA|RSI|ATR|MACD|Bands|Stochastic|ADX)\s*\(/);
    findings.push({
      id: 'EA-MEM-01',
      severity: 'warning',
      title: 'Indicator handle created without IndicatorRelease() in OnDeinit',
      detail: 'Leaked indicator handles degrade terminal memory across timeframe switches or optimization passes.',
      file: loc.file,
      line: loc.line,
      recommendation: 'Store indicator handles globally and release each handle via IndicatorRelease() inside OnDeinit().',
    });
  }

  if (programType !== 'script' && programType !== 'header' && !hasOnDeinit) {
    findings.push({
      id: 'EA-STRUCT-02',
      severity: 'info',
      title: 'Missing OnDeinit() handler',
      detail: 'Explicit OnDeinit logging helps diagnose unexpected EA unloads or parameter changes in live logs.',
      file: entryNorm,
      line: null,
      recommendation: 'Implement void OnDeinit(const int reason) to release handles and log deinitialization reason.',
    });
  }

  // Phase 1/3 Multilingual Check: flag non-ASCII comments/UI logs if mixed across modules
  const hasCyrillic = /[\u0400-\u04FF]/.test(combinedCode);
  const hasGermanTokens = /\b(?:Warnung|Schwellwert|Positionsgroesse|fehlgeschlagen|Bereit)\b/.test(combinedCode);
  if (hasCyrillic || hasGermanTokens) {
    findings.push({
      id: 'EA-LANG-01',
      severity: 'info',
      title: hasCyrillic ? 'Multilingual Cyrillic UI/Parser strings detected' : 'German operator UI strings detected',
      detail: hasCyrillic
        ? 'Contains Cyrillic string literals/comments; verify ANSI 1251 vs UTF-16 MetaEditor file encoding before compilation.'
        : 'Contains German operator messages/comments alongside English identifiers; verify consistent localization in chart panel outputs.',
      file: entryNorm,
      line: null,
      recommendation: 'Keep operator-facing messages encoded in UTF-8/UTF-16 BOM cleanly when compiling in MetaEditor.',
    });
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;

  const score = Math.max(0, Math.min(100, 100 - criticalCount * 18 - warningCount * 8 - infoCount * 3));
  const grade: EaAuditReport['grade'] =
    score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

  return {
    score,
    grade,
    programType,
    lineCount: totalLines,
    filesAnalyzed: corpus.length,
    hasOnInit,
    hasOnTick,
    hasOnDeinit,
    usesCTrade,
    resolvedIncludes,
    missingIncludes,
    findings,
    metrics: {
      criticalCount,
      warningCount,
      infoCount,
      magicNumberProtected,
      stopLevelChecked,
      newBarGated,
      lotNormalized,
      indicatorCleanup,
    },
  };
}

export type EaGeneratorSpec = {
  eaName: string;
  magicNumber: number;
  riskPercent: number;
  maxSpreadPoints: number;
  atrPeriod: number;
  atrSlMult: number;
  atrTpMult: number;
  fastEma: number;
  slowEma: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  maxDailyLossPct: number;
  trailingAtrMult: number;
};

export function generateCleanMql5Ea(spec: EaGeneratorSpec): string {
  const safeName = spec.eaName.replace(/[^A-Za-z0-9_]/g, '_') || 'Fable5_Modular_EA';
  return `//+------------------------------------------------------------------+
//|                                          ${safeName}.mq5 |
//|                     Generated by Fable 5 Intelligence Terminal   |
//|      Modular, Magic-Isolated, Spread-Guarded, Normalized MQL5 EA |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"

#include <Trade/Trade.mqh>

input ulong    InpMagicNumber     = ${Math.max(1000, Math.floor(spec.magicNumber))};
input double   InpRiskPercent     = ${spec.riskPercent.toFixed(2)};
input double   InpMaxDailyLossPct = ${spec.maxDailyLossPct.toFixed(2)};
input int      InpMaxSpreadPoints = ${Math.max(5, Math.floor(spec.maxSpreadPoints))};
input int      InpFastEmaPeriod   = ${Math.max(2, Math.floor(spec.fastEma))};
input int      InpSlowEmaPeriod   = ${Math.max(5, Math.floor(spec.slowEma))};
input int      InpRsiPeriod       = ${Math.max(2, Math.floor(spec.rsiPeriod))};
input double   InpRsiOversold     = ${spec.rsiOversold.toFixed(1)};
input double   InpRsiOverbought   = ${spec.rsiOverbought.toFixed(1)};
input int      InpAtrPeriod       = ${Math.max(2, Math.floor(spec.atrPeriod))};
input double   InpAtrSlMult       = ${spec.atrSlMult.toFixed(2)};
input double   InpAtrTpMult       = ${spec.atrTpMult.toFixed(2)};
input double   InpTrailAtrMult    = ${spec.trailingAtrMult.toFixed(2)};

CTrade   g_trade;
int      g_fastHandle = INVALID_HANDLE;
int      g_slowHandle = INVALID_HANDLE;
int      g_rsiHandle  = INVALID_HANDLE;
int      g_atrHandle  = INVALID_HANDLE;
datetime g_lastBar    = 0;
double   g_dayStartEquity = 0.0;
int      g_dayOfYear  = -1;

int OnInit()
{
   if(InpFastEmaPeriod >= InpSlowEmaPeriod || InpRiskPercent <= 0.0 || InpRiskPercent > 5.0)
   {
      Print("Invalid EA risk or EMA parameters.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(15);

   g_fastHandle = iMA(_Symbol, PERIOD_CURRENT, InpFastEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);
   g_slowHandle = iMA(_Symbol, PERIOD_CURRENT, InpSlowEmaPeriod, 0, MODE_EMA, PRICE_CLOSE);
   g_rsiHandle  = iRSI(_Symbol, PERIOD_CURRENT, InpRsiPeriod, PRICE_CLOSE);
   g_atrHandle  = iATR(_Symbol, PERIOD_CURRENT, InpAtrPeriod);

   if(g_fastHandle == INVALID_HANDLE || g_slowHandle == INVALID_HANDLE ||
      g_rsiHandle == INVALID_HANDLE  || g_atrHandle == INVALID_HANDLE)
   {
      Print("Failed to allocate indicator handles. Error=", GetLastError());
      return(INIT_FAILED);
   }

   g_dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   g_dayOfYear = dt.day_of_year;

   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   if(g_fastHandle != INVALID_HANDLE) IndicatorRelease(g_fastHandle);
   if(g_slowHandle != INVALID_HANDLE) IndicatorRelease(g_slowHandle);
   if(g_rsiHandle  != INVALID_HANDLE) IndicatorRelease(g_rsiHandle);
   if(g_atrHandle  != INVALID_HANDLE) IndicatorRelease(g_atrHandle);
   PrintFormat("${safeName} deinitialized. Reason=%d", reason);
}

double NormalizeVolume(double lots)
{
   double minVol  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxVol  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double stepVol = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(stepVol <= 0.0) stepVol = 0.01;
   double stepped = MathRound(lots / stepVol) * stepVol;
   return(NormalizeDouble(MathMax(minVol, MathMin(maxVol, stepped)), 2));
}

bool DailyLossExceeded()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   if(dt.day_of_year != g_dayOfYear)
   {
      g_dayOfYear = dt.day_of_year;
      g_dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   }
   if(g_dayStartEquity <= 0.0) return(false);
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double ddPct = ((g_dayStartEquity - eq) / g_dayStartEquity) * 100.0;
   return(ddPct >= InpMaxDailyLossPct);
}

int CountOwnPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == (long)InpMagicNumber)
      {
         count++;
      }
   }
   return(count);
}

void UpdateTrailingStops(double atr)
{
   if(InpTrailAtrMult <= 0.0 || atr <= 0.0) return;
   long stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minStopDist = (double)stopsLevel * _Point;
   double trailDist = MathMax(atr * InpTrailAtrMult, minStopDist);

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol ||
         PositionGetInteger(POSITION_MAGIC) != (long)InpMagicNumber) continue;

      long type = PositionGetInteger(POSITION_TYPE);
      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);

      if(type == POSITION_TYPE_BUY)
      {
         double targetSl = NormalizeDouble(bid - trailDist, _Digits);
         if(targetSl > sl + _Point && (bid - targetSl) >= minStopDist)
         {
            if(!g_trade.PositionModify(ticket, targetSl, tp))
               PrintFormat("Modify BUY SL failed: %d %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
         }
      }
      else if(type == POSITION_TYPE_SELL)
      {
         double targetSl = NormalizeDouble(ask + trailDist, _Digits);
         if((sl == 0.0 || targetSl < sl - _Point) && (targetSl - ask) >= minStopDist)
         {
            if(!g_trade.PositionModify(ticket, targetSl, tp))
               PrintFormat("Modify SELL SL failed: %d %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
         }
      }
   }
}

void OnTick()
{
   datetime barTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(barTime == g_lastBar) return;
   g_lastBar = barTime;

   double fast[3], slow[3], rsi[3], atr[2];
   if(CopyBuffer(g_fastHandle, 0, 1, 2, fast) < 2 ||
      CopyBuffer(g_slowHandle, 0, 1, 2, slow) < 2 ||
      CopyBuffer(g_rsiHandle,  0, 1, 2, rsi)  < 2 ||
      CopyBuffer(g_atrHandle,  0, 1, 1, atr)  < 1)
   {
      return;
   }

   UpdateTrailingStops(atr[0]);

   if(DailyLossExceeded())
   {
      Print("Daily loss guard active — skipping new entries.");
      return;
   }

   long spreadPts = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spreadPts > InpMaxSpreadPoints) return;
   if(CountOwnPositions() > 0) return;

   long stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist  = (double)(stopsLevel + 5) * _Point;
   double slDist   = MathMax(atr[0] * InpAtrSlMult, minDist);
   double tpDist   = MathMax(atr[0] * InpAtrTpMult, minDist);

   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskUsd  = equity * (InpRiskPercent / 100.0);
   double slValuePerLot = (tickSize > 0.0) ? (slDist / tickSize) * tickVal : 0.0;
   double lots = (slValuePerLot > 0.0) ? NormalizeVolume(riskUsd / slValuePerLot) : NormalizeVolume(0.01);

   bool bullCross = (fast[1] <= slow[1] && fast[0] > slow[0]) && rsi[0] < InpRsiOverbought;
   bool bearCross = (fast[1] >= slow[1] && fast[0] < slow[0]) && rsi[0] > InpRsiOversold;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   if(bullCross)
   {
      double sl = NormalizeDouble(ask - slDist, _Digits);
      double tp = NormalizeDouble(ask + tpDist, _Digits);
      if(!g_trade.Buy(lots, _Symbol, ask, sl, tp, "${safeName}_BUY") || g_trade.ResultRetcode() != TRADE_RETCODE_DONE)
         PrintFormat("Buy rejected: %d (%s)", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
   }
   else if(bearCross)
   {
      double sl = NormalizeDouble(bid + slDist, _Digits);
      double tp = NormalizeDouble(bid - tpDist, _Digits);
      if(!g_trade.Sell(lots, _Symbol, bid, sl, tp, "${safeName}_SELL") || g_trade.ResultRetcode() != TRADE_RETCODE_DONE)
         PrintFormat("Sell rejected: %d (%s)", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
   }
}
`;
}
