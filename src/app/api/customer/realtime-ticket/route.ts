import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { issueRealtimeTicket } from '@/lib/realtime/ticket';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Origin, x-session-token', 'Referrer-Policy': 'no-referrer' };
export async function POST(req: Request) {
  if (req.headers.get('origin') !== new URL(req.url).origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
  const token = req.headers.get('x-session-token');
  if (!token || token.length > 256 || /\s/.test(token)) return NextResponse.json({ error: 'SESSION_UNAVAILABLE' }, { status: 404, headers });
  if (process.env.NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED !== 'true') return NextResponse.json({ error: 'REALTIME_DISABLED' }, { status: 503, headers });
  try {
    const { data, error } = await createSupabaseServiceRoleClient().from('table_sessions')
      .select('id').eq('session_token', token).eq('session_type', 'DINE_IN').in('status', ['ACTIVE', 'REQUEST_BILL']).maybeSingle();
    if (error) throw new Error('READ_UNAVAILABLE');
    if (!data) return NextResponse.json({ error: 'SESSION_UNAVAILABLE' }, { status: 404, headers });
    return NextResponse.json(issueRealtimeTicket({ kind: 'session', actor: data.id }), { headers });
  } catch { return NextResponse.json({ error: 'REALTIME_UNAVAILABLE' }, { status: 503, headers }); }
}
