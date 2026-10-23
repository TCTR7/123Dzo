import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

/**
 * GET /api/cron/keep-alive
 * Endpoint nhẹ để GitHub Actions ping định kỳ mỗi 3 ngày chống ngủ đông (Auto-Pause) cho Supabase Free Tier (Mục 9.2 PRD_SPEC.md)
 */
export async function GET() {
  try {
    const supabase = createSupabaseServiceRoleClient();
    const { count, error } = await supabase
      .from('zones')
      .select('id', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json(
        { status: 'error', message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: 'alive',
      zonesCount: count ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'Keep-alive error',
      },
      { status: 500 }
    );
  }
}
