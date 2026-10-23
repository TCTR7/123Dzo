import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { parseInventoryRequest, parseInventoryResult } from '@/lib/inventory/contracts';
import { UUID } from '@/lib/orders/contracts';

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500 } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function handle(req: Request, lookup: boolean) {
  const access = await requireStaffApi(['admin']);
  if (access.response) return access.response;
  if (!lookup && req.headers.get('origin') !== new URL(req.url).origin) return failure(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
  try {
    const input = lookup ? null : parseInventoryRequest(await readJson(req));
    const operationId = lookup ? new URL(req.url).searchParams.get('operationId') : input?.operationId;
    if (!operationId || !UUID.test(operationId) || (!lookup && !input)) return failure(400, 'INVALID_INVENTORY', 'Vui lòng kiểm tra số lượng, giá nhập và lý do hủy.');
    const db = createSupabaseServiceRoleClient();
    const args = { p_actor_id: access.staff.userId, p_operation_id: operationId.toLowerCase() };
    const { data, error } = lookup
      ? await db.rpc('fn_admin_get_inventory_operation', args)
      : await db.rpc('fn_admin_record_inventory', { ...args, p_input: { ...input!.input } });
    if (error) {
      const mapping: Record<string, [number, string, string]> = {
        '42501': [403, 'FORBIDDEN', 'Quyền quản lý kho đã thay đổi. Vui lòng đăng nhập lại.'],
        P0002: [404, 'INGREDIENT_NOT_FOUND', 'Nguyên liệu không còn tồn tại.'],
        P1004: [409, 'OUT_OF_STOCK', 'Tồn kho hiện tại không đủ để hủy số lượng này.'],
        P1102: [409, 'INVENTORY_INVALID', 'Dữ liệu kho cần được kiểm tra trước khi lập phiếu.'],
        '22023': [400, 'INVALID_INVENTORY', 'Thông tin phiếu kho không hợp lệ.'],
        '22000': [409, 'OPERATION_CONFLICT', 'Mã phiếu đã dùng cho nội dung khác. Hãy kiểm tra phiếu trước.'],
      };
      const details = mapping[error.code] ?? [503, 'INVENTORY_UNAVAILABLE', 'Chưa xác nhận được phiếu kho. Hãy kiểm tra phiếu vừa gửi.'];
      return failure(...details);
    }
    if (lookup && data === null) return NextResponse.json({ data: null }, { headers: { 'Cache-Control': 'no-store' } });
    const result = parseInventoryResult(data);
    if (!result || result.operationId.toLowerCase() !== operationId.toLowerCase() ||
      (input && (result.ingredientId !== input.input.ingredientId || result.quantityChange !== (input.input.type === 'IMPORT' ? input.input.quantity : -input.input.quantity)))) {
      return failure(503, 'INVENTORY_UNAVAILABLE', 'Chưa xác nhận được kết quả phiếu kho.');
    }
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status, 'INVALID_REQUEST_BODY', error.message);
    return failure(503, 'INVENTORY_UNAVAILABLE', 'Chưa xác nhận được phiếu kho. Hãy kiểm tra phiếu vừa gửi.');
  }
}
export function POST(req: Request) { return handle(req, false); }
export function GET(req: Request) { return handle(req, true); }
