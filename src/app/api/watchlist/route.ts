// route.ts — durable watchlist CRUD and batch CCXT live quote refresh. Dependencies: schema, market, http.
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { checkSameOrigin, requireDb } from '../../../lib/http';
import { fetchMarket } from '../../../lib/market';
import { watchlistItems } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const refresh = new URL(request.url).searchParams.get('refresh') === 'true';
  const items = await db.select().from(watchlistItems).orderBy(asc(watchlistItems.createdAt));

  if (refresh && items.length > 0) {
    const updatedItems = [];
    for (const item of items) {
      if (item.assetClass === 'CRYPTO' || item.symbol.includes('/')) {
        const snap = await fetchMarket(item.symbol, db);
        if (snap.status === 'LIVE' && typeof snap.last === 'number') {
          const [upd] = await db
            .update(watchlistItems)
            .set({
              lastPrice: snap.last,
              bid: snap.bid ?? null,
              ask: snap.ask ?? null,
              changePct: snap.changePct ?? null,
              volume: snap.volume ?? null,
              venue: snap.venue ?? null,
              lastUpdatedAt: new Date(),
            })
            .where(eq(watchlistItems.id, item.id))
            .returning();
          updatedItems.push(upd ?? item);
          continue;
        }
      }
      updatedItems.push(item);
    }
    return Response.json({ items: updatedItems }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return Response.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
}

const createSchema = z.object({
  symbol: z.string().min(2).max(24),
  exchange: z.string().min(2).max(16).default('CRYPTO'),
  assetClass: z.string().min(2).max(16).default('CRYPTO'),
  displayName: z.string().max(80).optional(),
  notes: z.string().max(300).optional(),
  pinned: z.boolean().optional(),
});

export async function POST(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid watchlist payload.' }, { status: 400 });

  const sym = parsed.data.symbol.trim().toUpperCase();
  const id = `wl-${randomUUID().slice(0, 8)}`;
  const [created] = await db
    .insert(watchlistItems)
    .values({
      id,
      symbol: sym,
      exchange: parsed.data.exchange.trim().toUpperCase(),
      assetClass: parsed.data.assetClass.trim().toUpperCase(),
      displayName: parsed.data.displayName?.trim() || sym,
      notes: parsed.data.notes?.trim() || '',
      pinned: parsed.data.pinned ?? false,
    })
    .returning();

  return Response.json({ item: created }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originErr = checkSameOrigin(request);
  if (originErr) return originErr;
  const { db, errorResponse } = await requireDb();
  if (!db) return errorResponse!;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing watchlist item id.' }, { status: 400 });
  await db.delete(watchlistItems).where(eq(watchlistItems.id, id));
  return Response.json({ deleted: true, id });
}
