import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { isRecord } from '@/lib/orders/contracts';
import { parsePushSubscription, validPushEndpoint } from '@/lib/notifications/subscription';
const headers = { 'Cache-Control': 'no-store' };
async function handle(req: Request, remove: boolean) {
  const access = await requireStaffApi(['staff', 'admin']);
  if (access.response) return access.response;
  if (req.headers.get('origin') !== new URL(req.url).origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers });
  try {
    const body = await readJson(req, 4096);
    if (!isRecord(body)) return NextResponse.json({ error: 'INVALID_SUBSCRIPTION' }, { status: 400, headers });
    if (body.staffId !== undefined && body.staffId !== access.staff.userId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403, headers });
    const subscription = remove ? null : parsePushSubscription(body.subscription);
    const endpoint = remove && typeof body.endpoint === 'string' && validPushEndpoint(body.endpoint) ? body.endpoint : null;
    if (remove ? !endpoint || Object.keys(body).some(key => key !== 'endpoint' && key !== 'staffId') : !subscription || Object.keys(body).some(key => key !== 'subscription' && key !== 'staffId')) {
      return NextResponse.json({ error: 'INVALID_SUBSCRIPTION' }, { status: 400, headers });
    }
    const { error } = await createSupabaseServiceRoleClient().rpc('fn_set_push_subscription', {
      p_actor_id: access.staff.userId, p_subscription: subscription ? { endpoint: subscription.endpoint, keys: { ...subscription.keys } } : null, p_expected_endpoint: endpoint,
    });
    if (error) return NextResponse.json({ error: 'SUBSCRIPTION_UNAVAILABLE' }, { status: error.code === '42501' ? 403 : 503, headers });
    return NextResponse.json({ success: true }, { headers });
  } catch (error) { return NextResponse.json({ error: 'SUBSCRIPTION_UNAVAILABLE' }, { status: error instanceof RequestBodyError ? error.status : 503, headers }); }
}
export function POST(req: Request) { return handle(req, false); }
export function DELETE(req: Request) { return handle(req, true); }
