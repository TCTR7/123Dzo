import { UUID, isRecord } from '@/lib/orders/contracts';
import type { IngredientRow, TableRow } from '@/types/database.types';
type Action = 'CREATE' | 'UPDATE' | 'DELETE';
export interface IngredientFields { name: string; unit: string; min_threshold: number }
export interface ZoneFields { name: string }
export interface TableFields { table_number: string; zone_id: string }
type Change<T> = { action: 'CREATE'; item: T; expected: null } | { action: 'UPDATE'; item: T; expected: T } | { action: 'DELETE'; item: null; expected: T };
export type MetadataCommand = { id: string } & (
  | ({ resource: 'INGREDIENT' } & Exclude<Change<IngredientFields>, { action: 'DELETE' }>)
  | ({ resource: 'ZONE' } & Change<ZoneFields>) | ({ resource: 'TABLE' } & Change<TableFields>));
export type MetadataRequest = MetadataCommand & { operationId: string };
export interface MetadataResult { operationId: string; resource: MetadataCommand['resource']; action: Action; entityId: string }
function exact(value: Record<string, unknown>, keys: string) { return Object.keys(value).sort().join(',') === keys; }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max && Boolean(value.trim()); }
function parseFields(resource: unknown, value: unknown): IngredientFields | ZoneFields | TableFields | null {
  if (!isRecord(value)) return null;
  if (resource === 'ZONE' && exact(value, 'name') && text(value.name, 120)) return { name: value.name };
  if (resource === 'TABLE' && exact(value, 'table_number,zone_id') && text(value.table_number, 120) && typeof value.zone_id === 'string' && UUID.test(value.zone_id))
    return { table_number: value.table_number, zone_id: value.zone_id.toLowerCase() };
  if (resource === 'INGREDIENT' && exact(value, 'min_threshold,name,unit') && text(value.name, 120) && text(value.unit, 30) && typeof value.min_threshold === 'number' &&
    Number.isFinite(value.min_threshold) && value.min_threshold >= 0 && value.min_threshold <= 1e12 && value.min_threshold === Number(value.min_threshold.toFixed(3)))
    return { name: value.name, unit: value.unit, min_threshold: value.min_threshold };
  return null;
}
export function parseMetadataRequest(value: unknown): MetadataRequest | null {
  if (!isRecord(value) || !exact(value, 'action,expected,id,item,operationId,resource') || typeof value.operationId !== 'string' || !UUID.test(value.operationId) ||
    typeof value.id !== 'string' || !UUID.test(value.id)) return null;
  const item = parseFields(value.resource, value.item), expected = parseFields(value.resource, value.expected);
  if (value.action === 'CREATE' ? !item || value.expected !== null : value.action === 'UPDATE' ? !item || !expected : value.action === 'DELETE' ? value.item !== null || !expected || value.resource === 'INGREDIENT' : true) return null;
  // Each branch reconstructs the discriminated union after resource-specific validation.
  const base = { id: value.id.toLowerCase(), operationId: value.operationId.toLowerCase() };
  if (value.resource === 'INGREDIENT' && item && 'unit' in item) {
    if (value.action === 'CREATE') return { ...base, resource: value.resource, action: value.action, item, expected: null };
    if (value.action === 'UPDATE' && expected && 'unit' in expected) return { ...base, resource: value.resource, action: value.action, item, expected };
  }
  if (value.resource === 'ZONE') {
    if (value.action === 'CREATE' && item && 'name' in item) return { ...base, resource: value.resource, action: value.action, item: { name: item.name }, expected: null };
    if (expected && 'name' in expected) {
      if (value.action === 'UPDATE' && item && 'name' in item) return { ...base, resource: value.resource, action: value.action, item: { name: item.name }, expected: { name: expected.name } };
      if (value.action === 'DELETE') return { ...base, resource: value.resource, action: value.action, item: null, expected: { name: expected.name } };
    }
  }
  if (value.resource === 'TABLE') {
    if (value.action === 'CREATE' && item && 'zone_id' in item) return { ...base, resource: value.resource, action: value.action, item, expected: null };
    if (expected && 'zone_id' in expected) {
      if (value.action === 'UPDATE' && item && 'zone_id' in item) return { ...base, resource: value.resource, action: value.action, item, expected };
      if (value.action === 'DELETE') return { ...base, resource: value.resource, action: value.action, item: null, expected };
    }
  }
  return null;
}
export function parseMetadataResult(value: unknown): MetadataResult | null {
  if (!isRecord(value) || typeof value.operationId !== 'string' || !UUID.test(value.operationId) || typeof value.entityId !== 'string' || !UUID.test(value.entityId) ||
    (value.resource !== 'INGREDIENT' && value.resource !== 'ZONE' && value.resource !== 'TABLE') ||
    (value.action !== 'CREATE' && value.action !== 'UPDATE' && value.action !== 'DELETE') || (value.resource === 'INGREDIENT' && value.action === 'DELETE')) return null;
  return { operationId: value.operationId, resource: value.resource, action: value.action, entityId: value.entityId };
}
export function matchesMetadataResult(result: MetadataResult, input: MetadataRequest) {
  return result.operationId === input.operationId && result.entityId === input.id && result.resource === input.resource && result.action === input.action;
}
export function ingredientSnapshot(row: IngredientRow): IngredientFields { return { name: row.name, unit: row.unit, min_threshold: row.min_threshold }; }
export function tableSnapshot(row: TableRow): TableFields { return { table_number: row.table_number, zone_id: row.zone_id }; }
