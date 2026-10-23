import type {ManualPaymentCommand,ManualPaymentResult,ManualPaymentStatus} from '@/lib/payments/contracts';
export const operationId='90000000-0000-4000-8000-000000000001',sessionId='10000000-0000-4000-8000-000000000001';
export const command:ManualPaymentCommand={sessionId,expectedTotal:160,paymentMethod:'VIETQR',reference:'TCB-123',confirmedReceived:true};
export const journal={operationId,command};
export const result:ManualPaymentResult={operationId,sessionId,amount:160,paymentMethod:'VIETQR',reference:'TCB-123',confirmedAt:'2026-10-22T10:00:00Z',confirmedBy:'user_staff',confirmedByName:'Original staff',confirmedByRole:'staff',statusBefore:'PENDING_PAYMENT',statusAfter:'ACTIVE'};
export const status:ManualPaymentStatus={pending:[{sessionId,paymentCode:'ORDER123',customerName:'Test customer',customerPhone:'0912345678',amount:160,openedAt:'2026-10-22T09:00:00Z'}],history:[{recordId:operationId,operationId,sessionId,action:'CONFIRM_PAYMENT',amount:160,paymentMethod:'VIETQR',reference:'TCB-123',confirmedBy:'user_staff',confirmedByName:'Original staff',confirmedAt:result.confirmedAt}],pendingHasMore:false,historyHasMore:false};
