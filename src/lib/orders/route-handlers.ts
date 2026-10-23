import 'server-only';
import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { parseOrderRequest, UUID, isRecord, parseOrderResult, type OrderLine } from './contracts';

function failure(status: number, code: string, message: string, quote?: { menuItemId: string; price: number }) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500, ...(quote ? {quote} : {}) } }, { status, headers: { 'Cache-Control':'no-store' } });
}
function rpcError(error: { code?: string; details?: string }) {
  const mapping: Record<string, [number,string,string]> = {
    '42501':[403,'FORBIDDEN','Phiên hoặc quyền truy cập không hợp lệ.'],
    P0002:[404,'SESSION_NOT_FOUND','Không tìm thấy phiên gọi món.'],
    P1001:[409,'SESSION_NOT_ACTIVE','Bàn đã dừng nhận món. Vui lòng nhờ nhân viên kiểm tra.'],
    P1002:[409,'MENU_UNAVAILABLE','Có món vừa tạm hết. Vui lòng kiểm tra lại thực đơn.'],
    P1003:[409,'PRICE_CHANGED','Giá món đã thay đổi. Vui lòng xem lại giỏ trước khi gửi.'],
    P1004:[409,'OUT_OF_STOCK','Quán không còn đủ số lượng đã chọn. Vui lòng điều chỉnh.'],
    P1005:[422,'INVENTORY_MAPPING_INVALID','Quán cần kiểm tra cấu hình món này. Vui lòng nhờ nhân viên hỗ trợ.'],
    P1006:[429,'ORDER_RATE_LIMIT','Mỗi bàn được gửi tối đa 2 lượt trong 10 giây. Vui lòng chờ rồi thử lại.'],
    '22000':[409,'OPERATION_CONFLICT','Mã gửi món đã dùng cho nội dung khác. Vui lòng kiểm tra lượt trước.'],
    '22023':[400,'INVALID_ORDER','Dữ liệu gọi món không hợp lệ.'],
  };
  const [status, code, message] = mapping[error.code ?? ''] ?? [503,'ORDER_UNAVAILABLE','Chưa xác nhận được kết quả. Vui lòng kiểm tra lượt vừa gửi.'];
  let quote: { menuItemId: string; price: number } | undefined;
  if (code === 'PRICE_CHANGED') {
    try {
      const value: unknown = JSON.parse(error.details ?? '');
      if (isRecord(value) && typeof value.menuItemId === 'string' && UUID.test(value.menuItemId) && typeof value.price === 'number' && Number.isFinite(value.price) && value.price >= 0) quote = { menuItemId:value.menuItemId, price:value.price };
    } catch { /* Invalid dependency detail is not returned to the client. */ }
  }
  return failure(status,code,message,quote);
}

export async function handleOrderRequest(req: Request, mode: 'customer' | 'staff', lookup = false) {
  let actor: string | null = null;
  if (mode === 'staff') {
    const access = await requireStaffApi(['staff','admin']);
    if (access.response) return access.response;
    actor = access.staff.userId;
  }
  const token = mode === 'customer' ? req.headers.get('x-session-token') : null;
  if (mode === 'customer' && (!token || token.length > 256)) return failure(403,'FORBIDDEN','Mã phiên không hợp lệ.');
  if (!lookup && req.headers.get('origin') !== new URL(req.url).origin) return failure(403,'INVALID_ORIGIN','Nguồn yêu cầu không hợp lệ.');
  try {
    let sessionId: string, operationId: string;
    let requestLines:OrderLine[]=[];
    if (lookup) {
      const url = new URL(req.url);
      sessionId = url.searchParams.get('sessionId') ?? '';
      operationId = url.searchParams.get('operationId') ?? '';
      if (!UUID.test(sessionId) || !UUID.test(operationId)) return failure(400,'INVALID_ORDER','Mã đối soát không hợp lệ.');
    } else {
      const lines = parseOrderRequest(await readJson(req,32768));
      if (!lines) return failure(400,'INVALID_ORDER','Dữ liệu gọi món không hợp lệ.');
      ({sessionId,operationId} = lines);
      requestLines=lines.lines;
    }
    const db = createSupabaseServiceRoleClient();
    const args = {p_session_id:sessionId,p_session_token:token,p_actor_id:actor,p_operation_id:operationId};
    const response = lookup
      ? await db.rpc('fn_get_dine_in_operation',args)
      : await db.rpc('fn_submit_dine_in_order',{...args,p_lines:requestLines.map((line) => ({...line}))});
    if (response.error) return rpcError(response.error);
    if (lookup && response.data === null) return NextResponse.json({data:null},{headers:{'Cache-Control':'no-store'}});
    const result = parseOrderResult(response.data);
    if (!result || result.sessionId.toLowerCase()!==sessionId.toLowerCase() || result.operationId.toLowerCase()!==operationId.toLowerCase()) return failure(503,'ORDER_UNAVAILABLE','Chưa xác nhận được kết quả gửi món.');
    return NextResponse.json({data:result},{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status,'INVALID_REQUEST_BODY',error.message);
    return failure(503,'ORDER_UNAVAILABLE','Chưa xác nhận được kết quả. Vui lòng kiểm tra lượt vừa gửi.');
  }
}
