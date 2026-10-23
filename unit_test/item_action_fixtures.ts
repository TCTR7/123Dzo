import type { ItemActionRequest, ItemActionResult } from '@/lib/item-actions/contracts';
export const operationId='a0000000-0000-4000-8000-000000000001';
export const item={id:'50000000-0000-4000-8000-000000000001',sessionId:'10000000-0000-4000-8000-000000000001',expectedStatus:'QUEUED' as const,expectedQuantity:1};
export const journal:ItemActionRequest={operationId,action:'START',reason:'',items:[item]};
export const result:ItemActionResult={operationId,action:'START',batchId:null,items:[{id:item.id,sessionId:item.sessionId,fromStatus:'QUEUED',status:'COOKING'}]};
