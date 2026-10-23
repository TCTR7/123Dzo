import type { SessionActionRequest, SessionActionResult } from '@/lib/sessions/contracts';
export const tableId = '70000000-0000-4000-8000-000000000001';
export const sessionId = '10000000-0000-4000-8000-000000000001';
export const operationId = '90000000-0000-4000-8000-000000000001';
export const open: SessionActionRequest = { operationId, action: 'OPEN', input: { tableId } };
export const bill: SessionActionRequest = { operationId, action: 'REQUEST_BILL', input: { sessionId, paymentMethod: 'CASH' } };
export const result: SessionActionResult = { operationId, action: 'OPEN', sessionId, tableId, status: 'ACTIVE', totalAmount: 0 };
