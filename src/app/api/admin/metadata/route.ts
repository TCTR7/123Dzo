import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/orders/contracts';
import { parseMetadataRequest, parseMetadataResult, matchesMetadataResult } from '@/lib/metadata/contracts';
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500 } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function handle(req: Request, lookup: boolean) {
  const access = await requireStaffApi(['admin']); if (access.response) return access.response;
  if (!lookup && req.headers.get('origin') !== new URL(req.url).origin) return failure(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
  try {
    const input = lookup ? null : parseMetadataRequest(await readJson(req, 8192));
    const operationId = lookup ? new URL(req.url).searchParams.get('operationId') : input?.operationId;
    if (!operationId || !UUID.test(operationId) || (!lookup && !input)) return failure(400, 'INVALID_METADATA', 'Thông tin danh mục không hợp lệ.');
    const args = { p_actor_id: access.staff.userId, p_operation_id: operationId.toLowerCase() };
    const db = createSupabaseServiceRoleClient();
    const { data, error } = input ? await db.rpc('fn_admin_metadata_action', { ...args, p_command: {
      resource: input.resource, action: input.action, id: input.id, item: input.item ? { ...input.item } : null, expected: input.expected ? { ...input.expected } : null,
    } }) : await db.rpc('fn_get_admin_metadata_operation', args);
    if (error) {
      const map: Record<string, [number, string, string]> = {
        '42501': [403, 'FORBIDDEN', 'Bạn không còn quyền quản lý danh mục.'],
        P1601: [409, 'METADATA_NOT_FOUND', 'Dữ liệu không còn tồn tại. Hãy tải lại.'],
        P1602: [409, 'METADATA_CHANGED', 'Dữ liệu vừa được người khác sửa. Hãy tải lại và kiểm tra trước khi lưu.'],
        P1603: [409, 'INGREDIENT_UNIT_IN_USE', 'Nguyên liệu đã có tồn, phiếu kho hoặc liên kết món. Hãy tạo nguyên liệu mới khi đổi đơn vị tính.'],
        P1604: [409, 'TABLE_IN_USE', 'Bàn đang có phiên phục vụ. Chỉ sửa hoặc xóa sau khi đóng bàn.'],
        '23503': [409, 'METADATA_REFERENCED', 'Dữ liệu đang được tham chiếu hoặc khu vực không còn tồn tại. Chuyển bàn/nhân sự trước khi xóa khu vực; giữ bàn đã có lịch sử.'],
        '23505': [409, 'METADATA_EXISTS', 'Mã danh mục đã tồn tại. Hãy tải lại và kiểm tra.'],
        '22023': [400, 'INVALID_METADATA', 'Thông tin danh mục không hợp lệ.'],
        '22000': [409, 'OPERATION_CONFLICT', 'Mã thao tác đã dùng cho nội dung khác. Hãy đối soát lượt trước.'],
      };
      return failure(...(map[error.code] ?? [503, 'METADATA_UNAVAILABLE', 'Chưa xác nhận thay đổi danh mục. Kiểm tra lượt vừa gửi.']));
    }
    if (lookup && data === null) return NextResponse.json({ data: null }, { headers: { 'Cache-Control': 'no-store' } });
    const result = parseMetadataResult(data);
    if (!result || result.operationId !== args.p_operation_id || (input && !matchesMetadataResult(result, input))) return failure(503, 'METADATA_UNAVAILABLE', 'Chưa xác nhận kết quả thay đổi danh mục.');
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status, 'INVALID_REQUEST_BODY', error.message);
    return failure(503, 'METADATA_UNAVAILABLE', 'Chưa xác nhận thay đổi danh mục. Kiểm tra lượt vừa gửi.');
  }
}
export function POST(req: Request) { return handle(req, false); }
export function GET(req: Request) { return handle(req, true); }
