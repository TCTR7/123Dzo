import {isRecord,UUID} from '@/lib/orders/contracts';
export interface ManualPaymentCommand {sessionId:string;expectedTotal:number;paymentMethod:'CASH'|'VIETQR';reference:string;confirmedReceived:true}
export interface ManualPaymentRequest {operationId:string;command:ManualPaymentCommand}
export interface ManualPaymentResult {operationId:string;sessionId:string;amount:number;paymentMethod:'CASH'|'VIETQR';reference:string;confirmedAt:string;confirmedBy:string;confirmedByName:string;confirmedByRole:'staff'|'admin';statusBefore:'PENDING_PAYMENT';statusAfter:'ACTIVE'}
export interface PendingPayment {sessionId:string;paymentCode:string|null;customerName:string|null;customerPhone:string|null;amount:number;openedAt:string}
export interface PaymentHistory {recordId:string;operationId:string;sessionId:string;action:'CONFIRM_PAYMENT'|'CLOSE_BILL';amount:number;paymentMethod:'CASH'|'VIETQR';reference:string;confirmedBy:string;confirmedByName:string;confirmedAt:string}
export interface ManualPaymentStatus {pending:PendingPayment[];history:PaymentHistory[];pendingHasMore:boolean;historyHasMore:boolean}
const keys=(value:Record<string,unknown>,expected:string)=>Object.keys(value).sort().join(',')===expected;
const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256;
const nullableText=(v:unknown):v is string|null=>v===null||typeof v==='string';
const money=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e15;
const time=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const method=(v:unknown):v is 'CASH'|'VIETQR'=>v==='CASH'||v==='VIETQR';
export function parseManualPaymentRequest(value:unknown):ManualPaymentRequest|null {
 if(!isRecord(value)||!keys(value,'command,operationId')||!id(value.operationId)||!isRecord(value.command))return null;
 const c=value.command;
 if(!keys(c,'confirmedReceived,expectedTotal,paymentMethod,reference,sessionId')||!id(c.sessionId)||!money(c.expectedTotal)||c.expectedTotal<=0||!method(c.paymentMethod)||typeof c.reference!=='string'||c.reference.length>120||c.confirmedReceived!==true)return null;
 const reference=c.reference.trim().replace(/\s+/g,'').toUpperCase();
 if(c.paymentMethod==='VIETQR'?!reference:Boolean(reference))return null;
 return {operationId:value.operationId.toLowerCase(),command:{sessionId:c.sessionId.toLowerCase(),expectedTotal:c.expectedTotal,paymentMethod:c.paymentMethod,reference,confirmedReceived:true}};
}
export function parseManualPaymentResult(v:unknown):ManualPaymentResult|null {
 if(!isRecord(v)||!id(v.operationId)||!id(v.sessionId)||!money(v.amount)||v.amount<=0||!method(v.paymentMethod)||typeof v.reference!=='string'||!time(v.confirmedAt)||!text(v.confirmedBy)||!text(v.confirmedByName)||(v.confirmedByRole!=='staff'&&v.confirmedByRole!=='admin')||v.statusBefore!=='PENDING_PAYMENT'||v.statusAfter!=='ACTIVE')return null;
 if(v.paymentMethod==='VIETQR'?!v.reference:Boolean(v.reference))return null;
 return {operationId:v.operationId,sessionId:v.sessionId,amount:v.amount,paymentMethod:v.paymentMethod,reference:v.reference,confirmedAt:v.confirmedAt,confirmedBy:v.confirmedBy,confirmedByName:v.confirmedByName,confirmedByRole:v.confirmedByRole,statusBefore:v.statusBefore,statusAfter:v.statusAfter};
}
export function parseManualPaymentStatus(v:unknown):ManualPaymentStatus|null {
 if(!isRecord(v)||!Array.isArray(v.pending)||!Array.isArray(v.history)||v.pending.length>25||v.history.length>25||typeof v.pendingHasMore!=='boolean'||typeof v.historyHasMore!=='boolean')return null;
 const pending:PendingPayment[]=[],history:PaymentHistory[]=[];
 for(const r of v.pending){if(!isRecord(r)||!id(r.sessionId)||!nullableText(r.paymentCode)||!nullableText(r.customerName)||!nullableText(r.customerPhone)||!money(r.amount)||!time(r.openedAt))return null;
  pending.push({sessionId:r.sessionId,paymentCode:r.paymentCode,customerName:r.customerName,customerPhone:r.customerPhone,amount:r.amount,openedAt:r.openedAt});}
 for(const r of v.history){if(!isRecord(r)||!id(r.recordId)||!id(r.operationId)||!id(r.sessionId)||(r.action!=='CONFIRM_PAYMENT'&&r.action!=='CLOSE_BILL')||!money(r.amount)||!method(r.paymentMethod)||typeof r.reference!=='string'||!text(r.confirmedBy)||!text(r.confirmedByName)||!time(r.confirmedAt))return null;
  history.push({recordId:r.recordId,operationId:r.operationId,sessionId:r.sessionId,action:r.action,amount:r.amount,paymentMethod:r.paymentMethod,reference:r.reference,confirmedBy:r.confirmedBy,confirmedByName:r.confirmedByName,confirmedAt:r.confirmedAt});}
 return {pending,history,pendingHasMore:v.pendingHasMore,historyHasMore:v.historyHasMore};
}
export function paymentPage(value:string|null|undefined):number|null {return !value?1:/^[1-9]\d{0,4}$/.test(value)&&Number(value)<=10000?Number(value):null;}
