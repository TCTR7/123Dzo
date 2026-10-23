import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/orders/contracts';
import { parseItemAction, parseItemActionResult, matchesItemAction } from '@/lib/item-actions/contracts';
function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500 } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function handle(req: Request, lookup: boolean) {
  const access = await requireStaffApi(['staff','kitchen','admin']); if (access.response) return access.response;
  if (!lookup && req.headers.get('origin') !== new URL(req.url).origin) return failure(403,'INVALID_ORIGIN','Nguồn yêu cầu không hợp lệ.');
  try {
    const input = lookup ? null : parseItemAction(await readJson(req,32768));
    const operationId = lookup ? new URL(req.url).searchParams.get('operationId') : input?.operationId;
    if (!operationId || !UUID.test(operationId) || (!lookup && !input)) return failure(400,'INVALID_ITEM_ACTION','Thông tin thao tác món không hợp lệ.');
    const args = { p_actor_id: access.staff.userId, p_operation_id: operationId.toLowerCase() };
    const db = createSupabaseServiceRoleClient();
    const { data, error } = input ? await db.rpc('fn_transition_order_items', { ...args, p_command: { action: input.action, reason: input.reason, items: input.items.map((row)=>({...row})) } })
      : await db.rpc('fn_get_item_action_operation', args);
    if (error) {
      const map: Record<string,[number,string,string]> = {
        '42501':[403,'FORBIDDEN','Bạn không có quyền thực hiện thao tác món này.'],
        P1001:[409,'SESSION_NOT_ACTIVE','Bàn đã đóng hoặc đơn chưa được phép chế biến.'],
        P1401:[409,'ITEM_CHANGED','Có món vừa thay đổi. Tải lại và kiểm tra toàn bộ mẻ trước khi thao tác lại.'],
        P1402:[409,'INVALID_TRANSITION','Món hoặc mẻ chưa ở trạng thái cho phép thao tác này.'],
        P1403:[409,'INVALID_ITEM_TIMESTAMPS','Mốc thời gian món cần quản lý kiểm tra.'],
        P1102:[409,'BILL_INVALID','Số liệu hóa đơn cần quản lý kiểm tra.'],
        '22023':[400,'INVALID_ITEM_ACTION','Dữ liệu thao tác món không hợp lệ.'],
        '22000':[409,'OPERATION_CONFLICT','Mã thao tác đã dùng cho nội dung khác. Hãy đối soát lượt trước.'],
      };
      const details: [number,string,string] = map[error.code] ?? [503,'ITEM_ACTION_UNAVAILABLE','Chưa xác nhận thao tác món. Hãy kiểm tra lượt vừa gửi.'];
      return failure(...details);
    }
    if (lookup && data === null) return NextResponse.json({ data: null }, { headers: { 'Cache-Control':'no-store' } });
    const result = parseItemActionResult(data);
    if (!result || result.operationId !== args.p_operation_id || (input && !matchesItemAction(result,input))) return failure(503,'ITEM_ACTION_UNAVAILABLE','Chưa xác nhận được kết quả thao tác món.');
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control':'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status,'INVALID_REQUEST_BODY',error.message);
    return failure(503,'ITEM_ACTION_UNAVAILABLE','Chưa xác nhận thao tác món. Hãy kiểm tra lượt vừa gửi.');
  }
}
export function POST(req: Request) { return handle(req,false); }
export function GET(req: Request) { return handle(req,true); }
