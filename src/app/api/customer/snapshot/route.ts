import { NextResponse } from 'next/server';
import { readDineInSnapshot } from '@/lib/data/dine-in-snapshot';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'x-session-token', 'Referrer-Policy': 'no-referrer' };
export async function GET(req: Request) {
  const token = req.headers.get('x-session-token');
  if (!token || token.length > 256 || /\s/.test(token)) return NextResponse.json({ error: 'SESSION_UNAVAILABLE' }, { status: 404, headers });
  try {
    const data = await readDineInSnapshot(token);
    if (!data) return NextResponse.json({ error: 'SESSION_UNAVAILABLE' }, { status: 404, headers });
    return NextResponse.json({ data }, { headers });
  } catch { return NextResponse.json({ error: 'SNAPSHOT_UNAVAILABLE' }, { status: 503, headers }); }
}
