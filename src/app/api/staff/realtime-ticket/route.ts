import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { issueRealtimeTicket } from '@/lib/realtime/ticket';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Origin, Cookie' };
export async function POST(req: Request) {
  const access = await requireStaffApi(['staff', 'kitchen', 'admin']);
  if (access.response) { access.response.headers.set('Cache-Control', 'private, no-store'); return access.response; }
  if (req.headers.get('origin') !== new URL(req.url).origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
  try {
    return NextResponse.json(issueRealtimeTicket({ kind: access.staff.role, actor: access.staff.userId }), { headers });
  } catch { return NextResponse.json({ error: 'REALTIME_UNAVAILABLE' }, { status: 503, headers }); }
}
