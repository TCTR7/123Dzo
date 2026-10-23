import { isRecord, UUID } from '@/lib/orders/contracts';

export type ManualInventoryInput = {
  ingredientId: string; quantity: number; note: string;
} & ({ type: 'IMPORT'; unitCost: number } | { type: 'WASTAGE'; unitCost: null });
export interface InventoryRequest { operationId: string; input: ManualInventoryInput }
export interface InventoryResult {
  operationId: string; ingredientId: string; logId: string; quantityChange: number; totalCost: number;
}
function decimal(value: unknown, max: number, places: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && Number(value.toFixed(places)) === value;
}
export function parseInventoryRequest(value: unknown): InventoryRequest | null {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'input,operationId' ||
    typeof value.operationId !== 'string' || !UUID.test(value.operationId) || !isRecord(value.input)) return null;
  const input = value.input;
  if (Object.keys(input).sort().join(',') !== 'ingredientId,note,quantity,type,unitCost' ||
    typeof input.ingredientId !== 'string' || !UUID.test(input.ingredientId) ||
    !decimal(input.quantity, 1e6, 3) || input.quantity <= 0 || typeof input.note !== 'string' || input.note.length > 500) return null;
  const common = { ingredientId: input.ingredientId.toLowerCase(), quantity: input.quantity, note: input.note.trim() };
  if (input.type === 'IMPORT' && decimal(input.unitCost, 1e9, 2)) {
    return { operationId: value.operationId.toLowerCase(), input: { ...common, type: 'IMPORT', unitCost: input.unitCost } };
  }
  if (input.type === 'WASTAGE' && input.unitCost === null && common.note) {
    return { operationId: value.operationId.toLowerCase(), input: { ...common, type: 'WASTAGE', unitCost: null } };
  }
  return null;
}
export function parseInventoryResult(value: unknown): InventoryResult | null {
  if (!isRecord(value) || typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
    typeof value.ingredientId !== 'string' || !UUID.test(value.ingredientId) ||
    typeof value.logId !== 'string' || !UUID.test(value.logId) ||
    typeof value.quantityChange !== 'number' || !Number.isFinite(value.quantityChange) || value.quantityChange === 0 ||
    typeof value.totalCost !== 'number' || !Number.isFinite(value.totalCost) || value.totalCost < 0) return null;
  return { operationId: value.operationId, ingredientId: value.ingredientId, logId: value.logId,
    quantityChange: value.quantityChange, totalCost: value.totalCost };
}
