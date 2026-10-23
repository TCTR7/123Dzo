import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { isRecord, UUID } from '@/lib/orders/contracts';
import { parseNotificationStatus } from '@/lib/notifications/contracts';
const headers = { 'Cache-Control': 'no-store' };
export async function POST(req: Request) {
  const access = await requireStaffApi(['admin']);
  if (access.response) return access.response;
  if (req.headers.get('origin') !== new URL(req.url).origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
  try {
    const body = await readJson(req, 1024);
    if (!isRecord(body) || Object.keys(body).sort().join(',') !== 'expectedAttempts,id' || typeof body.id !== 'string' || !UUID.test(body.id) ||
      typeof body.expectedAttempts !== 'number' || !Number.isSafeInteger(body.expectedAttempts) || body.expectedAttempts < 8) return NextResponse.json({ error: 'INVALID_JOB' }, { status: 400, headers });
    const { data, error } = await createSupabaseServiceRoleClient().rpc('fn_admin_notification_jobs', { p_actor_id: access.staff.userId, p_retry_id: body.id, p_expected_attempts: body.expectedAttempts });
    if (error) return NextResponse.json({ error: 'JOB_RETRY_UNAVAILABLE' }, { status: error.code === '42501' ? 403 : error.code === '40001' ? 409 : 503, headers });
    const status = parseNotificationStatus(data);
    if (!status) throw new Error('INVALID_STATUS');
    return NextResponse.json({ data: status }, { headers });
  } catch (error) { return NextResponse.json({ error: 'JOB_RETRY_UNAVAILABLE' }, { status: error instanceof RequestBodyError ? error.status : 503, headers }); }
}
