import type {TakeawayCreated,TakeawayCommand,TakeawaySnapshot} from '@/lib/takeaway/contracts';
import {line} from './order_fixtures';
export const token='a'.repeat(64),operationId='b0000000-0000-4000-8000-000000000001',sessionId='10000000-0000-4000-8000-000000000001';
export const command:TakeawayCommand={customerName:'Test customer',customerPhone:'0912345678',lines:[line]};
export const result:TakeawayCreated={operationId,sessionId,paymentCode:'NU123456789012345678',totalAmount:100,openedAt:'2026-10-22T10:00:00Z',status:'PENDING_PAYMENT'};
export const snapshot:TakeawaySnapshot={sessionId,status:'PENDING_PAYMENT',paymentCode:result.paymentCode,totalAmount:100,openedAt:result.openedAt,activatedAt:null,closedAt:null,items:[{id:'50000000-0000-4000-8000-000000000001',menuItemId:line.menu_item_id,name:'Food',quantity:1,unitPrice:100,note:null,station:'KITCHEN',status:'QUEUED'}]};
export const journal={token,operationId,command};
