import {isRecord,UUID,parseOrderRequest,type OrderLine} from '@/lib/orders/contracts';
import {recipientInput} from '@/lib/customer/customer-config';
import type {OrderItemStatus,StationType,TableSessionStatus} from '@/types/database.types';
export const TOKEN=/^[a-f0-9]{64}$/;
export interface TakeawayCommand{customerName:string;customerPhone:string;lines:OrderLine[]}
export interface TakeawayRequest{operationId:string;command:TakeawayCommand}
export interface TakeawayCreated{operationId:string;sessionId:string;paymentCode:string;totalAmount:number;openedAt:string;status:'PENDING_PAYMENT'}
export interface TakeawayItem{id:string;menuItemId:string;name:string;quantity:number;unitPrice:number;note:string|null;station:StationType;status:OrderItemStatus}
export interface TakeawaySnapshot{sessionId:string;status:TableSessionStatus;paymentCode:string;totalAmount:number;openedAt:string;activatedAt:string|null;closedAt:string|null;items:TakeawayItem[]}
const id=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
const money=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e15;
const time=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function parseTakeawayRequest(v:unknown):TakeawayRequest|null{
 if(!isRecord(v)||Object.keys(v).sort().join(',')!=='command,operationId'||!id(v.operationId)||!isRecord(v.command)||Object.keys(v.command).sort().join(',')!=='customerName,customerPhone,lines'||typeof v.command.customerName!=='string'||typeof v.command.customerPhone!=='string')return null;
 const recipient=recipientInput(v.command.customerName,v.command.customerPhone);if(recipient.nameError||recipient.phoneError)return null;
 const order=parseOrderRequest({operationId:v.operationId,sessionId:v.operationId,lines:v.command.lines});if(!order)return null;
 return {operationId:order.operationId,command:{customerName:recipient.name,customerPhone:recipient.phone,lines:order.lines}};
}
export function parseTakeawayCreated(v:unknown):TakeawayCreated|null{
 if(!isRecord(v)||!id(v.operationId)||!id(v.sessionId)||typeof v.paymentCode!=='string'||!/^NU[A-Z0-9]{18}$/.test(v.paymentCode)||!money(v.totalAmount)||v.totalAmount<=0||!time(v.openedAt)||v.status!=='PENDING_PAYMENT')return null;
 return {operationId:v.operationId,sessionId:v.sessionId,paymentCode:v.paymentCode,totalAmount:v.totalAmount,openedAt:v.openedAt,status:'PENDING_PAYMENT'};
}
export function parseTakeawaySnapshot(v:unknown):TakeawaySnapshot|null{
 if(!isRecord(v)||!id(v.sessionId)||!['PENDING_PAYMENT','ACTIVE','REQUEST_BILL','CLOSED'].includes(String(v.status))||typeof v.paymentCode!=='string'||!money(v.totalAmount)||!time(v.openedAt)||(v.activatedAt!==null&&!time(v.activatedAt))||(v.closedAt!==null&&!time(v.closedAt))||!Array.isArray(v.items)||v.items.length>30)return null;
 const items:TakeawayItem[]=[],seen=new Set<string>();
 for(const i of v.items){if(!isRecord(i)||!id(i.id)||seen.has(i.id)||!id(i.menuItemId)||typeof i.name!=='string'||typeof i.quantity!=='number'||!Number.isInteger(i.quantity)||i.quantity<0||i.quantity>99||!money(i.unitPrice)||(i.note!==null&&typeof i.note!=='string')||(i.station!=='KITCHEN'&&i.station!=='BAR_INSTANT')||!['QUEUED','COOKING','READY','SERVED','CANCELLED'].includes(String(i.status)))return null;
  seen.add(i.id);items.push({id:i.id,menuItemId:i.menuItemId,name:i.name,quantity:i.quantity,unitPrice:i.unitPrice,note:i.note,station:i.station,status:i.status as OrderItemStatus});}
 return {sessionId:v.sessionId,status:v.status as TableSessionStatus,paymentCode:v.paymentCode,totalAmount:v.totalAmount,openedAt:v.openedAt,activatedAt:v.activatedAt,closedAt:v.closedAt,items};
}
export interface PickupResult{operationId:string;sessionId:string;closedAt:string;handedOverBy:string}
export function parsePickupResult(v:unknown):PickupResult|null{return isRecord(v)&&id(v.operationId)&&id(v.sessionId)&&time(v.closedAt)&&typeof v.handedOverBy==='string'?{operationId:v.operationId,sessionId:v.sessionId,closedAt:v.closedAt,handedOverBy:v.handedOverBy}:null;}
