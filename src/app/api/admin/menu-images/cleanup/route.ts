import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID, isRecord } from '@/lib/orders/contracts';
import { MENU_IMAGE_BUCKET } from '@/lib/menu-images/limits';
function failure(status: number, message: string) { return NextResponse.json({ error: { code: 'IMAGE_CLEANUP_UNAVAILABLE', message } }, { status, headers: { 'Cache-Control': 'no-store' } }); }
export async function POST(req: Request) {
  const access = await requireStaffApi(['admin']); if (access.response) return access.response;
  if (req.headers.get('origin') !== new URL(req.url).origin) return failure(403, 'Nguồn yêu cầu không hợp lệ.');
  try {
    const db = createSupabaseServiceRoleClient();
    const claimed = await db.rpc('fn_claim_menu_image_cleanup', { p_actor_id: access.staff.userId });
    if (claimed.error) return failure(claimed.error.code === '42501' ? 403 : 503, 'Chưa thể kiểm tra ảnh không dùng.');
    if (!Array.isArray(claimed.data) || claimed.data.length > 20) return failure(503, 'Kết quả kiểm tra ảnh không hợp lệ.');
    const images: { id: string; path: string }[] = [];
    for (const value of claimed.data) {
      if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id) || value.path !== `managed/${value.id}.webp`) return failure(503, 'Đường dẫn dọn ảnh không hợp lệ.');
      images.push({ id: value.id, path: value.path });
    }
    let removed = 0, failed = 0;
    for (const image of images) {
      const result = await db.storage.from(MENU_IMAGE_BUCKET).remove([image.path]);
      if (result.error) { failed++; continue; }
      const done = await db.rpc('fn_finish_menu_image_cleanup', { p_actor_id: access.staff.userId, p_id: image.id });
      if (done.error) failed++; else removed++;
    }
    return NextResponse.json({ data: { removed, failed } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return failure(503, 'Chưa xác nhận kết quả dọn ảnh. Có thể chạy lại để đối soát.'); }
}
