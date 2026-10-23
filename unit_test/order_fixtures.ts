import type { OrderLine, OrderResult } from '@/lib/orders/contracts';
export const sessionId='10000000-0000-4000-8000-000000000001';
export const operationId='40000000-0000-4000-8000-000000000001';
export const menuId='20000000-0000-4000-8000-000000000001';
export const line:OrderLine={menu_item_id:menuId,quantity:1,note:'less spicy',expected_price:100};
export const result:OrderResult={sessionId,operationId,totalAmount:100,items:[{
  id:'50000000-0000-4000-8000-000000000001',session_id:sessionId,menu_item_id:menuId,quantity:1,note:'less spicy',
  station:'KITCHEN',status:'QUEUED',batch_id:null,unit_price:100,created_at:'2026-10-22T02:00:00Z',
  cooking_started_at:null,ready_at:null,served_at:null,cancelled_at:null,cancel_reason:null,
}]};
