'use client';
import {isRecord} from '@/lib/orders/contracts';
import {parseManualPaymentRequest,parseManualPaymentResult,type ManualPaymentCommand,type ManualPaymentRequest} from './contracts';
export class ManualPaymentError extends Error{constructor(message:string,public readonly code:string,public readonly status=0){super(message);}}
const key=(actor:string)=>'123dzo-pending-payment:'+actor;
export function pendingManualPayment(actor:string):ManualPaymentRequest|null{
 const raw=localStorage.getItem(key(actor));if(!raw)return null;
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error('Không đọc được xác nhận đang lưu. Nhờ quản lý đối soát, không xác nhận lại bằng mã mới.');}
 const parsed=parseManualPaymentRequest(value);if(!parsed)throw new Error('Xác nhận đang lưu không hợp lệ. Nhờ quản lý đối soát.');return parsed;
}
export function acknowledgeManualPayment(actor:string,id:string){if(pendingManualPayment(actor)?.operationId===id)localStorage.removeItem(key(actor));}
async function request(url:string,init:RequestInit={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(url,{...init,signal:controller.signal,cache:'no-store'}),body:unknown=await response.json();
  if(!response.ok){const error=isRecord(body)&&isRecord(body.error)?body.error:null;throw new ManualPaymentError(typeof error?.message==='string'?error.message:'Chưa xác nhận được thu tiền.',typeof error?.code==='string'?error.code:'PAYMENT_UNAVAILABLE',response.status);}
  if(!isRecord(body)||!Object.hasOwn(body,'data'))throw new Error('Invalid payment response');return body.data;
 }finally{clearTimeout(timer);}
}
export async function submitManualPayment(actor:string,command?:ManualPaymentCommand){
 let journal=pendingManualPayment(actor);const recovered=journal!==null;
 if(!journal){journal=parseManualPaymentRequest({operationId:crypto.randomUUID(),command});if(!journal)throw new Error('Đối chiếu số tiền thực nhận, phương thức và mã giao dịch trước khi xác nhận.');localStorage.setItem(key(actor),JSON.stringify(journal));}
 try{
  let data:unknown;
  if(recovered)data=await request('/api/staff/payments?'+new URLSearchParams({operationId:journal.operationId}));
  if(!recovered||data===null){try{data=await request('/api/staff/payments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(journal)});}catch(error){
   if(error instanceof ManualPaymentError&&error.status>=400&&error.status<500&&['INVALID_PAYMENT','INVALID_REQUEST_BODY','PAYMENT_NOT_FOUND','PAYMENT_HANDLED','PAYMENT_NEEDS_REVIEW','PAYMENT_AMOUNT_CHANGED','OUT_OF_STOCK','PAYMENT_DUPLICATE'].includes(error.code))acknowledgeManualPayment(actor,journal.operationId);throw error;
  }}
  const result=parseManualPaymentResult(data);
  if(!result||result.operationId!==journal.operationId||result.sessionId!==journal.command.sessionId||result.amount!==journal.command.expectedTotal||result.paymentMethod!==journal.command.paymentMethod||result.reference!==journal.command.reference||result.confirmedBy!==actor)throw new Error('Invalid receipt recovery');
  return result;
 }catch(error){if(error instanceof ManualPaymentError)throw error;throw new ManualPaymentError('Chưa xác nhận kết quả. Kiểm tra thao tác vừa gửi trước khi thu/xác nhận lại.','PAYMENT_UNCONFIRMED');}
}
