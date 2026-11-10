// route.ts — operator journal & research thesis notes CRUD API. Dependencies: schema, http.
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { journalNotes } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;
  const notes = await db.select().from(journalNotes).orderBy(desc(journalNotes.updatedAt)).limit(80);
  return Response.json({ notes }, { headers: { 'Cache-Control': 'no-store' } });
}

const noteSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(140),
  symbol: z.string().max(24).default(''),
  category: z.string().max(32).default('thesis'),
  tags: z.array(z.string()).default([]),
  content: z.string().min(1).max(20_000),
  linkedRef: z.string().max(80).nullable().optional(),
});

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = noteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid journal note.' }, { status: 400 });

  const d = parsed.data;
  const id = d.id?.trim() || `note-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const [saved] = await db
    .insert(journalNotes)
    .values({
      id,
      title: d.title.trim(),
      symbol: d.symbol.trim().toUpperCase(),
      category: d.category.trim(),
      tags: d.tags,
      content: d.content,
      linkedRef: d.linkedRef ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: journalNotes.id,
      set: {
        title: d.title.trim(),
        symbol: d.symbol.trim().toUpperCase(),
        category: d.category.trim(),
        tags: d.tags,
        content: d.content,
        linkedRef: d.linkedRef ?? null,
        updatedAt: now,
      },
    })
    .returning();

  return Response.json({ note: saved }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing note id.' }, { status: 400 });
  await db.delete(journalNotes).where(eq(journalNotes.id, id));
  return Response.json({ deleted: true, id });
}
