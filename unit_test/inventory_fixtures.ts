export const ingredientId = '30000000-0000-4000-8000-000000000001';
export const operationId = '40000000-0000-4000-8000-000000000001';
export const input = { ingredientId, type: 'IMPORT' as const, quantity: 1, unitCost: 12, note: '' };
export const journal = { operationId, input };
export const result = { operationId, ingredientId, logId: '50000000-0000-4000-8000-000000000001', quantityChange: 1, totalCost: 12 };
