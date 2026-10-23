'use client';
import { create } from 'zustand';
import { persist,createJSONStorage } from 'zustand/middleware';
import { migrateCartLines,type CartLine } from '@/lib/customer/cart-lines';
import type { OrderLine } from '@/lib/orders/contracts';
export type CartItem=CartLine;
interface CartState {
 sessionToken:string|null; items:CartLine[]; submissionTimestamps:number[]; acceptedOperationIds:string[];
 setSessionToken:(token:string)=>void;
 addItem:(item:Omit<CartLine,'lineId'|'quantity'|'note'>&{quantity?:number;note?:string})=>void;
 updateQuantity:(lineId:string,quantity:number)=>void;
 updateNote:(lineId:string,note:string)=>void;
 removeItem:(lineId:string)=>void; clearCart:()=>void;
 getTotalQuantity:()=>number;getTotalAmount:()=>number;canSubmitOrder:()=>boolean;recordOrderSubmission:()=>void;
 acceptSubmittedOrder:(operationId:string,lines:OrderLine[])=>void;
}
function safeState(value:unknown) {
 const v=value && typeof value==='object'?value as Record<string,unknown>:{};
 return {sessionToken:typeof v.sessionToken==='string'?v.sessionToken:null,items:migrateCartLines(v.items),
 submissionTimestamps:Array.isArray(v.submissionTimestamps)?v.submissionTimestamps.filter((n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)).slice(-2):[],
 acceptedOperationIds:Array.isArray(v.acceptedOperationIds)?v.acceptedOperationIds.filter((n:unknown):n is string=>typeof n==='string').slice(-100):[]};
}
function createCartStore(name:string) {
 return create<CartState>()(persist((set,get)=>({sessionToken:null,items:[],submissionTimestamps:[],acceptedOperationIds:[],
 setSessionToken:token=>set(state=>state.sessionToken===token?state:state.sessionToken===null?{sessionToken:token}:{sessionToken:token,items:[],submissionTimestamps:[],acceptedOperationIds:[]}),
 addItem:incoming=>{
  const quantity=incoming.quantity??1,note=(incoming.note??'').trim().slice(0,500);
  if(!Number.isInteger(quantity)||quantity<1||quantity>99||!Number.isFinite(incoming.unit_price)||incoming.unit_price<0)return;
  set(state=>{
   const found=state.items.find(item=>item.menu_item_id===incoming.menu_item_id&&item.note===note&&item.unit_price===incoming.unit_price);
   if(found)return {items:state.items.map(item=>item.lineId===found.lineId?{...item,quantity:Math.min(99,item.quantity+quantity)}:item)};
   if(state.items.length>=30)return state;
   return {items:[...state.items,{...incoming,lineId:crypto.randomUUID(),quantity,note}]};
  });
 },
 updateQuantity:(lineId,quantity)=>{
  if(!Number.isInteger(quantity)||quantity>99)return;
  set(state=>({items:quantity<=0?state.items.filter(i=>i.lineId!==lineId):state.items.map(i=>i.lineId===lineId?{...i,quantity}:i)}));
 },
 updateNote:(lineId,note)=>set(state=>({items:state.items.map(i=>i.lineId===lineId?{...i,note:note.slice(0,500)}:i)})),
 removeItem:lineId=>set(state=>({items:state.items.filter(i=>i.lineId!==lineId)})),clearCart:()=>set({items:[]}),
 getTotalQuantity:()=>get().items.reduce((sum,i)=>sum+i.quantity,0),getTotalAmount:()=>get().items.reduce((sum,i)=>sum+i.quantity*i.unit_price,0),
 canSubmitOrder:()=>get().submissionTimestamps.filter(ts=>Date.now()-ts<10000).length<2,
 recordOrderSubmission:()=>set(state=>({submissionTimestamps:[...state.submissionTimestamps.filter(ts=>Date.now()-ts<10000),Date.now()]})),
 acceptSubmittedOrder:(operationId,lines)=>set(state=>{
  if(state.acceptedOperationIds.includes(operationId))return state;
  let items=state.items.map(i=>({...i}));
  for(const line of lines){let remaining=line.quantity;items=items.map(item=>{
   if(remaining<=0||item.menu_item_id!==line.menu_item_id||item.note.trim()!==line.note||item.unit_price!==line.expected_price)return item;
   const accepted=Math.min(remaining,item.quantity);remaining-=accepted;return {...item,quantity:item.quantity-accepted};
  }).filter(i=>i.quantity>0);}
  return {items,acceptedOperationIds:[...state.acceptedOperationIds,operationId].slice(-100)};
 }),
 }),{name,version:2,storage:createJSONStorage(()=>localStorage),migrate:value=>safeState(value),
 merge:(persisted,current)=>({...current,...safeState(persisted)})}));
}
export const useCartStore=createCartStore('123dzo-customer-cart-storage');
export const useTakeawayCartStore=createCartStore('123dzo-takeaway-cart-storage');
