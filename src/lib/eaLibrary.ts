// eaLibrary.ts — Persistent MT4/MT5 Expert Advisor library (Google Drive library + custom file uploads + multi-file audit/inspector). Dependencies: schema, bootstrap, eaAudit.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import type { AppDatabase } from './bootstrap';
import { auditMql5Source, parseEaMetadata, type EaAuditReport } from './eaAudit';
import {
  auditLog,
  eaAudits,
  eaLibrary,
  type EaIncludeRef,
  type EaParsedInput,
  type EaProjectFile,
} from './schema';

const ALLOWED_EA_EXTENSIONS = new Set(['.mq5', '.mq4', '.mqh', '.set', '.mqproj', '.md', '.txt']);
const MAX_SINGLE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_BYTES = 10 * 1024 * 1024;

export type BundledEaManifestItem = {
  id: string;
  dirName: string;
  name: string;
  category: string;
  entryFileName: string;
  description: string;
};

export const BUNDLED_DRIVE_EAS: BundledEaManifestItem[] = [
  {
    id: 'drive-scalpsnipper',
    dirName: 'ScalpSnipper',
    name: 'ScalpSnipper ONNX EA',
    category: 'ONNX Scalper',
    entryFileName: 'ScalpSnipper.mq5',
    description: 'Production-ready modular ONNX Expert Advisor with inputs, spread/volume risk guard, HUD display, and Default .set preset.',
  },
  {
    id: 'drive-ki-ai-super-trader',
    dirName: 'KI_AI_Super_Trader',
    name: 'KI_AI_Super_Trader',
    category: 'Regime AI',
    entryFileName: 'KI_AI_Super_Trader.mq5',
    description: 'Regime-switching ONNX AI Trader with Core execution/risk/session/exit modules, daily loss kill switch, and chart UI.',
  },
  {
    id: 'drive-vizionai-profitgtx',
    dirName: 'VizionAI_ProfitGTX',
    name: 'VizionAI ProfitGTX v7.10',
    category: 'Neural & Signal',
    entryFileName: 'profitgtx.mq5',
    description: 'QuarterTheory x VIZION modular EA combining 26 .mqh headers: AI Gateway, NeuralNet logger, NewsEngine, SignalCoordinator, and Fib setups.',
  },
  {
    id: 'drive-architect-main',
    dirName: 'Architect_Main',
    name: 'The Architect V2.0',
    category: 'Multi-Strategy',
    entryFileName: 'Architect_Main.mq5',
    description: 'Four-strategy adaptive EA (TrendFollow, MeanReversion, ORB, Pullback) with Walk-Forward Optimizer, TQA Filter, Swap Calendar, Telegram, and fast_json.',
  },
  {
    id: 'drive-ki-ai-trader',
    dirName: 'KI_AI_TRADER',
    name: 'KI_AI_TRADER v1.1',
    category: 'Regime AI',
    entryFileName: 'KI_AI_TRADER.mq5',
    description: 'Foundational Regime-Adaptive AI Strategy selector EA.',
  },
  {
    id: 'drive-neuropro-converter',
    dirName: 'NeuroPro_Converter',
    name: 'NeuroPro Converter',
    category: 'Utility / Script',
    entryFileName: 'NeuroPro Converter.mq5',
    description: 'MQL5 utility script translating Windows-1251 NeuroPro sigmoid/syndrome formulas into compilable MQL5 expressions.',
  },
  {
    id: 'drive-tqa-analyzer',
    dirName: 'TQA_Analyzer',
    name: 'TQA_Analyzer',
    category: 'Utility / Indicator',
    entryFileName: 'TQA_Analyzer.mq5',
    description: 'Separate-window MQL5 custom indicator scaffold for Trade Quality Analysis.',
  },
  {
    id: 'drive-godvisn-training',
    dirName: 'Godvisn_Predictive_Training',
    name: 'godvisnPredictiveTraining',
    category: 'Utility / Script',
    entryFileName: 'godvisnPredictiveTraining.mq5',
    description: 'Godvisn Analytics predictive model training MQL5 script entrypoint.',
  },
];

export type EaLibrarySummary = {
  id: string;
  name: string;
  slug: string;
  sourceKind: string;
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
  createdAt: Date;
  updatedAt: Date;
};

export type EaLibraryDetail = EaLibrarySummary & {
  files: EaProjectFile[];
  inputs: EaParsedInput[];
  includes: EaIncludeRef[];
  lastAudit: EaAuditReport | null;
};

export function decodeEaTextBuffer(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.subarray(2).toString('utf16le');
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    const swapped = Buffer.alloc(raw.length - 2);
    for (let i = 2; i + 1 < raw.length; i += 2) {
      swapped[i - 2] = raw[i + 1];
      swapped[i - 1] = raw[i];
    }
    return swapped.toString('utf16le');
  }
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return raw.subarray(3).toString('utf8');
  }
  // Heuristic UTF-16LE without BOM (frequent in MetaEditor .set/.mq5 exports)
  const sampleLen = Math.min(raw.length, 64);
  if (sampleLen >= 4) {
    let oddNulls = 0;
    for (let i = 1; i < sampleLen; i += 2) {
      if (raw[i] === 0) oddNulls++;
    }
    if (oddNulls >= Math.floor(sampleLen / 4)) {
      return raw.toString('utf16le');
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return raw.toString('latin1');
  }
}

export function classifyEaFileKind(fileName: string): EaProjectFile['kind'] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mq5') || lower.endsWith('.mq4')) return 'ea';
  if (lower.endsWith('.mqh')) return 'header';
  if (lower.endsWith('.set')) return 'set';
  return 'other';
}

export function slugifyEaName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'ea-project'
  );
}

function sanitizeRelPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');
}

async function readDirectoryFilesRecursively(rootDir: string, baseDir = rootDir): Promise<EaProjectFile[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const collected: EaProjectFile[] = [];

  for (const entry of entries) {
    const abs = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await readDirectoryFilesRecursively(abs, baseDir);
      collected.push(...sub);
    } else if (entry.isFile()) {
      const rel = sanitizeRelPath(relative(baseDir, abs));
      const ext = extname(entry.name).toLowerCase();
      if (!ALLOWED_EA_EXTENSIONS.has(ext)) continue;
      const buf = await readFile(abs);
      const content = decodeEaTextBuffer(buf);
      collected.push({
        path: rel,
        name: basename(rel),
        kind: classifyEaFileKind(entry.name),
        size: Buffer.byteLength(content, 'utf8'),
        content,
      });
    }
  }

  return collected.sort((a, b) => a.path.localeCompare(b.path));
}

function buildEaRecordFields(params: {
  id: string;
  name: string;
  sourceKind: 'library' | 'uploaded' | 'generated';
  category: string;
  description?: string;
  preferredEntryFileName?: string;
  files: EaProjectFile[];
}) {
  const meta = parseEaMetadata(params.files, params.preferredEntryFileName);
  const entryFile = meta.entryFile ?? params.files[0];
  const companionFiles = params.files
    .filter((f) => f.path !== entryFile?.path)
    .map((f) => ({ path: f.path, content: f.content }));

  const auditReport = entryFile
    ? auditMql5Source(entryFile.content, companionFiles, entryFile.path)
    : null;

  return {
    id: params.id,
    name: params.name.trim(),
    slug: slugifyEaName(params.name),
    sourceKind: params.sourceKind,
    category: params.category.trim() || 'Custom EA',
    entryFileName: entryFile?.path ?? 'StrategyEA.mq5',
    version: meta.version,
    author: meta.author,
    description: (params.description ?? '').trim() || meta.description || `${entryFile?.name ?? params.name} (${meta.language.toUpperCase()})`,
    language: meta.language,
    fileCount: params.files.length,
    filesJson: params.files,
    inputsJson: meta.inputs,
    includesJson: meta.includes,
    lastAuditScore: auditReport?.score ?? null,
    lastAuditGrade: auditReport?.grade ?? null,
    lastAuditJson: auditReport as unknown as Record<string, unknown> | null,
    updatedAt: new Date(),
  };
}

function rowToSummary(row: typeof eaLibrary.$inferSelect): EaLibrarySummary {
  const includes = row.includesJson ?? [];
  const localIncludes = includes.filter((inc) => !inc.isSystem);
  const resolvedLocal = localIncludes.filter((inc) => inc.resolved);
  const files = row.filesJson ?? [];

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sourceKind: row.sourceKind,
    category: row.category,
    entryFileName: row.entryFileName,
    version: row.version,
    author: row.author,
    description: row.description,
    language: row.language,
    fileCount: row.fileCount,
    inputsCount: (row.inputsJson ?? []).length,
    resolvedIncludes: resolvedLocal.length,
    totalLocalIncludes: localIncludes.length,
    hasSetPreset: files.some((f) => f.kind === 'set'),
    lastAuditScore: row.lastAuditScore ?? null,
    lastAuditGrade: row.lastAuditGrade ?? null,
    filePaths: files.map((f) => f.path),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToDetail(row: typeof eaLibrary.$inferSelect): EaLibraryDetail {
  return {
    ...rowToSummary(row),
    files: row.filesJson ?? [],
    inputs: row.inputsJson ?? [],
    includes: row.includesJson ?? [],
    lastAudit: (row.lastAuditJson as EaAuditReport | null) ?? null,
  };
}

const seededDbInstances = new WeakSet<object>();

export async function seedBundledDriveLibrary(db: AppDatabase, forceOverwrite = false): Promise<number> {
  const libRoot = join(process.cwd(), 'ea_library');
  if (!existsSync(libRoot)) return 0;

  let seededCount = 0;
  for (const item of BUNDLED_DRIVE_EAS) {
    const projectDir = join(libRoot, item.dirName);
    if (!existsSync(projectDir)) continue;

    if (!forceOverwrite) {
      const existing = await db.select({ id: eaLibrary.id }).from(eaLibrary).where(eq(eaLibrary.id, item.id)).limit(1);
      if (existing.length > 0) continue;
    }

    const files = await readDirectoryFilesRecursively(projectDir);
    if (files.length === 0) continue;

    const record = buildEaRecordFields({
      id: item.id,
      name: item.name,
      sourceKind: 'library',
      category: item.category,
      description: item.description,
      preferredEntryFileName: item.entryFileName,
      files,
    });

    await db
      .insert(eaLibrary)
      .values({ ...record, createdAt: new Date() })
      .onConflictDoUpdate({
        target: eaLibrary.id,
        set: {
          name: record.name,
          slug: record.slug,
          category: record.category,
          entryFileName: record.entryFileName,
          version: record.version,
          author: record.author,
          description: record.description,
          language: record.language,
          fileCount: record.fileCount,
          filesJson: record.filesJson,
          inputsJson: record.inputsJson,
          includesJson: record.includesJson,
          lastAuditScore: record.lastAuditScore,
          lastAuditGrade: record.lastAuditGrade,
          lastAuditJson: record.lastAuditJson,
          updatedAt: record.updatedAt,
        },
      });
    seededCount++;
  }

  seededDbInstances.add(db);
  return seededCount;
}

export async function listEaLibrary(db: AppDatabase): Promise<EaLibrarySummary[]> {
  if (!seededDbInstances.has(db)) {
    await seedBundledDriveLibrary(db, false);
  }
  const rows = await db
    .select()
    .from(eaLibrary)
    .orderBy(desc(eaLibrary.updatedAt));

  return rows.map(rowToSummary);
}

export async function getEaLibraryItem(db: AppDatabase, id: string): Promise<EaLibraryDetail | null> {
  if (!seededDbInstances.has(db)) {
    await seedBundledDriveLibrary(db, false);
  }
  const rows = await db.select().from(eaLibrary).where(eq(eaLibrary.id, id)).limit(1);
  if (rows.length === 0) return null;
  return rowToDetail(rows[0]);
}

export function validateAndPrepareUploadedFiles(
  rawFiles: Array<{ path: string; bufferOrText: Buffer | string }>,
): { validFiles: EaProjectFile[]; skippedFiles: Array<{ path: string; reason: string }> } {
  const validFiles: EaProjectFile[] = [];
  const skippedFiles: Array<{ path: string; reason: string }> = [];
  const dedupe = new Set<string>();
  let totalBytes = 0;

  for (const item of rawFiles) {
    const cleanPath = sanitizeRelPath(item.path);
    if (!cleanPath) continue;
    const ext = extname(cleanPath).toLowerCase();
    if (!ALLOWED_EA_EXTENSIONS.has(ext)) {
      skippedFiles.push({
        path: cleanPath,
        reason: ext === '.ex5' || ext === '.ex4'
          ? 'Compiled binary (.ex5/.ex4) skipped — upload source .mq5/.mq4/.mqh/.set for audit'
          : `Unsupported extension "${ext || 'none'}"`,
      });
      continue;
    }

    const rawBytes =
      typeof item.bufferOrText === 'string'
        ? Buffer.byteLength(item.bufferOrText, 'utf8')
        : item.bufferOrText.byteLength;

    if (rawBytes === 0) {
      skippedFiles.push({ path: cleanPath, reason: 'Empty file' });
      continue;
    }
    if (rawBytes > MAX_SINGLE_FILE_BYTES) {
      skippedFiles.push({ path: cleanPath, reason: 'Exceeds 2 MB per-file limit' });
      continue;
    }
    if (totalBytes + rawBytes > MAX_TOTAL_UPLOAD_BYTES) {
      skippedFiles.push({ path: cleanPath, reason: 'Exceeds 10 MB total upload limit' });
      continue;
    }

    const content =
      typeof item.bufferOrText === 'string' ? item.bufferOrText : decodeEaTextBuffer(item.bufferOrText);
    const key = cleanPath.toLowerCase();
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    totalBytes += rawBytes;
    validFiles.push({
      path: cleanPath,
      name: basename(cleanPath),
      kind: classifyEaFileKind(cleanPath),
      size: Buffer.byteLength(content, 'utf8'),
      content,
    });
  }

  return { validFiles, skippedFiles };
}

export async function createOrSaveEaLibraryEntry(
  db: AppDatabase,
  input: {
    name?: string;
    sourceKind?: 'uploaded' | 'generated';
    category?: string;
    description?: string;
    entryFileName?: string;
    files: EaProjectFile[];
  },
): Promise<EaLibraryDetail> {
  if (input.files.length === 0) {
    throw new Error('At least one valid .mq5, .mq4, .mqh, or .set file is required.');
  }

  const primaryGuess =
    input.files.find((f) => f.path === input.entryFileName) ??
    input.files.find((f) => f.kind === 'ea') ??
    input.files[0];

  const defaultName = primaryGuess.name.replace(/\.(mq5|mq4|mqh|set|txt|md)$/i, '');
  const id = `ea-${randomUUID().slice(0, 8)}`;

  const record = buildEaRecordFields({
    id,
    name: input.name?.trim() || defaultName,
    sourceKind: input.sourceKind ?? 'uploaded',
    category: input.category?.trim() || (input.sourceKind === 'generated' ? 'Generated Modular EA' : 'Custom Upload'),
    description: input.description,
    preferredEntryFileName: primaryGuess.path,
    files: input.files,
  });

  await db.insert(eaLibrary).values({ ...record, createdAt: new Date() });

  await db.insert(auditLog).values({
    actor: 'operator',
    action: input.sourceKind === 'generated' ? 'ea_generated_saved' : 'ea_uploaded',
    details: {
      id: record.id,
      name: record.name,
      entryFileName: record.entryFileName,
      fileCount: record.fileCount,
      auditScore: record.lastAuditScore,
    },
  });

  if (record.lastAuditJson) {
    const audit = record.lastAuditJson as unknown as EaAuditReport;
    await db.insert(eaAudits).values({
      id: `audit-${randomUUID().slice(0, 8)}`,
      eaName: record.name,
      fileName: record.entryFileName,
      language: record.language,
      overallScore: audit.score,
      criticalIssues: audit.metrics.criticalCount,
      grammarIssues: audit.findings.filter((f) => f.id.startsWith('EA-LANG')).length,
      structureIssues: audit.findings.filter((f) => f.id.startsWith('EA-STRUCT') || f.id.startsWith('EA-INC')).length,
      integrityIssues: audit.findings.filter((f) => f.id.startsWith('EA-RISK') || f.id.startsWith('EA-ISOL')).length,
      findingsJson: record.lastAuditJson,
    });
  }

  const created = await getEaLibraryItem(db, id);
  if (!created) throw new Error('Failed to load newly saved EA.');
  return created;
}

export async function attachFilesToEaLibraryEntry(
  db: AppDatabase,
  id: string,
  newFiles: EaProjectFile[],
): Promise<EaLibraryDetail> {
  const existing = await getEaLibraryItem(db, id);
  if (!existing) {
    throw new Error('EA not found in library.');
  }

  const mergedMap = new Map<string, EaProjectFile>();
  for (const f of existing.files) {
    mergedMap.set(f.path.toLowerCase(), f);
  }
  for (const nf of newFiles) {
    mergedMap.set(nf.path.toLowerCase(), nf);
  }

  const mergedFiles = Array.from(mergedMap.values()).sort((a, b) => a.path.localeCompare(b.path));
  const record = buildEaRecordFields({
    id: existing.id,
    name: existing.name,
    sourceKind: existing.sourceKind as 'library' | 'uploaded' | 'generated',
    category: existing.category,
    description: existing.description,
    preferredEntryFileName: existing.entryFileName,
    files: mergedFiles,
  });

  await db
    .update(eaLibrary)
    .set({
      fileCount: record.fileCount,
      filesJson: record.filesJson,
      inputsJson: record.inputsJson,
      includesJson: record.includesJson,
      lastAuditScore: record.lastAuditScore,
      lastAuditGrade: record.lastAuditGrade,
      lastAuditJson: record.lastAuditJson,
      updatedAt: new Date(),
    })
    .where(eq(eaLibrary.id, id));

  await db.insert(auditLog).values({
    actor: 'operator',
    action: 'ea_files_attached',
    details: { id, addedCount: newFiles.length, totalFiles: mergedFiles.length, score: record.lastAuditScore },
  });

  return (await getEaLibraryItem(db, id))!;
}

export async function auditEaLibraryEntry(
  db: AppDatabase,
  id: string,
  updatedEntrySource?: string,
): Promise<EaLibraryDetail> {
  const existing = await getEaLibraryItem(db, id);
  if (!existing) {
    throw new Error('EA not found in library.');
  }

  const files = existing.files.map((f) =>
    updatedEntrySource !== undefined && f.path === existing.entryFileName
      ? { ...f, content: updatedEntrySource, size: Buffer.byteLength(updatedEntrySource, 'utf8') }
      : f,
  );

  const record = buildEaRecordFields({
    id: existing.id,
    name: existing.name,
    sourceKind: existing.sourceKind as 'library' | 'uploaded' | 'generated',
    category: existing.category,
    description: existing.description,
    preferredEntryFileName: existing.entryFileName,
    files,
  });

  await db
    .update(eaLibrary)
    .set({
      version: record.version,
      author: record.author,
      filesJson: record.filesJson,
      inputsJson: record.inputsJson,
      includesJson: record.includesJson,
      lastAuditScore: record.lastAuditScore,
      lastAuditGrade: record.lastAuditGrade,
      lastAuditJson: record.lastAuditJson,
      updatedAt: new Date(),
    })
    .where(eq(eaLibrary.id, id));

  if (record.lastAuditJson) {
    const audit = record.lastAuditJson as unknown as EaAuditReport;
    await db.insert(eaAudits).values({
      id: `audit-${randomUUID().slice(0, 8)}`,
      eaName: record.name,
      fileName: record.entryFileName,
      language: record.language,
      overallScore: audit.score,
      criticalIssues: audit.metrics.criticalCount,
      grammarIssues: audit.findings.filter((f) => f.id.startsWith('EA-LANG')).length,
      structureIssues: audit.findings.filter((f) => f.id.startsWith('EA-STRUCT') || f.id.startsWith('EA-INC')).length,
      integrityIssues: audit.findings.filter((f) => f.id.startsWith('EA-RISK') || f.id.startsWith('EA-ISOL')).length,
      findingsJson: record.lastAuditJson,
    });
  }

  return (await getEaLibraryItem(db, id))!;
}

export async function deleteEaLibraryEntry(db: AppDatabase, id: string): Promise<boolean> {
  const existing = await getEaLibraryItem(db, id);
  if (!existing) return false;
  await db.delete(eaLibrary).where(eq(eaLibrary.id, id));
  await db.insert(auditLog).values({
    actor: 'operator',
    action: 'ea_deleted',
    details: { id, name: existing.name, sourceKind: existing.sourceKind },
  });
  return true;
}

export function deriveBacktestHintFromEa(ea: EaLibraryDetail): {
  eaName: string;
  presetId: 'ema_crossover' | 'rsi_reversion' | 'supertrend_momentum' | 'bollinger_breakout';
  slPct: number;
  tpPct: number;
} {
  const fullText = `${ea.name} ${ea.description} ${ea.inputs.map((i) => i.name).join(' ')}`.toLowerCase();
  let presetId: 'ema_crossover' | 'rsi_reversion' | 'supertrend_momentum' | 'bollinger_breakout' = 'ema_crossover';
  if (fullText.includes('bollinger')) presetId = 'bollinger_breakout';
  else if (fullText.includes('rsi') || fullText.includes('reversion') || fullText.includes('scalp')) presetId = 'rsi_reversion';
  else if (fullText.includes('supertrend') || fullText.includes('orb') || fullText.includes('momentum')) presetId = 'supertrend_momentum';

  let slPct = 3.0;
  let tpPct = 6.0;
  for (const inp of ea.inputs) {
    const val = Number.parseFloat(inp.defaultValue);
    if (!Number.isFinite(val) || val <= 0) continue;
    const n = inp.name.toLowerCase();
    if ((n.includes('dailyloss') || n.includes('stoploss')) && val <= 15) {
      slPct = Math.min(15, Math.max(0.5, val));
    }
    if ((n.includes('takeprofit') || n.includes('rr_ratio')) && val <= 25) {
      tpPct = Math.min(25, Math.max(1.0, val));
    }
  }

  return { eaName: ea.name, presetId, slPct, tpPct };
}
