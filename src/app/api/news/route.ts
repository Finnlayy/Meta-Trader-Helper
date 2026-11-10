// route.ts — FinBERT news sentiment scoring, RSS feed ingestion, and shock alert endpoint. Dependencies: sentiment, schema, http.
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { newsFeeds, sentimentEvents } from '../../../lib/schema';
import {
  ingestNewsArticle,
  listNewsIntelligence,
  refreshRssFeeds,
  scoreTextWithFinbertModel,
} from '../../../lib/sentiment';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;
  const limit = Math.min(100, Number(new URL(request.url).searchParams.get('limit') ?? 50));
  const data = await listNewsIntelligence(db, limit);
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

const newsPostSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refreshFeeds') }),
  z.object({
    action: z.literal('scoreText'),
    text: z.string().min(3).max(4000),
    save: z.boolean().default(false),
    source: z.string().max(80).optional(),
  }),
  z.object({
    action: z.literal('addFeed'),
    name: z.string().min(2).max(60),
    url: z.string().url(),
    category: z.string().default('MARKETS'),
  }),
  z.object({
    action: z.literal('toggleFeed'),
    id: z.string().min(2),
    enabled: z.boolean(),
  }),
]);

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = newsPostSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid news request.' }, { status: 400 });

  const d = parsed.data;
  if (d.action === 'refreshFeeds') {
    const refresh = await refreshRssFeeds(db);
    const data = await listNewsIntelligence(db, 50);
    return Response.json({ refresh, ...data });
  }

  if (d.action === 'scoreText') {
    if (d.save) {
      const res = await ingestNewsArticle(db, {
        title: d.text.slice(0, 140),
        summary: d.text,
        source: d.source || 'Operator Wire',
        sourceType: 'manual',
      });
      const data = await listNewsIntelligence(db, 50);
      return Response.json({ assessment: res.assessment, saved: res.article, ...data });
    }

    const recentRows = await db
      .select({ score: sentimentEvents.score })
      .from(sentimentEvents)
      .orderBy(desc(sentimentEvents.createdAt))
      .limit(100);
    const assessment = scoreTextWithFinbertModel(
      d.text,
      recentRows.map((r) => r.score).reverse(),
    );
    return Response.json({ assessment });
  }

  if (d.action === 'addFeed') {
    const [feed] = await db
      .insert(newsFeeds)
      .values({
        id: `feed-${randomUUID().slice(0, 8)}`,
        name: d.name.trim(),
        url: d.url.trim(),
        category: d.category.trim().toUpperCase(),
        source: d.name.trim(),
        tier: 2,
        enabled: true,
        isBuiltin: false,
      })
      .returning();
    return Response.json({ feed }, { status: 201 });
  }

  await db.update(newsFeeds).set({ enabled: d.enabled }).where(eq(newsFeeds.id, d.id));
  return Response.json({ updated: true, id: d.id, enabled: d.enabled });
}
