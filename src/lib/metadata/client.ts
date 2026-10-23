'use client';
import { isRecord } from '@/lib/orders/contracts';
import { parseMetadataRequest, parseMetadataResult, matchesMetadataResult, type MetadataCommand, type MetadataRequest, type MetadataResult } from './contracts';
export class MetadataError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 0) { super(message); }
}
function key(actor: string) { return `123dzo-pending-metadata:${actor}`; }
export function pendingMetadata(actor: string): MetadataRequest | null {
  const raw = localStorage.getItem(key(actor)); if (!raw) return null;
  let value: unknown;
  try { value=JSON.parse(raw); } catch { throw new Error('Không đọc được thay đổi danh mục đang lưu. Nhờ quản lý đối soát trước khi làm tiếp.'); }
  const input=parseMetadataRequest(value); if (!input) throw new Error('Thay đổi danh mục đang lưu không hợp lệ. Nhờ quản lý kiểm tra.');
  return input;
}
export function acknowledgeMetadata(actor: string, operationId: string) {
  if (pendingMetadata(actor)?.operationId===operationId) localStorage.removeItem(key(actor));
}
async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal});
    const payload: unknown=await response.json();
    if (!response.ok) {
      const error=isRecord(payload)&&isRecord(payload.error)?payload.error:null;
      throw new MetadataError(typeof error?.message==='string'?error.message:'Chưa xác nhận thay đổi danh mục.',typeof error?.code==='string'?error.code:'METADATA_UNAVAILABLE',response.status);
    }
    if (!isRecord(payload)||!Object.hasOwn(payload,'data')) throw new Error('Invalid item action response');
    return payload.data;
  } finally {clearTimeout(timer);}
}
export async function submitMetadata(actor: string, command?: MetadataCommand): Promise<MetadataResult> {
  let journal=pendingMetadata(actor); const recovering=journal!==null;
  if (!journal) {
    journal=parseMetadataRequest({...command,operationId:crypto.randomUUID()});
    if (!journal) throw new Error('Vui lòng kiểm tra tên, đơn vị tính, định mức hoặc khu vực trước khi lưu.');
    localStorage.setItem(key(actor),JSON.stringify(journal));
  }
  try {
    let data: unknown;
    if (recovering) data=await request(`/api/admin/metadata?${new URLSearchParams({operationId:journal.operationId})}`);
    if (!recovering||data===null) {
      try { data=await request('/api/admin/metadata',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(journal)}); }
      catch(error) {
        if (error instanceof MetadataError&&error.status>=400&&error.status<500&&
          ['INVALID_METADATA','INVALID_REQUEST_BODY','METADATA_NOT_FOUND','METADATA_CHANGED','INGREDIENT_UNIT_IN_USE','TABLE_IN_USE','METADATA_REFERENCED','METADATA_EXISTS'].includes(error.code)) acknowledgeMetadata(actor,journal.operationId);
        throw error;
      }
    }
    const result=parseMetadataResult(data);
    if (!result||!matchesMetadataResult(result,journal)) throw new Error('Invalid recovered result');
    return result;
  } catch(error) {
    if (error instanceof MetadataError) throw error;
    throw new MetadataError('Chưa xác nhận thay đổi danh mục. Kiểm tra lượt vừa gửi trước khi tạo lượt mới.','METADATA_UNCONFIRMED');
  }
}
