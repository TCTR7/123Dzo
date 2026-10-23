import 'server-only';
import { NextResponse } from 'next/server';
import { requireStaffApi } from '@/lib/auth/staff-guard';
import { readJson, RequestBodyError } from '@/lib/api/read-json';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { UUID, isRecord } from '@/lib/orders/contracts';
import { parseSessionAction, parseSessionActionResult } from './contracts';
function failure(status: number, code: string, message: string, totalAmount?: number) {
  return NextResponse.json({ error: { code, message, retryable: status >= 500, ...(totalAmount === undefined ? {} : { totalAmount }) } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function handleSessionAction(req: Request, mode: 'staff' | 'customer', lookup: boolean) {
  let actor: string | null = null;
  if (mode === 'staff') { const access = await requireStaffApi(['staff', 'admin']); if (access.response) return access.response; actor = access.staff.userId; }
  const token = mode === 'customer' ? req.headers.get('x-session-token') : null;
  if (mode === 'customer' && (!token || token.length > 256)) return failure(403, 'FORBIDDEN', 'Mã phiên không hợp lệ.');
  if (!lookup && req.headers.get('origin') !== new URL(req.url).origin) return failure(403, 'INVALID_ORIGIN', 'Nguồn yêu cầu không hợp lệ.');
  try {
    const input = lookup ? null : parseSessionAction(await readJson(req));
    const query = new URL(req.url).searchParams;
    const operationId = lookup ? query.get('operationId') : input?.operationId;
    const sessionId = lookup ? query.get('sessionId') : input && 'sessionId' in input.input ? input.input.sessionId : null;
    if (!operationId || !UUID.test(operationId) || (!lookup && !input) ||
      (mode === 'customer' && ((!lookup && input?.action !== 'REQUEST_BILL') || !sessionId || !UUID.test(sessionId)))) return failure(400, 'INVALID_SESSION_ACTION', 'Thông tin thao tác bàn không hợp lệ.');
    const db = createSupabaseServiceRoleClient();
    const { data, error } = input
      ? await db.rpc('fn_session_action', { p_actor_id: actor, p_session_token: token, p_operation_id: operationId.toLowerCase(), p_action: input.action, p_input: { ...input.input } })
      : await db.rpc('fn_get_session_action_operation', { p_actor_id: actor, p_session_token: token, p_session_id: mode === 'customer' ? sessionId! : null, p_operation_id: operationId.toLowerCase() });
    if (error) {
      const map: Record<string, [number, string, string]> = {
        '42501': [403, 'FORBIDDEN', 'Không còn quyền thao tác bàn này.'], P0002: [404, 'SESSION_NOT_FOUND', 'Không tìm thấy bàn hoặc phiên.'],
        P1001: [409, 'SESSION_NOT_ACTIVE', 'Phiên đã đóng hoặc chưa hoạt động.'], P1301: [409, 'TABLE_OCCUPIED', 'Bàn đã có khách. Hãy tải lại sơ đồ bàn.'],
        P1302: [409, 'SESSION_CHANGED', 'Bàn hoặc người phụ trách đã thay đổi. Hãy tải lại trước khi thao tác.'],
        P1303: [409, 'ASSIGNEE_UNAVAILABLE', 'Nhân viên nhận bàn chưa sẵn sàng.'], P1304: [409, 'BILL_ALREADY_REQUESTED', 'Bàn đã yêu cầu tính tiền.'],
        P1305: [409, 'UNRESOLVED_ITEMS', 'Còn món chưa phục vụ hoặc chưa xử lý. Không thể đóng bill.'], P1306: [409, 'BILL_CHANGED', 'Tổng bill đã thay đổi. Kiểm tra và xác nhận lại tiền đã nhận.'],
        P1102: [409, 'BILL_INVALID', 'Số liệu bill cần quản lý kiểm tra.'], '22023': [400, 'INVALID_SESSION_ACTION', 'Thông tin thao tác bàn không hợp lệ.'],
        '22000': [409, 'OPERATION_CONFLICT', 'Mã thao tác đã dùng cho nội dung khác. Hãy đối soát lượt trước.'],
      };
      let totalAmount: number | undefined;
      if (error.code === 'P1306') { try { const quote: unknown = JSON.parse(error.details); if (isRecord(quote) && typeof quote.totalAmount === 'number' && Number.isFinite(quote.totalAmount) && quote.totalAmount >= 0) totalAmount = quote.totalAmount; } catch { /* no dependency detail leak */ } }
      const details: [number, string, string] = map[error.code] ?? [503, 'SESSION_ACTION_UNAVAILABLE', 'Chưa xác nhận được thao tác. Hãy kiểm tra lượt vừa gửi.'];
      return failure(...details, totalAmount);
    }
    if (lookup && data === null) return NextResponse.json({ data: null }, { headers: { 'Cache-Control': 'no-store' } });
    const result = parseSessionActionResult(data);
    if (!result || result.operationId !== operationId.toLowerCase() || (input && result.action !== input.action) ||
      (sessionId && result.sessionId !== sessionId.toLowerCase()) || (mode === 'customer' && result.action !== 'REQUEST_BILL')) return failure(503, 'SESSION_ACTION_UNAVAILABLE', 'Chưa xác nhận được kết quả thao tác.');
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof RequestBodyError) return failure(error.status, 'INVALID_REQUEST_BODY', error.message);
    return failure(503, 'SESSION_ACTION_UNAVAILABLE', 'Chưa xác nhận được thao tác. Hãy kiểm tra lượt vừa gửi.');
  }
}
