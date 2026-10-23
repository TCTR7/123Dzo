import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readAdminAnalytics } from '@/lib/data/analytics';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  const access = await requireStaffApi(['admin']);
  if (access.response) return access.response;
  const params = new URL(req.url).searchParams;
  const start = params.get('start'), end = params.get('end');
  if (Array.from(params.keys()).some(key => key !== 'start' && key !== 'end') ||
    (start !== null || end !== null) && (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end))) {
    return NextResponse.json({ error: 'INVALID_RANGE' }, { status: 400, headers });
  }
  try {
    const data = await readAdminAnalytics(start && end ? { p_start_date: new Date(start).toISOString(), p_end_date: new Date(end).toISOString() } : undefined);
    return NextResponse.json({ data }, { headers });
  } catch { return NextResponse.json({ error: 'KPI_UNAVAILABLE' }, { status: 503, headers }); }
}
