'use client';
import { isRecord } from '@/lib/orders/contracts';
import { parseSessionAction, parseSessionActionResult, type SessionActionRequest, type SessionActionResult, type SessionCommand } from './contracts';
export interface SessionActionScope { mode: 'staff' | 'customer'; identity: string; token?: string }
export class SessionActionError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0, public readonly totalAmount?: number) { super(message); }
}
function key(scope: SessionActionScope) { return `123dzo-pending-session:${scope.mode}:${scope.identity}`; }
export function pendingSessionAction(scope: SessionActionScope): SessionActionRequest | null {
  const raw = localStorage.getItem(key(scope)); if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error('Không đọc được thao tác bàn đang lưu. Nhờ quản lý đối soát trước khi làm tiếp.'); }
  const request = parseSessionAction(data);
  if (!request || (scope.mode === 'customer' && (request.action !== 'REQUEST_BILL' || request.input.sessionId !== scope.identity))) throw new Error('Thao tác bàn đang lưu không hợp lệ. Nhờ quản lý kiểm tra.');
  return request;
}
export function acknowledgeSessionAction(scope: SessionActionScope, operationId: string) {
  if (pendingSessionAction(scope)?.operationId === operationId) localStorage.removeItem(key(scope));
}
async function request(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = isRecord(data) && isRecord(data.error) ? data.error : null;
      throw new SessionActionError(typeof error?.message === 'string' ? error.message : 'Chưa xác nhận thao tác.',
        typeof error?.code === 'string' ? error.code : 'SESSION_ACTION_UNAVAILABLE', response.status,
        typeof error?.totalAmount === 'number' && Number.isFinite(error.totalAmount) && error.totalAmount >= 0 ? error.totalAmount : undefined);
    }
    if (!isRecord(data) || !Object.hasOwn(data, 'data')) throw new Error('Invalid action response');
    return data.data;
  } finally { clearTimeout(timer); }
}
export async function submitSessionAction(scope: SessionActionScope, command?: SessionCommand): Promise<{ result: SessionActionResult; command: SessionCommand; recovered: boolean }> {
  let journal = pendingSessionAction(scope); const recovered = journal !== null;
  if (!journal) {
    journal = parseSessionAction({ ...command, operationId: crypto.randomUUID() });
    if (!journal || (scope.mode === 'customer' && (journal.action !== 'REQUEST_BILL' || journal.input.sessionId !== scope.identity))) throw new Error('Vui lòng kiểm tra thông tin trước khi xác nhận.');
    localStorage.setItem(key(scope), JSON.stringify(journal));
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (scope.mode === 'customer' && scope.token) headers['x-session-token'] = scope.token;
  const url = scope.mode === 'staff' ? '/api/staff/sessions' : '/api/customer/bill';
  try {
    let data: unknown;
    if (recovered) {
      const params = new URLSearchParams({ operationId: journal.operationId });
      if (scope.mode === 'customer' && 'sessionId' in journal.input) params.set('sessionId', journal.input.sessionId);
      data = await request(`${url}?${params}`, { headers });
    }
    if (!recovered || data === null) {
      try { data = await request(url, { method: 'POST', headers, body: JSON.stringify(journal) }); }
      catch (error) {
        if (error instanceof SessionActionError && error.status >= 400 && error.status < 500 &&
          ['INVALID_SESSION_ACTION', 'INVALID_REQUEST_BODY', 'SESSION_NOT_FOUND', 'SESSION_NOT_ACTIVE', 'TABLE_OCCUPIED', 'SESSION_CHANGED',
            'ASSIGNEE_UNAVAILABLE', 'BILL_ALREADY_REQUESTED', 'UNRESOLVED_ITEMS', 'BILL_CHANGED', 'BILL_INVALID'].includes(error.code)) acknowledgeSessionAction(scope, journal.operationId);
        throw error;
      }
    }
    const result = parseSessionActionResult(data);
    if (!result || result.operationId !== journal.operationId || result.action !== journal.action ||
      ('sessionId' in journal.input && result.sessionId !== journal.input.sessionId) ||
      (journal.action === 'OPEN' && result.tableId !== journal.input.tableId) ||
      (journal.action === 'TRANSFER' && result.tableId !== journal.input.targetTableId)) throw new Error('Invalid recovered action');
    return { result, command: journal, recovered };
  } catch (error) {
    if (error instanceof SessionActionError) throw error;
    throw new SessionActionError('Chưa xác nhận được thao tác bàn. Kiểm tra lượt vừa gửi trước khi thao tác lại.', 'SESSION_ACTION_UNCONFIRMED');
  }
}
