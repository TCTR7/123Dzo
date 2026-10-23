import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/orders/contracts';
import { parseBeerReturn, parseBeerReturnResult } from '@/lib/returns/contracts';
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500 } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function handle(req: Request, lookup: boolean) {
  const access = await requireStaffApi(['staff', 'admin']);
  if (access.response) return access.response;
  if (!lookup && req.headers.get('origin') !== new URL(req.url).origin) return failure(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
  try {
    const input = lookup ? null : parseBeerReturn(await readJson(req));
    const params = new URL(req.url).searchParams;
    const sessionId = lookup ? params.get('sessionId') : input?.sessionId;
    const operationId = lookup ? params.get('operationId') : input?.operationId;
    if (!sessionId || !UUID.test(sessionId) || !operationId || !UUID.test(operationId) || (!lookup && !input)) return failure(400, 'INVALID_RETURN', 'Vui lòng kiểm tra dòng bia, số lượng và xác nhận hàng chưa dùng.');
    const db = createSupabaseServiceRoleClient();
    const args = { p_actor_id: access.staff.userId, p_session_id: sessionId.toLowerCase(), p_operation_id: operationId.toLowerCase() };
    const { data, error } = input
      ? await db.rpc('fn_return_beer', { ...args, p_input: { orderItemId: input.orderItemId, quantity: input.quantity, expectedQuantity: input.expectedQuantity, confirmedUnused: true } })
      : await db.rpc('fn_get_beer_return_operation', args);
    if (error) {
      const map: Record<string, [number, string, string]> = {
        '42501': [403, 'FORBIDDEN', 'Bạn không còn quyền trả bia. Vui lòng đăng nhập lại.'],
        P0002: [404, 'RETURN_NOT_FOUND', 'Không tìm thấy bàn hoặc dòng bia đã chọn.'],
        P1001: [409, 'SESSION_NOT_ACTIVE', 'Bàn đã đóng hoặc chưa được phép trả bia.'],
        P1201: [409, 'RETURN_CHANGED', 'Số lượng đã thay đổi. Hãy tải lại bàn và kiểm tra trước khi trả.'],
        P1202: [409, 'RETURN_NOT_ALLOWED', 'Chỉ trả bia, đồ uống còn nguyên đã sẵn sàng hoặc đã phục vụ.'],
        P1203: [409, 'RETURN_PROVENANCE_MISSING', 'Thiếu phiếu xuất gốc. Nhờ quản lý đối soát, không hoàn kho tự động.'],
        P1102: [409, 'INVENTORY_INVALID', 'Dữ liệu tồn hoặc giá vốn cần quản lý kiểm tra.'],
        '22023': [400, 'INVALID_RETURN', 'Thông tin trả bia không hợp lệ.'],
        '22000': [409, 'OPERATION_CONFLICT', 'Mã trả bia đã dùng cho nội dung khác. Hãy đối soát lượt trước.'],
      };
      const details: [number, string, string] = map[error.code] ?? [503, 'RETURN_UNAVAILABLE', 'Chưa xác nhận được kết quả. Hãy kiểm tra lượt trả bia vừa gửi.'];
      return failure(...details);
    }
    if (lookup && data === null) return NextResponse.json({ data: null }, { headers: { 'Cache-Control': 'no-store' } });
    const result = parseBeerReturnResult(data);
    if (!result || result.sessionId !== args.p_session_id || result.operationId !== args.p_operation_id ||
      (input && (result.orderItemId !== input.orderItemId || result.remainingQuantity !== input.expectedQuantity - input.quantity))) return failure(503, 'RETURN_UNAVAILABLE', 'Chưa xác nhận được kết quả trả bia.');
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status, 'INVALID_REQUEST_BODY', error.message);
    return failure(503, 'RETURN_UNAVAILABLE', 'Chưa xác nhận được kết quả. Hãy kiểm tra lượt trả bia vừa gửi.');
  }
}
export function POST(req: Request) { return handle(req, false); }
export function GET(req: Request) { return handle(req, true); }
