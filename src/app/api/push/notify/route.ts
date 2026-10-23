import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';

/** Notifications originate from committed outbox jobs, never caller-selected recipients. */
export async function POST(_req: Request) {
  const access = await requireStaffApi(['staff', 'kitchen', 'admin']);
  if (access.response) return access.response;
  return NextResponse.json({ error: 'USE_COMMITTED_OUTBOX' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
