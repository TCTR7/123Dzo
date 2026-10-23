import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/orders/contracts';
import { ImageInputError, readMenuImage } from '@/lib/menu-images/validate';
import { MENU_IMAGE_BUCKET } from '@/lib/menu-images/limits';
import { parseMenuImage } from '@/lib/menu-images/contracts';
export const runtime = 'nodejs';
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(req: Request) {
  const access = await requireStaffApi(['admin']); if (access.response) return access.response;
  if (req.headers.get('origin') !== new URL(req.url).origin) return failure(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
  const id = req.headers.get('x-upload-id')?.toLowerCase();
  if (!id || !UUID.test(id)) return failure(400, 'INVALID_UPLOAD', 'Mã ảnh không hợp lệ.');
  try {
    const bytes = await readMenuImage(req), hash = createHash('sha256').update(bytes).digest('hex');
    const db = createSupabaseServiceRoleClient(), bucket = db.storage.from(MENU_IMAGE_BUCKET);
    const path = `managed/${id}.webp`, url = bucket.getPublicUrl(path).data.publicUrl;
    const args = { p_actor_id: access.staff.userId, p_id: id, p_hash: hash, p_url: url };
    const reserved = await db.rpc('fn_menu_image_upload', { ...args, p_action: 'RESERVE' });
    if (reserved.error) {
      if (reserved.error.code === '42501') return failure(403, 'FORBIDDEN', 'Bạn không còn quyền tải ảnh.');
      if (reserved.error.code === 'P1704') return failure(429, 'IMAGE_RATE_LIMIT', 'Đã đạt giới hạn 30 ảnh mỗi giờ. Vui lòng thử lại sau.');
      if (reserved.error.code === '22000' || reserved.error.code === 'P1702') return failure(409, 'UPLOAD_CONFLICT', 'Mã ảnh đã dùng hoặc đã được dọn. Vui lòng chọn lại ảnh.');
      return failure(503, 'IMAGE_UNAVAILABLE', 'Chưa xác nhận được quyền lưu ảnh.');
    }
    const image = parseMenuImage(reserved.data);
    if (!image || image.id !== id || image.path !== path || image.url !== url) return failure(503, 'IMAGE_UNAVAILABLE', 'Chưa xác nhận được ảnh tải lên.');
    if (image.state !== 'READY') {
      const uploaded = await bucket.upload(path, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
      if (uploaded.error) {
        if (String(uploaded.error.statusCode) !== '409' && uploaded.error.message !== 'The resource already exists') return failure(503, 'IMAGE_UNAVAILABLE', 'Chưa xác nhận ảnh đã tải lên. Ảnh cũ của món được giữ nguyên.');
        const existing = await bucket.download(path);
        if (existing.error || !existing.data || existing.data.size !== bytes.length || createHash('sha256').update(Buffer.from(await existing.data.arrayBuffer())).digest('hex') !== hash)
          return failure(503, 'IMAGE_UNAVAILABLE', 'Không xác minh được nội dung ảnh đã tải.');
      }
      const finalized = await db.rpc('fn_menu_image_upload', { ...args, p_action: 'READY' });
      if (finalized.error) {
        // Only a DB tombstone proves the object cannot be attached anymore.
        if (finalized.error.code === 'P1702') await bucket.remove([path]);
        return failure(503, 'IMAGE_UNAVAILABLE', 'Ảnh chưa được xác nhận. Ảnh cũ của món được giữ nguyên.');
      }
      const ready = parseMenuImage(finalized.data);
      if (!ready || ready.id !== id || ready.url !== url || ready.state !== 'READY') return failure(503, 'IMAGE_UNAVAILABLE', 'Chưa xác nhận được kết quả tải ảnh.');
    }
    return NextResponse.json({ data: { id, url } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ImageInputError) return failure(error.status, 'INVALID_IMAGE', error.message);
    return failure(503, 'IMAGE_UNAVAILABLE', 'Chưa xác nhận ảnh tải lên. Vui lòng chọn lại ảnh để thử lại.');
  }
}
