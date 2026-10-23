'use client';
import { isRecord } from '@/lib/orders/contracts';
import { parseMenuRequest, parseMenuResult, matchesMenuResult, type MenuCommand, type MenuRequest, type MenuResult } from './contracts';
export class MenuActionError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) { super(message); }
}
function key(actor: string) { return `123dzo-pending-menu-action:${actor}`; }
export function pendingMenuAction(actor: string): MenuRequest | null {
  const raw = localStorage.getItem(key(actor)); if (!raw) return null;
  let value: unknown;
  try { value=JSON.parse(raw); } catch { throw new Error('Không đọc được thay đổi thực đơn đang lưu. Nhờ quản lý đối soát trước khi làm tiếp.'); }
  const input=parseMenuRequest(value); if (!input) throw new Error('Thay đổi thực đơn đang lưu không hợp lệ. Nhờ quản lý kiểm tra.');
  return input;
}
export function acknowledgeMenuAction(actor: string, operationId: string) {
  if (pendingMenuAction(actor)?.operationId===operationId) localStorage.removeItem(key(actor));
}
async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal});
    const payload: unknown=await response.json();
    if (!response.ok) {
      const error=isRecord(payload)&&isRecord(payload.error)?payload.error:null;
      throw new MenuActionError(typeof error?.message==='string'?error.message:'Chưa xác nhận thay đổi thực đơn.',typeof error?.code==='string'?error.code:'MENU_ACTION_UNAVAILABLE',response.status);
    }
    if (!isRecord(payload)||!Object.hasOwn(payload,'data')) throw new Error('Invalid item action response');
    return payload.data;
  } finally {clearTimeout(timer);}
}
export async function submitMenuAction(actor: string, command?: MenuCommand): Promise<MenuResult> {
  let journal=pendingMenuAction(actor); const recovering=journal!==null;
  if (!journal) {
    journal=parseMenuRequest({...command,operationId:crypto.randomUUID()});
    if (!journal) throw new Error('Vui lòng kiểm tra tên, giá, thời gian nấu, đường dẫn ảnh và liên kết kho trước khi lưu.');
    localStorage.setItem(key(actor),JSON.stringify(journal));
  }
  try {
    let data: unknown;
    if (recovering) data=await request(`/api/staff/menu-actions?${new URLSearchParams({operationId:journal.operationId})}`);
    if (!recovering||data===null) {
      try { data=await request('/api/staff/menu-actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(journal)}); }
      catch(error) {
        if (error instanceof MenuActionError&&error.status>=400&&error.status<500&&
          ['INVALID_MENU_ACTION','INVALID_REQUEST_BODY','MENU_NOT_FOUND','MENU_CHANGED','MENU_HISTORY','MENU_EXISTS','INVALID_MENU_REFERENCE','MENU_IMAGE_NOT_READY'].includes(error.code)) acknowledgeMenuAction(actor,journal.operationId);
        throw error;
      }
    }
    const result=parseMenuResult(data);
    if (!result||!matchesMenuResult(result,journal)) throw new Error('Invalid recovered result');
    return result;
  } catch(error) {
    if (error instanceof MenuActionError) throw error;
    throw new MenuActionError('Chưa xác nhận thay đổi thực đơn. Kiểm tra lượt vừa gửi trước khi tạo lượt mới.','MENU_ACTION_UNCONFIRMED');
  }
}
