import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cronSecret } from '@/lib/config/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
let lastPing: number | null = null;

/**
 * GET /api/cron/keep-alive
 * Endpoint nhẹ để GitHub Actions ping định kỳ mỗi 3 ngày chống ngủ đông (Auto-Pause) cho Supabase Free Tier (Mục 9.2 PRD_SPEC.md)
 */
export async function GET(req: Request) {
  let expected: Buffer;
  try { expected = Buffer.from(`Bearer ${cronSecret()}`); }
  catch { return NextResponse.json({ error: 'CRON_NOT_CONFIGURED' }, { status: 503 }); }
  const supplied = Buffer.from(req.headers.get('authorization') ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const now = Date.now();
  if (lastPing !== null && now - lastPing < 60000) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
  lastPing = now;
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from('zones')
      .select('id').limit(1);

    if (error) {
      return NextResponse.json(
        { status: 'error', message: 'KEEP_ALIVE_UNAVAILABLE' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'KEEP_ALIVE_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
}
