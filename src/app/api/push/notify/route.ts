import { NextResponse } from 'next/server';
import webpush, { type PushSubscription } from 'web-push';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type {
  StaffProfileRow,
  WebPushSubscriptionPayload,
} from '@/types/database.types';

interface NotifyRequestBody {
  orderItemId?: string;
  orderItemIds?: string[];
  sessionId?: string;
  title?: string;
  body?: string;
  isFallbackZoneBroadcast?: boolean;
}

const FALLBACK_DELAY_MS = 2 * 60 * 1000; // 2 phút theo Mục 3.2 PRD_SPEC.md

function configureWebPush(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject =
    process.env.VAPID_SUBJECT ?? 'mailto:admin@123dzo.vn';

  if (!publicKey || !privateKey) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function isValidPushSubscription(
  sub: unknown
): sub is WebPushSubscriptionPayload {
  if (!sub || typeof sub !== 'object') return false;
  const candidate = sub as Record<string, unknown>;
  if (typeof candidate.endpoint !== 'string') return false;
  const keys = candidate.keys as Record<string, unknown> | undefined;
  return (
    Boolean(keys) &&
    typeof keys?.p256dh === 'string' &&
    typeof keys?.auth === 'string'
  );
}

async function sendWebPushToStaffList(
  staffList: StaffProfileRow[],
  payload: {
    title: string;
    body: string;
    sound: string;
    url: string;
    tag: string;
  }
): Promise<{ sentCount: number; failedCount: number }> {
  const isVapidReady = configureWebPush();
  if (!isVapidReady) {
    return { sentCount: 0, failedCount: 0 };
  }

  let sentCount = 0;
  let failedCount = 0;

  const messageString = JSON.stringify({
    title: payload.title,
    body: payload.body,
    sound: payload.sound,
    vibrate: [250, 100, 250, 100, 400],
    url: payload.url,
    tag: payload.tag,
    timestamp: Date.now(),
  });

  await Promise.all(
    staffList.map(async (staff) => {
      if (!isValidPushSubscription(staff.push_subscription)) {
        return;
      }

      const subscription: PushSubscription = {
        endpoint: staff.push_subscription.endpoint,
        keys: {
          p256dh: staff.push_subscription.keys.p256dh,
          auth: staff.push_subscription.keys.auth,
        },
      };

      try {
        await webpush.sendNotification(subscription, messageString);
        sentCount += 1;
      } catch {
        failedCount += 1;
      }
    })
  );

  return { sentCount, failedCount };
}

/**
 * Cơ chế chống sót việc (Fallback 2 phút - Mục 3.2 PRD_SPEC.md):
 * Kiểm tra lại sau 2 phút kể từ khi món chín (ready_at), nếu nhân viên phụ trách
 * chưa bấm "Đã bưng ra" (served_at IS NULL và status === 'READY'),
 * hệ thống tự động gửi thông báo lần 2 cho toàn bộ nhân viên trong cùng Khu vực (Zone).
 */
function scheduleTwoMinuteZoneFallback(params: {
  orderItemIds: string[];
  zoneId: string | null;
  tableLabel: string;
  dishSummary: string;
}) {
  const { orderItemIds, zoneId, tableLabel, dishSummary } = params;
  if (orderItemIds.length === 0) return;

  setTimeout(async () => {
    try {
      const supabase = createSupabaseServiceRoleClient();

      const { data: unservedItems } = await supabase
        .from('order_items')
        .select('id, status, served_at')
        .in('id', orderItemIds)
        .eq('status', 'READY')
        .is('served_at', null);

      if (!unservedItems || unservedItems.length === 0) {
        // Nhân viên phụ trách đã bưng ra bàn đúng hạn (< 2 phút)
        return;
      }

      let staffQuery = supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role, assigned_zone_id, push_subscription, is_active'
        )
        .eq('is_active', true)
        .in('role', ['staff', 'admin']);

      if (zoneId) {
        staffQuery = staffQuery.eq('assigned_zone_id', zoneId);
      }

      const { data: zoneStaff } = await staffQuery;
      if (!zoneStaff || zoneStaff.length === 0) return;

      await sendWebPushToStaffList(zoneStaff, {
        title: `🚨 HỖ TRỢ BƯNG MÓN (Quá 2 phút) • ${tableLabel}`,
        body: `${dishSummary} đã chín hơn 2 phút chưa được bưng! Nhờ anh em cùng khu vực hỗ trợ.`,
        sound: '/sounds/ting-ting.mp3',
        url: '/staff',
        tag: `fallback-zone-${orderItemIds[0]}`,
      });
    } catch {
      // Bỏ qua lỗi chạy ngầm
    }
  }, FALLBACK_DELAY_MS);
}

/**
 * POST /api/push/notify
 * Gửi thông báo đẩy có âm thanh (/sounds/ting-ting.mp3) đến đúng assigned_staff_id của bàn,
 * kèm cơ chế Fallback 2 phút nhắc nhở toàn bộ Khu vực (Zone) nếu chưa bưng.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as NotifyRequestBody;
    const supabase = createSupabaseServiceRoleClient();

    const itemIds: string[] = [
      ...(body.orderItemIds ?? []),
      ...(body.orderItemId ? [body.orderItemId] : []),
    ];

    let resolvedSessionId = body.sessionId ?? null;
    let dishSummary = body.body ?? 'Món ăn đã sẵn sàng phục vụ';

    if (itemIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('id, session_id, menu_item_id, quantity')
        .in('id', itemIds);

      if (items && items.length > 0) {
        if (!resolvedSessionId) {
          resolvedSessionId = items[0]?.session_id ?? null;
        }
        const menuIds = Array.from(new Set(items.map((i) => i.menu_item_id)));
        const { data: menus } = await supabase
          .from('menu_items')
          .select('id, name')
          .in('id', menuIds);

        const menuNameMap = new Map<string, string>();
        (menus ?? []).forEach((m) => menuNameMap.set(m.id, m.name));

        dishSummary = items
          .map(
            (i) =>
              `${i.quantity}x ${menuNameMap.get(i.menu_item_id) ?? 'Món gọi'}`
          )
          .join(', ');
      }
    }

    if (!resolvedSessionId) {
      return NextResponse.json(
        { error: 'Thiếu sessionId hoặc orderItemId để định tuyến thông báo' },
        { status: 400 }
      );
    }

    const { data: session } = await supabase
      .from('table_sessions')
      .select(
        'id, session_type, table_id, assigned_staff_id, customer_name'
      )
      .eq('id', resolvedSessionId)
      .single();

    if (!session) {
      return NextResponse.json(
        { error: 'Không tìm thấy phiên bàn (table_sessions)' },
        { status: 404 }
      );
    }

    let tableLabel =
      session.session_type === 'TAKEAWAY'
        ? `Đơn Mang về (${session.customer_name ?? 'Khách'})`
        : 'Bàn nhậu';
    let tableZoneId: string | null = null;

    if (session.table_id) {
      const { data: table } = await supabase
        .from('tables')
        .select('id, table_number, zone_id')
        .eq('id', session.table_id)
        .single();

      if (table) {
        tableLabel = table.table_number;
        tableZoneId = table.zone_id;
      }
    }

    // 1. Xác định danh sách nhân viên nhận thông báo:
    // Nếu là Fallback hoặc bàn chưa gán assigned_staff_id -> gửi cho toàn bộ nhân viên trong Zone
    // Ngược lại -> chỉ gửi đúng cho nhân viên phụ trách bàn (assigned_staff_id) theo Mục 3.2
    let targetStaff: StaffProfileRow[] = [];

    if (!body.isFallbackZoneBroadcast && session.assigned_staff_id) {
      const { data: assignedStaff } = await supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role, assigned_zone_id, push_subscription, is_active'
        )
        .eq('id', session.assigned_staff_id)
        .eq('is_active', true)
        .single();

      if (assignedStaff) {
        targetStaff = [assignedStaff];
      }
    }

    // Nếu bàn chưa có assigned_staff_id hoặc nhân viên đó không active -> gửi cho nhân viên cùng Zone
    if (targetStaff.length === 0) {
      let zoneQuery = supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role, assigned_zone_id, push_subscription, is_active'
        )
        .eq('is_active', true)
        .in('role', ['staff', 'admin']);

      if (tableZoneId) {
        zoneQuery = zoneQuery.eq('assigned_zone_id', tableZoneId);
      }

      const { data: fallbackStaff } = await zoneQuery;
      targetStaff = fallbackStaff ?? [];
    }

    const notificationTitle =
      body.title ?? `🍻 MÓN CHÍN • ${tableLabel}`;
    const notificationBody = body.body ?? `${dishSummary} đã sẵn sàng tại Bếp!`;

    const pushResult = await sendWebPushToStaffList(targetStaff, {
      title: notificationTitle,
      body: notificationBody,
      sound: '/sounds/ting-ting.mp3',
      url: '/staff',
      tag: `ready-${resolvedSessionId}-${Date.now()}`,
    });

    // 2. Đặt hẹn giờ Fallback 2 phút nhắc nhở toàn bộ Khu vực nếu nhân viên phụ trách quên bưng
    if (!body.isFallbackZoneBroadcast && itemIds.length > 0) {
      scheduleTwoMinuteZoneFallback({
        orderItemIds: itemIds,
        zoneId: tableZoneId,
        tableLabel,
        dishSummary,
      });
    }

    return NextResponse.json({
      success: true,
      targetedStaffIds: targetStaff.map((s) => s.id),
      sentCount: pushResult.sentCount,
      failedCount: pushResult.failedCount,
      fallbackScheduledInSeconds:
        !body.isFallbackZoneBroadcast && itemIds.length > 0 ? 120 : 0,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Lỗi khi gửi thông báo đẩy Web Push',
      },
      { status: 500 }
    );
  }
}
