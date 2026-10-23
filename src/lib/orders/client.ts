'use client';
import { isRecord, parseOrderRequest, parseOrderResult, type OrderLine, type OrderRequest, type OrderResult } from './contracts';

interface OrderScope { mode:'customer'|'staff'; sessionId:string; identity:string; token?:string }
export class OrderSubmissionError extends Error {
  constructor(message:string, public readonly code:string, public readonly quote?:{menuItemId:string;price:number}, public readonly status=0) { super(message); }
}
function key(scope:OrderScope) { return `123dzo-pending-order:${scope.mode}:${scope.identity}:${scope.sessionId}`; }
async function requestData(url:string,init:RequestInit):Promise<unknown> {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(()=>controller.abort(),15000);
  try { return await responseData(await fetch(url,{...init,signal:controller.signal})); }
  finally { clearTimeout(timeout); init.signal?.removeEventListener('abort',abort); }
}

/** Foreground recovery is read-only. A missing result never creates/reposts an order. */
export async function recoverOrder(scope:OrderScope,signal?:AbortSignal) {
  const journal=pendingOrder(scope);if (!journal) return null;
  const headers:Record<string,string>={};if(scope.mode==='customer'&&scope.token)headers['x-session-token']=scope.token;
  const params=new URLSearchParams({sessionId:journal.sessionId,operationId:journal.operationId});
  const data=await requestData(`/api/${scope.mode}/operation?${params}`,{headers,cache:'no-store',signal});
  if (data===null) return null;
  const result=parseOrderResult(data);
  if(!result||result.sessionId!==journal.sessionId||result.operationId!==journal.operationId)throw new Error('RECOVERY_UNAVAILABLE');
  return {result,submittedLines:journal.lines};
}
export function pendingOrder(scope:OrderScope):OrderRequest|null {
  const raw=localStorage.getItem(key(scope));
  if (!raw) return null;
  let input:unknown;
  try { input=JSON.parse(raw); } catch { throw new Error('Không đọc được lượt đang gửi. Vui lòng nhờ nhân viên kiểm tra trước khi đặt lại.'); }
  const parsed=parseOrderRequest(input);
  if (!parsed || parsed.sessionId!==scope.sessionId) throw new Error('Lượt đang gửi không hợp lệ. Vui lòng nhờ nhân viên kiểm tra.');
  return parsed;
}
export function acknowledgeOrder(scope:OrderScope, operationId:string) {
  if (pendingOrder(scope)?.operationId===operationId) localStorage.removeItem(key(scope));
}

async function responseData(response:Response):Promise<unknown> {
  const value:unknown=await response.json();
  if (!response.ok) {
    const error=isRecord(value)&&isRecord(value.error)?value.error:null;
    const code=typeof error?.code==='string'?error.code:'ORDER_UNAVAILABLE';
    const quote=error&&isRecord(error.quote)&&typeof error.quote.menuItemId==='string'&&typeof error.quote.price==='number'
      ? {menuItemId:error.quote.menuItemId,price:error.quote.price}:undefined;
    throw new OrderSubmissionError(typeof error?.message==='string'?error.message:'Chưa xác nhận được kết quả gửi món.',code,quote,response.status);
  }
  if (!isRecord(value)||!Object.hasOwn(value,'data')) throw new Error('Chưa xác nhận được kết quả gửi món.');
  return value.data;
}

export async function submitOrder(scope:OrderScope, lines:OrderLine[]):Promise<{result:OrderResult;submittedLines:OrderLine[];recovered:boolean}> {
  let journal=pendingOrder(scope);
  const recovering=journal!==null;
  if (!journal) {
    journal=parseOrderRequest({sessionId:scope.sessionId,operationId:crypto.randomUUID(),lines});
    if (!journal) throw new Error('Vui lòng kiểm tra số lượng và ghi chú trước khi gửi.');
    // Persist before POST. Storage failure must stop submission, not remove retry identity.
    localStorage.setItem(key(scope),JSON.stringify(journal));
  }
  const headers:Record<string,string>={'content-type':'application/json'};
  if (scope.mode==='customer' && scope.token) headers['x-session-token']=scope.token;
  let data:unknown;
  try {
    if (recovering) {
      const params=new URLSearchParams({sessionId:journal.sessionId,operationId:journal.operationId});
      data=await requestData(`/api/${scope.mode}/operation?${params}`,{headers,cache:'no-store'});
    }
    if (!recovering || data===null) {
      try {
        data=await requestData(`/api/${scope.mode}/orders`,{method:'POST',headers,body:JSON.stringify(journal)});
      } catch (error) {
        // Only known business rejections prove the transaction was rolled back.
        if (error instanceof OrderSubmissionError && error.status>=400 && error.status<500 && ['PRICE_CHANGED','MENU_UNAVAILABLE','OUT_OF_STOCK',
          'INVENTORY_MAPPING_INVALID','ORDER_RATE_LIMIT','INVALID_ORDER','INVALID_REQUEST_BODY'].includes(error.code)) {
          acknowledgeOrder(scope,journal.operationId);
        }
        throw error;
      }
    }
    const result=parseOrderResult(data);
    if (!result || result.operationId!==journal.operationId || result.sessionId!==journal.sessionId) throw new Error('Kết quả đối soát chưa hợp lệ.');
    // Caller first applies result/cart atomically, then acknowledges journal.
    return {result,submittedLines:journal.lines,recovered:recovering};
  } catch(error) {
    if (error instanceof OrderSubmissionError) throw error;
    throw new OrderSubmissionError('Chưa xác nhận được kết quả. Bấm kiểm tra lượt vừa gửi; không đặt lại bằng mã khác.','ORDER_UNCONFIRMED');
  }
}
