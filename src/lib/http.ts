// http.ts — same-origin request checks and JSON helpers for Next.js API routes. Dependencies: db.
import { getDb } from './db';

export function checkSameOrigin(request: Request, requireOriginHeader = false): Response | null {
  const origin = request.headers.get('origin');
  if (origin === null) {
    if (requireOriginHeader) {
      return Response.json({ error: 'Same-origin request required.' }, { status: 403 });
    }
    return null;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return Response.json({ error: 'Invalid Origin header.' }, { status: 403 });
  }

  const host = request.headers.get('host');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const allowedHosts = new Set([host, forwardedHost].filter((h): h is string => Boolean(h)));

  if (!allowedHosts.has(originHost)) {
    return Response.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  return null;
}

export async function requireDb() {
  const db = await getDb();
  if (!db) {
    return { db: null, errorResponse: Response.json({ error: 'Database unavailable.' }, { status: 503 }) };
  }
  return { db, errorResponse: null };
}
