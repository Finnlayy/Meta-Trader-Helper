// Read-only MT5 bridge. The token is required for both ingestion and reads.
import { authorized, getSnapshot, mt5Payload, saveSnapshot } from '../../../lib/mt5';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function denied(request: Request) {
  if (!process.env.MT5_BRIDGE_TOKEN || Buffer.byteLength(process.env.MT5_BRIDGE_TOKEN) < 32)
    return Response.json({ error: 'MT5 bridge token is not configured (minimum 32 bytes).' }, { status: 503 });
  if (!authorized(request.headers.get('authorization'), process.env.MT5_BRIDGE_TOKEN))
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  return null;
}
export async function GET(request: Request) {
  const error = denied(request); if (error) return error;
  return Response.json(getSnapshot(), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  const error = denied(request); if (error) return error;
  const length = Number(request.headers.get('content-length'));
  if (length > 128000) return Response.json({ error: 'Payload too large.' }, { status: 413 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 128000) return Response.json({ error: 'Payload too large.' }, { status: 413 });
    const result = mt5Payload.safeParse(JSON.parse(text));
    if (!result.success) return Response.json({ error: 'Invalid MT5 payload.', details: result.error.flatten() }, { status: 400 });
    const snapshot = saveSnapshot(result.data);
    return Response.json({ accepted: snapshot.candles.length, receivedAt: snapshot.receivedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
}
