import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/orders/contracts';
import { parseMenuRequest, parseMenuResult, matchesMenuResult } from '@/lib/menu/contracts';
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500 } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function handle(req: Request, lookup: boolean) {
  const access = await requireStaffApi(['kitchen', 'admin']); if (access.response) return access.response;
  if (!lookup && req.headers.get('origin') !== new URL(req.url).origin) return failure(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
  try {
    const input = lookup ? null : parseMenuRequest(await readJson(req, 16384));
    const operationId = lookup ? new URL(req.url).searchParams.get('operationId') : input?.operationId;
    if (!operationId || !UUID.test(operationId) || (!lookup && !input)) return failure(400, 'INVALID_MENU_ACTION', 'Thông tin thực đơn không hợp lệ.');
    if (input && input.action !== 'AVAILABILITY' && access.staff.role !== 'admin') return failure(403, 'FORBIDDEN', 'Chỉ quản lý được sửa thông tin thực đơn.');
    const args = { p_actor_id: access.staff.userId, p_operation_id: operationId.toLowerCase() };
    const db = createSupabaseServiceRoleClient();
    const { data, error } = input ? await db.rpc('fn_menu_action', { ...args, p_command: {
      action: input.action, id: input.id, item: input.item ? { ...input.item } : null, expected: input.expected ? { ...input.expected } : null,
    } }) : await db.rpc('fn_get_menu_action_operation', args);
    if (error) {
      const map: Record<string, [number, string, string]> = {
        '42501': [403, 'FORBIDDEN', 'Bạn không còn quyền thay đổi thực đơn.'],
        P1501: [409, 'MENU_NOT_FOUND', 'Món không còn tồn tại. Tải lại thực đơn để kiểm tra.'],
        P1502: [409, 'MENU_CHANGED', 'Món vừa được người khác sửa. Tải lại và kiểm tra trước khi lưu.'],
        P1503: [409, 'MENU_HISTORY', 'Món đã có lịch sử gọi. Hãy tạm ngừng bán hoặc tạo món mới khi đổi loại, trạm hay liên kết kho.'],
        P1703: [409, 'MENU_IMAGE_NOT_READY', 'Ảnh chưa được xác nhận hoặc đã được dọn. Vui lòng tải lại ảnh trước khi lưu món.'],
        '23505': [409, 'MENU_EXISTS', 'Mã món đã tồn tại. Hãy tải lại và kiểm tra.'],
        '23503': [409, 'INVALID_MENU_REFERENCE', 'Món đang có lịch sử tham chiếu hoặc nguyên liệu không còn tồn tại.'],
        '22023': [400, 'INVALID_MENU_ACTION', 'Thông tin thực đơn không hợp lệ.'],
        '22000': [409, 'OPERATION_CONFLICT', 'Mã thao tác đã dùng cho nội dung khác. Hãy đối soát lượt trước.'],
      };
      return failure(...(map[error.code] ?? [503, 'MENU_ACTION_UNAVAILABLE', 'Chưa xác nhận thay đổi thực đơn. Kiểm tra lượt vừa gửi.']));
    }
    if (lookup && data === null) return NextResponse.json({ data: null }, { headers: { 'Cache-Control': 'no-store' } });
    const result = parseMenuResult(data);
    if (!result || result.operationId !== args.p_operation_id || (input && !matchesMenuResult(result, input))) return failure(503, 'MENU_ACTION_UNAVAILABLE', 'Chưa xác nhận được kết quả thay đổi thực đơn.');
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status, 'INVALID_REQUEST_BODY', error.message);
    return failure(503, 'MENU_ACTION_UNAVAILABLE', 'Chưa xác nhận thay đổi thực đơn. Kiểm tra lượt vừa gửi.');
  }
}
export function POST(req: Request) { return handle(req, false); }
export function GET(req: Request) { return handle(req, true); }
