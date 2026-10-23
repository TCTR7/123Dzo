import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { WebPushSubscriptionPayload } from '@/types/database.types';

interface SubscribeRequestBody {
  subscription?: WebPushSubscriptionPayload;
  staffId?: string;
}

/**
 * POST /api/push/subscribe
 * Lưu PushSubscription của thiết bị nhân viên vào bảng staff_profiles (Mục 9.2 PRD_SPEC.md)
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    const body = (await req.json()) as SubscribeRequestBody;

    const targetStaffId = userId ?? body.staffId;
    if (!targetStaffId) {
      return NextResponse.json(
        { error: 'Chưa xác thực tài khoản nhân viên' },
        { status: 401 }
      );
    }

    if (
      !body.subscription ||
      !body.subscription.endpoint ||
      !body.subscription.keys?.p256dh ||
      !body.subscription.keys?.auth
    ) {
      return NextResponse.json(
        { error: 'Dữ liệu PushSubscription không hợp lệ' },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServiceRoleClient();

    const { data, error } = await supabase
      .from('staff_profiles')
      .update({
        push_subscription: body.subscription,
      })
      .eq('id', targetStaffId)
      .select('id, full_name, role, assigned_zone_id, is_active')
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error:
            error?.message ??
            'Không tìm thấy hồ sơ nhân sự trong staff_profiles',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      staff: data,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Lỗi lưu PushSubscription',
      },
      { status: 500 }
    );
  }
}
