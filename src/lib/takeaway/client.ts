'use client';
import {isRecord} from '@/lib/orders/contracts';
import {parseTakeawayRequest,parseTakeawayCreated,parseTakeawaySnapshot,TOKEN,type TakeawayRequest,type TakeawayCommand,type TakeawayCreated} from './contracts';
const KEY='123dzo-pending-takeaway-v1',HISTORY='123dzo-takeaway-capabilities-v1';
interface Journal extends TakeawayRequest{token:string}
export class TakeawayError extends Error{constructor(message:string,public readonly code:string,public readonly status=0){super(message);}}
export function pendingTakeaway():Journal|null{
 const raw=localStorage.getItem(KEY);if(!raw)return null;let v:unknown;try{v=JSON.parse(raw);}catch{throw new Error('Không đọc được lượt đặt mang về. Nhờ quán kiểm tra trước khi đặt lại.');}
 if(!isRecord(v)||typeof v.token!=='string'||!TOKEN.test(v.token))throw new Error('Mã khôi phục không hợp lệ. Nhờ quán đối soát.');
 const parsed=parseTakeawayRequest({operationId:v.operationId,command:v.command});if(!parsed)throw new Error('Lượt đặt đang lưu không hợp lệ. Nhờ quán đối soát.');return {...parsed,token:v.token};
}
export function takeawayHistory():string[]{const raw=localStorage.getItem(HISTORY);if(!raw)return [];let v:unknown;try{v=JSON.parse(raw);}catch{throw new Error('Không đọc được danh sách đơn trên máy.');}return Array.isArray(v)?[...new Set(v.filter((token:unknown):token is string=>typeof token==='string'&&TOKEN.test(token)))].slice(0,20):[];}
export function forgetTakeaway(token:string){localStorage.setItem(HISTORY,JSON.stringify(takeawayHistory().filter(v=>v!==token)));}
async function request(url:string,token:string,init:RequestInit={}){
 const controller=new AbortController(),abort=()=>controller.abort();if(init.signal?.aborted)controller.abort();init.signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,15000);
 try{const response=await fetch(url,{...init,cache:'no-store',headers:{'content-type':'application/json','x-takeaway-token':token},signal:controller.signal}),body:unknown=await response.json();
  if(!response.ok){const e=isRecord(body)&&isRecord(body.error)?body.error:null;throw new TakeawayError(typeof e?.message==='string'?e.message:'Chưa đọc được kết quả đơn.',typeof e?.code==='string'?e.code:'TAKEAWAY_UNAVAILABLE',response.status);}
  if(!isRecord(body)||!Object.hasOwn(body,'data'))throw new Error('Invalid order response');return body.data;
 }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
}
export async function recoverTakeaway(signal?:AbortSignal){const journal=pendingTakeaway();if(!journal)return null;
 const data=await request('/api/customer/takeaway?'+new URLSearchParams({operationId:journal.operationId}),journal.token,{signal});if(data===null)return null;
 const result=parseTakeawayCreated(data);if(!result||result.operationId!==journal.operationId)throw new Error('Chưa xác nhận được đúng lượt đặt.');return {result,journal};
}
export async function submitTakeaway(command?:TakeawayCommand){
 let journal=pendingTakeaway();const recovered=journal!==null;
 if(!journal){const parsed=parseTakeawayRequest({operationId:crypto.randomUUID(),command});if(!parsed)throw new Error('Kiểm tra thông tin nhận món và giỏ hàng.');const bytes=crypto.getRandomValues(new Uint8Array(32));journal={...parsed,token:[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('')};localStorage.setItem(KEY,JSON.stringify(journal));}
 try{let data:unknown;
  if(recovered){const found=await recoverTakeaway();if(found)return found;}
  try{data=await request('/api/customer/takeaway',journal.token,{method:'POST',body:JSON.stringify({operationId:journal.operationId,command:journal.command})});}
  catch(e){if(e instanceof TakeawayError&&e.status>=400&&e.status<500&&['INVALID_TAKEAWAY','INVALID_REQUEST_BODY','TAKEAWAY_RATE_LIMIT','MENU_UNAVAILABLE','PRICE_CHANGED','MAPPING_INVALID'].includes(e.code))localStorage.removeItem(KEY);throw e;}
  const result=parseTakeawayCreated(data);if(!result||result.operationId!==journal.operationId)throw new Error('Invalid created result');return {result,journal};
 }catch(e){if(e instanceof TakeawayError)throw e;throw new TakeawayError('Chưa xác nhận được lượt đặt. Kiểm tra lượt vừa gửi, không tạo đơn mới.','TAKEAWAY_UNCONFIRMED');}
}
export function acceptTakeaway(result:TakeawayCreated,journal:Journal){
 if(result.operationId!==journal.operationId||pendingTakeaway()?.operationId!==journal.operationId)return;
 const history=takeawayHistory();localStorage.setItem(HISTORY,JSON.stringify([journal.token,...history.filter(v=>v!==journal.token)].slice(0,20)));
 localStorage.removeItem(KEY);
}
export async function readTakeaway(token:string,signal?:AbortSignal){if(!TOKEN.test(token))throw new Error('Invalid capability');const result=parseTakeawaySnapshot(await request('/api/customer/takeaway',token,{signal}));if(!result)throw new Error('Chưa đọc được trạng thái đơn.');return result;}
