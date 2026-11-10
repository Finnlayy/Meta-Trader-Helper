// route.ts — Persistent MT4/MT5 EA Library & custom multi-file EA upload/audit/download endpoint. Dependencies: eaLibrary, http.
import { z } from 'zod';
import {
  attachFilesToEaLibraryEntry,
  auditEaLibraryEntry,
  createOrSaveEaLibraryEntry,
  deleteEaLibraryEntry,
  deriveBacktestHintFromEa,
  getEaLibraryItem,
  listEaLibrary,
  seedBundledDriveLibrary,
  validateAndPrepareUploadedFiles,
} from '../../../lib/eaLibrary';
import { checkSameOrigin, requireDb } from '../../../lib/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim();
  const download = url.searchParams.get('download')?.trim();
  const filePath = url.searchParams.get('path')?.trim();

  if (id) {
    const ea = await getEaLibraryItem(db, id);
    if (!ea) {
      return Response.json({ error: 'EA not found in library.' }, { status: 404 });
    }
    if (download === 'file') {
      const target =
        (filePath ? ea.files.find((f) => f.path === filePath || f.name === filePath) : undefined) ??
        ea.files.find((f) => f.path === ea.entryFileName) ??
        ea.files[0];
      if (!target) {
        return Response.json({ error: 'Requested file not found in EA bundle.' }, { status: 404 });
      }
      const safeDownloadName = target.name.replace(/[^A-Za-z0-9._-]/g, '_');
      return new Response(target.content, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeDownloadName}"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return Response.json(
      { ea, backtestHint: deriveBacktestHintFromEa(ea) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const eas = await listEaLibrary(db);
  return Response.json(
    {
      eas,
      stats: {
        total: eas.length,
        libraryCount: eas.filter((e) => e.sourceKind === 'library').length,
        uploadedCount: eas.filter((e) => e.sourceKind === 'uploaded').length,
        generatedCount: eas.filter((e) => e.sourceKind === 'generated').length,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const jsonActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upload'),
    name: z.string().max(120).optional(),
    category: z.string().max(80).optional(),
    description: z.string().max(1000).optional(),
    entryFileName: z.string().max(180).optional(),
    sourceKind: z.enum(['uploaded', 'generated']).optional(),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(240),
          content: z.string().min(1).max(2_000_000),
        }),
      )
      .min(1)
      .max(120),
  }),
  z.object({
    action: z.literal('attachFiles'),
    id: z.string().min(1).max(80),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(240),
          content: z.string().min(1).max(2_000_000),
        }),
      )
      .min(1)
      .max(120),
  }),
  z.object({
    action: z.literal('audit'),
    id: z.string().min(1).max(80),
    entrySource: z.string().max(2_000_000).optional(),
  }),
  z.object({
    action: z.literal('restoreLibrary'),
    forceOverwrite: z.boolean().default(false),
  }),
]);

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const rawEntries = form.getAll('files');
    const relPaths = form.getAll('paths').map((v) => String(v));
    const attachToId = String(form.get('attachToId') ?? '').trim();
    const name = String(form.get('name') ?? '').trim();
    const category = String(form.get('category') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const entryFileName = String(form.get('entryFileName') ?? '').trim();

    const preparedInput: Array<{ path: string; bufferOrText: Buffer }> = [];
    for (let i = 0; i < rawEntries.length; i++) {
      const item = rawEntries[i];
      if (!(item instanceof File)) continue;
      const buf = Buffer.from(await item.arrayBuffer());
      const path = (relPaths[i] && relPaths[i].trim()) || item.name;
      preparedInput.push({ path, bufferOrText: buf });
    }

    if (preparedInput.length === 0) {
      return Response.json({ error: 'No files selected for upload.' }, { status: 400 });
    }

    const { validFiles, skippedFiles } = validateAndPrepareUploadedFiles(preparedInput);
    if (validFiles.length === 0) {
      return Response.json(
        {
          error: skippedFiles.map((s) => `${s.path}: ${s.reason}`).join(' | ') || 'No supported .mq5/.mq4/.mqh/.set files found.',
          skippedFiles,
        },
        { status: 400 },
      );
    }

    try {
      const ea = attachToId
        ? await attachFilesToEaLibraryEntry(db, attachToId, validFiles)
        : await createOrSaveEaLibraryEntry(db, {
            name: name || undefined,
            category: category || undefined,
            description: description || undefined,
            entryFileName: entryFileName || undefined,
            sourceKind: 'uploaded',
            files: validFiles,
          });
      const eas = await listEaLibrary(db);
      return Response.json({ ea, backtestHint: deriveBacktestHintFromEa(ea), skippedFiles, eas });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'EA upload failed.' }, { status: 400 });
    }
  }

  const parsed = jsonActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid EA library payload.' }, { status: 400 });
  }

  const d = parsed.data;
  try {
    if (d.action === 'restoreLibrary') {
      const restored = await seedBundledDriveLibrary(db, d.forceOverwrite);
      const eas = await listEaLibrary(db);
      return Response.json({ restored, eas });
    }

    if (d.action === 'audit') {
      const ea = await auditEaLibraryEntry(db, d.id, d.entrySource);
      const eas = await listEaLibrary(db);
      return Response.json({ ea, backtestHint: deriveBacktestHintFromEa(ea), eas });
    }

    if (d.action === 'attachFiles') {
      const { validFiles, skippedFiles } = validateAndPrepareUploadedFiles(
        d.files.map((f) => ({ path: f.path, bufferOrText: f.content })),
      );
      if (validFiles.length === 0) {
        return Response.json({ error: 'No valid MQL source or .set files provided.' }, { status: 400 });
      }
      const ea = await attachFilesToEaLibraryEntry(db, d.id, validFiles);
      const eas = await listEaLibrary(db);
      return Response.json({ ea, backtestHint: deriveBacktestHintFromEa(ea), skippedFiles, eas });
    }

    const { validFiles, skippedFiles } = validateAndPrepareUploadedFiles(
      d.files.map((f) => ({ path: f.path, bufferOrText: f.content })),
    );
    if (validFiles.length === 0) {
      return Response.json({ error: 'No valid MQL source or .set files provided.' }, { status: 400 });
    }
    const ea = await createOrSaveEaLibraryEntry(db, {
      name: d.name,
      category: d.category,
      description: d.description,
      entryFileName: d.entryFileName,
      sourceKind: d.sourceKind ?? 'uploaded',
      files: validFiles,
    });
    const eas = await listEaLibrary(db);
    return Response.json({ ea, backtestHint: deriveBacktestHintFromEa(ea), skippedFiles, eas });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'EA operation failed.' }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const id = new URL(request.url).searchParams.get('id')?.trim();
  if (!id) {
    return Response.json({ error: 'EA id query parameter is required.' }, { status: 400 });
  }

  const deleted = await deleteEaLibraryEntry(db, id);
  if (!deleted) {
    return Response.json({ error: 'EA not found in library.' }, { status: 404 });
  }

  const eas = await listEaLibrary(db);
  return Response.json({ deleted: true, eas });
}
