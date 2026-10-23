export const sessionId = '10000000-0000-4000-8000-000000000001';
export const operationId = '60000000-0000-4000-8000-000000000001';
export const orderItemId = '50000000-0000-4000-8000-000000000001';
export const draft = { sessionId, orderItemId, quantity: 1, expectedQuantity: 3, confirmedUnused: true as const };
export const journal = { ...draft, operationId };
export const result = { sessionId, operationId, orderItemId, remainingQuantity: 2, totalAmount: 40 };
