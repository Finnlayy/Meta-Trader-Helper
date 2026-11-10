// route.ts — MT5 MetaAPI profile/sync + MQL5 EA static audit & clean modular generator endpoint. Dependencies: metaapi, eaAudit, schema, http.
import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { auditMql5Source, generateCleanMql5Ea, type EaCompanionFile } from '../../../lib/eaAudit';
import { getEaLibraryItem } from '../../../lib/eaLibrary';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { getMetaApiConnection, saveMetaApiConnection, syncMetaApiAccount } from '../../../lib/metaapi';
import { eaAudits } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const [connection, audits] = await Promise.all([
    getMetaApiConnection(db),
    db.select().from(eaAudits).orderBy(desc(eaAudits.createdAt)).limit(20),
  ]);
  return Response.json({ connection, audits }, { headers: { 'Cache-Control': 'no-store' } });
}

const mt5PostSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('saveConnection'),
    label: z.string().max(80).optional(),
    accountId: z.string().max(120).optional(),
    region: z.string().max(40).optional(),
    platform: z.enum(['mt4', 'mt5']).optional(),
    server: z.string().max(80).optional(),
    login: z.string().max(40).optional(),
    accountType: z.enum(['demo', 'live']).optional(),
    magicNumber: z.number().int().min(1).max(999_999_999).optional(),
  }),
  z.object({ action: z.literal('syncRemote') }),
  z.object({
    action: z.literal('auditEa'),
    eaName: z.string().min(1).max(80).default('Uploaded_EA'),
    fileName: z.string().min(1).max(120).default('StrategyEA.mq5'),
    source: z.string().min(10).max(500_000),
    libraryId: z.string().max(80).optional(),
    save: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('generateEa'),
    eaName: z.string().default('Fable5_EmaRsi_EA'),
    magicNumber: z.number().int().default(505001),
    riskPercent: z.number().min(0.1).max(5).default(1.0),
    maxSpreadPoints: z.number().int().min(5).max(500).default(30),
    atrPeriod: z.number().int().min(2).max(100).default(14),
    atrSlMult: z.number().min(0.5).max(10).default(2.0),
    atrTpMult: z.number().min(0.5).max(20).default(4.0),
    fastEma: z.number().int().min(2).max(100).default(12),
    slowEma: z.number().int().min(5).max(300).default(26),
    rsiPeriod: z.number().int().min(2).max(100).default(14),
    rsiOverbought: z.number().min(50).max(95).default(70),
    rsiOversold: z.number().min(5).max(50).default(30),
    maxDailyLossPct: z.number().min(0.5).max(20).default(3.0),
    trailingAtrMult: z.number().min(0).max(10).default(1.5),
  }),
]);

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = mt5PostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid MT5 / EA request.' }, { status: 400 });

  const d = parsed.data;
  if (d.action === 'saveConnection') {
    const connection = await saveMetaApiConnection(db, d);
    return Response.json({ connection });
  }

  if (d.action === 'syncRemote') {
    const snapshot = await syncMetaApiAccount(db);
    const connection = await getMetaApiConnection(db);
    return Response.json({ snapshot, connection });
  }

  if (d.action === 'auditEa') {
    let companions: EaCompanionFile[] = [];
    if (d.libraryId) {
      const libItem = await getEaLibraryItem(db, d.libraryId);
      if (libItem) {
        companions = libItem.files
          .filter((f) => f.path !== d.fileName)
          .map((f) => ({ path: f.path, content: f.content }));
      }
    }
    const report = auditMql5Source(d.source, companions, d.fileName);
    let savedId: string | null = null;
    if (d.save) {
      savedId = `audit-${randomUUID().slice(0, 8)}`;
      await db.insert(eaAudits).values({
        id: savedId,
        eaName: d.eaName.trim(),
        fileName: d.fileName.trim(),
        language: 'mql5',
        overallScore: report.score,
        criticalIssues: report.metrics.criticalCount,
        grammarIssues: report.findings.filter((f) => f.id.startsWith('EA-LANG')).length,
        structureIssues: report.findings.filter((f) => f.id.startsWith('EA-STRUCT') || f.id.startsWith('EA-INC')).length,
        integrityIssues: report.findings.filter((f) => f.id.startsWith('EA-RISK') || f.id.startsWith('EA-ISOL')).length,
        findingsJson: report as unknown as Record<string, unknown>,
      });
    }
    const audits = await db.select().from(eaAudits).orderBy(desc(eaAudits.createdAt)).limit(20);
    return Response.json({ id: savedId, report, audits });
  }

  const code = generateCleanMql5Ea(d);
  const selfAudit = auditMql5Source(code);
  return Response.json({ code, selfAudit });
}
