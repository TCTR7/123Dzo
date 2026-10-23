'use client';
import { isRecord } from '@/lib/orders/contracts';
import { parseItemAction, parseItemActionResult, matchesItemAction, type ItemCommand, type ItemActionRequest, type ItemActionResult } from './contracts';
export class ItemActionError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) { super(message); }
}
function key(actor: string) { return `123dzo-pending-item-action:${actor}`; }
export function pendingItemAction(actor: string): ItemActionRequest | null {
  const raw = localStorage.getItem(key(actor)); if (!raw) return null;
  let value: unknown;
  try { value=JSON.parse(raw); } catch { throw new Error('Không đọc được thao tác món đang lưu. Nhờ quản lý đối soát trước khi làm tiếp.'); }
  const input=parseItemAction(value); if (!input) throw new Error('Thao tác món đang lưu không hợp lệ. Nhờ quản lý kiểm tra.');
  return input;
}
export function acknowledgeItemAction(actor: string, operationId: string) {
  if (pendingItemAction(actor)?.operationId===operationId) localStorage.removeItem(key(actor));
}
async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal});
    const payload: unknown=await response.json();
    if (!response.ok) {
      const error=isRecord(payload)&&isRecord(payload.error)?payload.error:null;
      throw new ItemActionError(typeof error?.message==='string'?error.message:'Chưa xác nhận thao tác món.',typeof error?.code==='string'?error.code:'ITEM_ACTION_UNAVAILABLE',response.status);
    }
    if (!isRecord(payload)||!Object.hasOwn(payload,'data')) throw new Error('Invalid item action response');
    return payload.data;
  } finally {clearTimeout(timer);}
}
export async function submitItemAction(actor: string, command?: ItemCommand): Promise<ItemActionResult> {
  let journal=pendingItemAction(actor); const recovering=journal!==null;
  if (!journal) {
    journal=parseItemAction({...command,operationId:crypto.randomUUID()});
    if (!journal) throw new Error('Vui lòng kiểm tra món và lý do trước khi xác nhận.');
    localStorage.setItem(key(actor),JSON.stringify(journal));
  }
  try {
    let data: unknown;
    if (recovering) data=await request(`/api/staff/item-actions?${new URLSearchParams({operationId:journal.operationId})}`);
    if (!recovering||data===null) {
      try { data=await request('/api/staff/item-actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(journal)}); }
      catch(error) {
        if (error instanceof ItemActionError&&error.status>=400&&error.status<500&&
          ['INVALID_ITEM_ACTION','INVALID_REQUEST_BODY','SESSION_NOT_ACTIVE','ITEM_CHANGED','INVALID_TRANSITION','INVALID_ITEM_TIMESTAMPS','BILL_INVALID'].includes(error.code)) acknowledgeItemAction(actor,journal.operationId);
        throw error;
      }
    }
    const result=parseItemActionResult(data);
    if (!result||!matchesItemAction(result,journal)) throw new Error('Invalid recovered result');
    return result;
  } catch(error) {
    if (error instanceof ItemActionError) throw error;
    throw new ItemActionError('Chưa xác nhận được thao tác món. Kiểm tra lượt vừa gửi trước khi tạo lượt mới.','ITEM_ACTION_UNCONFIRMED');
  }
}
