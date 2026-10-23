'use client';
import { isRecord } from '@/lib/orders/contracts';
import { parseBeerReturn, parseBeerReturnResult, type BeerReturnRequest, type BeerReturnResult } from './contracts';
export class BeerReturnError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) { super(message); }
}
function key(actor: string) { return `123dzo-pending-return:${actor}`; }
export function pendingBeerReturn(actor: string): BeerReturnRequest | null {
  const raw = localStorage.getItem(key(actor));
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Không đọc được lượt trả bia. Nhờ quản lý kiểm tra trước khi trả tiếp.'); }
  const input = parseBeerReturn(value);
  if (!input) throw new Error('Lượt trả bia đang lưu không hợp lệ. Nhờ quản lý đối soát.');
  return input;
}
export function acknowledgeBeerReturn(actor: string, operationId: string) {
  if (pendingBeerReturn(actor)?.operationId === operationId) localStorage.removeItem(key(actor));
}
async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = isRecord(data) && isRecord(data.error) ? data.error : null;
      throw new BeerReturnError(typeof error?.message === 'string' ? error.message : 'Chưa xác nhận trả bia.',
        typeof error?.code === 'string' ? error.code : 'RETURN_UNAVAILABLE', response.status);
    }
    if (!isRecord(data) || !Object.hasOwn(data, 'data')) throw new Error('Invalid return response');
    return data.data;
  } finally { clearTimeout(timer); }
}
export async function submitBeerReturn(actor: string, draft?: Omit<BeerReturnRequest, 'operationId'>): Promise<BeerReturnResult> {
  let journal = pendingBeerReturn(actor);
  const recovering = journal !== null;
  if (!journal) {
    journal = parseBeerReturn({ ...draft, operationId: crypto.randomUUID() });
    if (!journal) throw new Error('Kiểm tra số lượng và xác nhận bia, đồ uống còn nguyên chưa sử dụng.');
    localStorage.setItem(key(actor), JSON.stringify(journal));
  }
  try {
    let data: unknown;
    if (recovering) data = await request(`/api/staff/returns?${new URLSearchParams({ sessionId: journal.sessionId, operationId: journal.operationId })}`);
    if (!recovering || data === null) {
      try { data = await request('/api/staff/returns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(journal) }); }
      catch (error) {
        if (error instanceof BeerReturnError && error.status >= 400 && error.status < 500 &&
          ['INVALID_RETURN', 'INVALID_REQUEST_BODY', 'RETURN_NOT_FOUND', 'SESSION_NOT_ACTIVE', 'RETURN_CHANGED', 'RETURN_NOT_ALLOWED', 'RETURN_PROVENANCE_MISSING', 'INVENTORY_INVALID'].includes(error.code)) {
          acknowledgeBeerReturn(actor, journal.operationId);
        }
        throw error;
      }
    }
    const result = parseBeerReturnResult(data);
    if (!result || result.operationId !== journal.operationId || result.sessionId !== journal.sessionId || result.orderItemId !== journal.orderItemId ||
      result.remainingQuantity !== journal.expectedQuantity - journal.quantity) throw new Error('Invalid recovered return');
    return result;
  } catch (error) {
    if (error instanceof BeerReturnError) throw error;
    throw new BeerReturnError('Chưa xác nhận được trả bia. Kiểm tra lượt vừa gửi trước khi tạo lượt mới.', 'RETURN_UNCONFIRMED');
  }
}
