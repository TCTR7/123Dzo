import { describe, expect, it } from 'vitest';
import { staffAlerts } from '@/lib/services/snapshots';
import type { OrderItemRow, StaffProfileRow, TableRow, TableSessionRow } from '@/types/database.types';

const now = Date.parse('2026-10-23T10:00:00Z');
const staff = { id: 'staff1', role: 'staff', assigned_zone_id: 'zone1' } as StaffProfileRow;
const tables = [{ id: 'table1', table_number: 'Ban 1', zone_id: 'zone1' }] as TableRow[];
const sessions = [{ id: 'session1', table_id: 'table1', assigned_staff_id: 'staff1', status: 'ACTIVE' }] as TableSessionRow[];
const ready = { id: 'item1', session_id: 'session1', status: 'READY', ready_at: new Date(now - 1000).toISOString() } as OrderItemRow;

describe('Targeted in-app notifications', () => {
  it('notifies only the assigned staff before the two-minute reminder', () => {
    expect(staffAlerts(staff, sessions, [ready], tables, now)).toHaveLength(1);
    expect(staffAlerts({ ...staff, id: 'staff2' }, sessions, [ready], tables, now)).toEqual([]);
  });
  it('includes zone colleagues at two minutes without scheduling a background job', () => {
    const old = { ...ready, ready_at: new Date(now - 120000).toISOString() };
    expect(staffAlerts({ ...staff, id: 'staff2' }, sessions, [old], tables, now)[0].id).toBe('item1:overdue');
    expect(staffAlerts({ ...staff, id: 'staff3', assigned_zone_id: 'other-zone' }, sessions, [old], tables, now)).toEqual([]);
  });
  it('stops reminders when the item was served or the bill was closed', () => {
    expect(staffAlerts(staff, sessions, [{ ...ready, status: 'SERVED' }], tables, now)).toEqual([]);
    expect(staffAlerts(staff, [{ ...sessions[0], status: 'CLOSED' }], [ready], tables, now)).toEqual([]);
  });
  it('does not notify for unpaid takeaway and routes bill requests to the assigned user', () => {
    expect(staffAlerts(staff, [{ ...sessions[0], status: 'PENDING_PAYMENT' }], [ready], tables, now)).toEqual([]);
    expect(staffAlerts(staff, [{ ...sessions[0], status: 'REQUEST_BILL' }], [], tables, now)[0].id).toBe('session1:bill');
    expect(staffAlerts({ ...staff, id: 'other' }, [{ ...sessions[0], status: 'REQUEST_BILL' }], [], tables, now)).toEqual([]);
  });
});
