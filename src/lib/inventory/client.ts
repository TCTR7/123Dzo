'use client';
import { isRecord } from '@/lib/orders/contracts';
import { parseInventoryRequest, parseInventoryResult, type ManualInventoryInput, type InventoryRequest, type InventoryResult } from './contracts';

export class InventorySubmissionError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) { super(message); }
}
function key(actorId: string) { return `123dzo-pending-inventory:${actorId}`; }
export function pendingInventory(actorId: string): InventoryRequest | null {
  const raw = localStorage.getItem(key(actorId));
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Không đọc được phiếu đang gửi. Hãy kiểm tra lịch sử kho trước khi lập phiếu mới.'); }
  const journal = parseInventoryRequest(value);
  if (!journal) throw new Error('Phiếu đang gửi không hợp lệ. Hãy kiểm tra lịch sử kho trước khi lập phiếu mới.');
  return journal;
}
export function acknowledgeInventory(actorId: string, operationId: string) {
  if (pendingInventory(actorId)?.operationId === operationId) localStorage.removeItem(key(actorId));
}
async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = isRecord(value) && isRecord(value.error) ? value.error : null;
      throw new InventorySubmissionError(typeof error?.message === 'string' ? error.message : 'Chưa xác nhận được phiếu kho.',
        typeof error?.code === 'string' ? error.code : 'INVENTORY_UNAVAILABLE', response.status);
    }
    if (!isRecord(value) || !Object.hasOwn(value, 'data')) throw new Error('Invalid inventory response');
    return value.data;
  } finally { clearTimeout(timeout); }
}
export async function submitInventory(actorId: string, input?: ManualInventoryInput): Promise<InventoryResult> {
  let journal = pendingInventory(actorId);
  const recovering = journal !== null;
  if (!journal) {
    journal = parseInventoryRequest({ operationId: crypto.randomUUID(), input });
    if (!journal) throw new Error('Vui lòng kiểm tra số lượng, giá nhập và lý do hủy.');
    // Never send if saving the retry identity failed.
    localStorage.setItem(key(actorId), JSON.stringify(journal));
  }
  try {
    let data: unknown;
    if (recovering) data = await request(`/api/admin/inventory?${new URLSearchParams({ operationId: journal.operationId })}`);
    if (!recovering || data === null) {
      try {
        data = await request('/api/admin/inventory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(journal) });
      } catch (error) {
        if (error instanceof InventorySubmissionError && error.status >= 400 && error.status < 500 &&
          ['OUT_OF_STOCK', 'INGREDIENT_NOT_FOUND', 'INVENTORY_INVALID', 'INVALID_INVENTORY', 'INVALID_REQUEST_BODY'].includes(error.code)) {
          acknowledgeInventory(actorId, journal.operationId);
        }
        throw error;
      }
    }
    const result = parseInventoryResult(data);
    if (!result || result.operationId !== journal.operationId || result.ingredientId !== journal.input.ingredientId ||
      result.quantityChange !== (journal.input.type === 'IMPORT' ? journal.input.quantity : -journal.input.quantity)) throw new Error('Invalid recovered result');
    return result;
  } catch (error) {
    if (error instanceof InventorySubmissionError) throw error;
    throw new InventorySubmissionError('Chưa xác nhận được phiếu kho. Bấm kiểm tra phiếu vừa gửi trước khi lập phiếu mới.', 'INVENTORY_UNCONFIRMED');
  }
}
