import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryDatabase } from './helpers/memory-db';

const mocks = vi.hoisted(() => ({ actor: vi.fn(), payment: vi.fn(), db: { current: null as unknown } }));
vi.mock('@/lib/payments/settings', () => ({ readPaymentSettings: mocks.payment }));
vi.mock('@/lib/auth/roles', async (original) => ({ ...await original<typeof import('@/lib/auth/roles')>(), getCurrentStaffProfile: mocks.actor }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceRoleClient: () => mocks.db.current }));
import { proxyToSupabase } from '@/lib/services/proxy';
import { POST as customerOrder } from '@/app/api/customer/orders/route';
import { GET as customerRead, POST as customerBill } from '@/app/api/customer/session/route';
import { POST as returnBeer } from '@/app/api/orders/return-beer/route';
import { readSnapshot } from '@/lib/services/snapshots';
import type { StaffProfileRow } from '@/types/database.types';

const sid = '11111111-1111-4111-8111-111111111111';
const mid = '22222222-2222-4222-8222-222222222222';
const oid = '33333333-3333-4333-8333-333333333333';
const iid = '44444444-4444-4444-8444-444444444444';
const actor = (role = 'staff', id = 'user_staff') => ({ id, role, is_active: true, assigned_zone_id: 'zone1' });
const session = { id: sid, session_token: 'secret-table-token', session_type: 'DINE_IN', table_id: 'table1', status: 'ACTIVE', assigned_staff_id: 'user_staff', total_amount: 100, opened_at: '2026-10-23T00:00:00Z' };
const menu = { id: mid, name: 'Beer', category: 'BEER', station: 'BAR_INSTANT', price: 18000, cost_price: 12000, is_available: true, linked_ingredient_id: iid };
const item = { id: oid, session_id: sid, menu_item_id: mid, station: 'BAR_INSTANT', status: 'READY', quantity: 2, unit_price: 18000, unit_cost_price: 12000, ready_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T01:00:00Z' };
let db: ReturnType<typeof memoryDatabase>;
const json = (body: unknown) => new Request('https://pub.example/api/customer/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const proxy = (table: string, method = 'GET', body?: unknown, query = '') => proxyToSupabase(new NextRequest(`https://pub.example/api/supabase-proxy/rest/v1/${table}${query}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), Promise.resolve({ path: ['rest', 'v1', table] }));

beforeEach(() => {
  db = memoryDatabase({ table_sessions: [{ ...session }], menu_items: [{ ...menu }], order_items: [{ ...item }], ingredients: [{ id: iid, stock_quantity: 10, unit_cost: 12000, name: 'Beer' }], tables: [], staff_profiles: [actor()] });
  mocks.payment.mockResolvedValue({ bankBin: '970407', bankName: 'Techcombank', accountNumber: '1234567890', accountName: 'NGUYEN VAN A' });
  mocks.db.current = db; mocks.actor.mockResolvedValue(actor());
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-secret'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
});

describe('Server-enforced proxy permissions', () => {
  it('denies anonymous callers before forwarding or querying any data', async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await proxy('table_sessions')).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled(); expect(db.writes).toHaveLength(0);
  });
  it('denies inactive profiles', async () => {
    mocks.actor.mockResolvedValue({ ...actor(), is_active: false });
    expect((await proxy('menu_items')).status).toBe(401);
  });
  it.each(['ingredients', 'inventory_logs', 'staff_profiles', 'zones'])('denies staff writes to %s', async (table) => {
    expect((await proxy(table, 'POST', { name: 'tampered', stock_quantity: 999 })).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('denies schema overrides and unauthorized reports', async () => {
    expect((await proxy('vw_kpi_financial_summary')).status).toBe(403);
    const req = new NextRequest('https://pub.example/api/supabase-proxy/rest/v1/menu_items', { headers: { 'accept-profile': 'private' } });
    expect((await proxyToSupabase(req, Promise.resolve({ path: ['rest', 'v1', 'menu_items'] }))).status).toBe(403);
  });
  it('blocks unknown paths including Supabase auth administration', async () => {
    mocks.actor.mockResolvedValue(actor('operator'));
    const response = await proxyToSupabase(new NextRequest('https://pub.example/api/supabase-proxy/auth/v1/admin/users'), Promise.resolve({ path: ['auth', 'v1', 'admin', 'users'] }));
    expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  });
  it('permits kitchen 86ing but never price edits', async () => {
    mocks.actor.mockResolvedValue(actor('kitchen'));
    expect((await proxy('menu_items', 'PATCH', { price: 1 }, `?id=eq.${mid}`)).status).toBe(403);
    expect((await proxy('menu_items', 'PATCH', { is_available: false }, `?id=eq.${mid}`)).status).toBe(200);
  });
  it('rejects cross-origin writes', async () => {
    mocks.actor.mockResolvedValue(actor('admin'));
    const req = new NextRequest('https://pub.example/api/supabase-proxy/rest/v1/zones', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ name: 'bad' }) });
    expect((await proxyToSupabase(req, Promise.resolve({ path: ['rest', 'v1', 'zones'] }))).status).toBe(403);
  });
  it('denies staff cancellation of cooked/served items even with forged actor/timestamps', async () => {
    db.data.order_items[0].status = 'SERVED';
    expect((await proxy('order_items', 'PATCH', { status: 'CANCELLED', cancelled_by: 'user_admin', cancel_reason: 'forged' }, `?id=eq.${oid}`)).status).toBe(403);
    expect(db.data.order_items[0].status).toBe('SERVED');
  });
  it('stamps the actual serving user and server time', async () => {
    const response = await proxy('order_items', 'PATCH', { status: 'SERVED', served_at: '1900-01-01', served_by_staff_id: 'user_admin' }, `?id=eq.${oid}`);
    expect(response.status).toBe(200);
    expect(db.data.order_items[0].served_by_staff_id).toBe('user_staff');
    expect(db.data.order_items[0].served_at).not.toBe('1900-01-01');
  });
  it('supports completing legacy cooking items with server timestamps', async () => {
    mocks.actor.mockResolvedValue(actor('kitchen')); db.data.order_items[0].station = 'KITCHEN'; db.data.order_items[0].status = 'QUEUED';
    expect((await proxy('order_items', 'PATCH', { status: 'COOKING' }, `?id=eq.${oid}`)).status).toBe(200);
    expect(db.data.order_items[0].cooking_started_at).toBeTruthy();
    expect((await proxy('order_items', 'PATCH', { status: 'READY' }, `?id=eq.${oid}`)).status).toBe(200);
    expect(db.data.order_items[0].ready_at).toBeTruthy();
  });
  it('completes queued food with one request and does not fabricate the cooking start time', async () => {
    mocks.actor.mockResolvedValue(actor('kitchen'));
    Object.assign(db.data.order_items[0], { station: 'KITCHEN', status: 'QUEUED', cooking_started_at: null });
    expect((await proxy('order_items', 'PATCH', { status: 'READY', ready_at: '1900-01-01' }, `?id=eq.${oid}`)).status).toBe(200);
    expect(db.data.order_items[0].cooking_started_at).toBeNull();
    expect(db.data.order_items[0].ready_at).not.toBe('1900-01-01');
    expect((await readSnapshot(null, session.session_token)).orders[0].status).toBe('READY');
  });
  it.each(['PENDING_PAYMENT','CLOSED'])('never completes food in a %s session', async status => {
    mocks.actor.mockResolvedValue(actor('kitchen')); db.data.order_items[0].station = 'KITCHEN'; db.data.order_items[0].status = 'QUEUED'; db.data.table_sessions[0].status = status;
    expect((await proxy('order_items','PATCH',{status:'READY'},`?id=eq.${oid}`)).status).toBe(409);
    expect(db.writes).toHaveLength(0);
  });
  it('adds a numbered table with no user-managed zone, even on an empty database', async () => {
    mocks.actor.mockResolvedValue(actor('admin'));
    expect((await proxy('tables','POST',{table_number:'1'})).status).toBe(200);
    expect(db.data.tables[0]).toMatchObject({table_number:'Bàn 1',status:'AVAILABLE'});
    expect(db.data.zones).toHaveLength(1);
    expect((await proxy('tables','POST',{table_number:'01'})).status).toBe(409);
    expect(db.data.tables).toHaveLength(1);
  });
  it('does not create takeaway before the receiving account is configured', async () => {
    mocks.payment.mockResolvedValue(null);
    expect((await customerOrder(json({customerName:'Guest',customerPhone:'0912345678',items:[{menu_item_id:mid,quantity:1}]}))).status).toBe(503);
    expect(db.writes).toHaveLength(0);
  });
  it('prevents staff closing a different employee table', async () => {
    db.data.table_sessions[0].assigned_staff_id = 'user_other';
    expect((await proxy('table_sessions', 'PATCH', { status: 'CLOSED', total_amount: 1 }, `?id=eq.${sid}`)).status).toBe(403);
  });
  it('recomputes bill total rather than trusting the client', async () => {
    const response = await proxy('table_sessions', 'PATCH', { status: 'CLOSED', total_amount: 1, closed_at: '1900-01-01' }, `?id=eq.${sid}`);
    expect(response.status).toBe(200); expect(db.data.table_sessions[0].total_amount).toBe(36000);
    expect(db.data.table_sessions[0].closed_at).not.toBe('1900-01-01');
  });
  it('activates paid takeaway once, marks drinks ready and exports stock only once', async () => {
    mocks.actor.mockResolvedValue(actor('admin'));
    db.data.table_sessions[0].session_type = 'TAKEAWAY'; db.data.table_sessions[0].status = 'PENDING_PAYMENT'; db.data.table_sessions[0].table_id = null;
    db.data.order_items[0].status = 'QUEUED';
    expect((await proxy('table_sessions', 'PATCH', { status: 'ACTIVE' }, `?id=eq.${sid}`)).status).toBe(200);
    expect(db.data.order_items[0].status).toBe('READY'); expect(db.data.ingredients[0].stock_quantity).toBe(8);
    expect((await proxy('table_sessions', 'PATCH', { status: 'ACTIVE' }, `?id=eq.${sid}`)).status).toBe(409);
    expect(db.data.ingredients[0].stock_quantity).toBe(8);
  });
});

describe('Customer token boundary and authoritative pricing', () => {
  it.each(['CLOSED', 'PENDING_PAYMENT', 'REQUEST_BILL'])('does not add items to a %s session', async (status) => {
    db.data.table_sessions[0].status = status;
    const response = await customerOrder(json({ token: session.session_token, items: [{ menu_item_id: mid, quantity: 1 }] }));
    expect(response.status).toBe(409); expect(db.data.order_items).toHaveLength(1);
  });
  it('ignores forged price, cost, station and status; updates stock once', async () => {
    const response = await customerOrder(json({ token: session.session_token, items: [{ menu_item_id: mid, quantity: 2, unit_price: 1, unit_cost_price: 0, station: 'KITCHEN', status: 'SERVED' }] }));
    expect(response.status).toBe(200);
    const saved = db.data.order_items[1];
    expect(saved).toMatchObject({ unit_price: 18000, unit_cost_price: 12000, station: 'BAR_INSTANT', status: 'READY' });
    expect(saved.ready_at).toBeTruthy(); expect(db.data.ingredients[0].stock_quantity).toBe(8);
    expect(db.data.inventory_logs).toHaveLength(1);
    const body = await response.json(); expect(body.orders[0].unit_cost_price).toBe(0);
  });
  it('rejects unavailable menu items and invalid quantities', async () => {
    db.data.menu_items[0].is_available = false;
    expect((await customerOrder(json({ token: session.session_token, items: [{ menu_item_id: mid, quantity: 1 }] }))).status).toBe(409);
    expect((await customerOrder(json({ token: session.session_token, items: [{ menu_item_id: mid, quantity: -2 }] }))).status).toBe(400);
  });
  it('does not create an order when stock is insufficient', async () => {
    expect((await customerOrder(json({ token: session.session_token, items: [{ menu_item_id: mid, quantity: 20 }] }))).status).toBe(409);
    expect(db.data.order_items).toHaveLength(1); expect(db.data.ingredients[0].stock_quantity).toBe(10);
  });
  it('restores reserved stock if order insertion fails', async () => {
    db.failures.add('order_items:insert');
    expect((await customerOrder(json({ token: session.session_token, items: [{ menu_item_id: mid, quantity: 2 }] }))).status).toBe(502);
    expect(db.data.ingredients[0].stock_quantity).toBe(10);
  });
  it('does not allow guessing a phone number or session ID to retrieve another order', async () => {
    expect((await customerRead(new Request(`https://pub.example/api/customer/session?customer_phone=0901234567&id=${sid}`))).status).toBe(401);
    expect((await customerRead(new Request('https://pub.example/api/customer/session?token=wrong-token'))).status).toBe(404);
  });
  it('creates pending takeaway with a random token and server total; never exports stock before payment', async () => {
    const response = await customerOrder(json({ customerName: 'Guest', customerPhone: '0901234567', items: [{ menu_item_id: mid, quantity: 2 }], status: 'ACTIVE', total_amount: 1 }));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.session).toMatchObject({ session_type: 'TAKEAWAY', status: 'PENDING_PAYMENT', total_amount: 36000 });
    expect(body.session.session_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.orders[0].status).toBe('QUEUED'); expect(db.data.ingredients[0].stock_quantity).toBe(10);
  });
  it('calculates request-bill totals from saved orders', async () => {
    const response = await customerBill(json({ token: session.session_token, paymentMethod: 'CASH', total_amount: 1 }));
    expect(response.status).toBe(200); expect(db.data.table_sessions[0]).toMatchObject({ status: 'REQUEST_BILL', total_amount: 36000 });
  });
  it('scopes customer snapshots and masks costs, personnel and other-table queue data', async () => {
    db.data.table_sessions.push({ ...session, id: 'other', session_token: 'other-secret', customer_phone: 'private' });
    db.data.order_items.push({ ...item, id: 'other-order', session_id: 'other', status: 'QUEUED', station: 'KITCHEN', note: 'private-note' });
    const response = await customerRead(new Request(`https://pub.example/api/customer/session?token=${session.session_token}`));
    const body = await response.json(); expect(response.status).toBe(200);
    expect(body.sessions).toHaveLength(1); expect(body.orders).toHaveLength(1);
    expect(body.menu[0].cost_price).toBe(0); expect(body.ingredients).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('private-note'); expect(JSON.stringify(body)).not.toContain('other-secret');
    expect(body.queue[0].session_id).toBeUndefined();
  });
});

describe('Return beer permissions and inventory', () => {
  it('returns unused drinks and updates totals and stock once', async () => {
    const response = await returnBeer(json({ orderItemId: oid, quantity: 1 }));
    expect(response.status).toBe(200); expect(db.data.order_items[0].quantity).toBe(1);
    expect(db.data.ingredients[0].stock_quantity).toBe(11); expect(db.data.table_sessions[0].total_amount).toBe(18000);
  });
  it('rejects returning food or another employee table', async () => {
    db.data.menu_items[0].category = 'FOOD';
    expect((await returnBeer(json({ orderItemId: oid, quantity: 1 }))).status).toBe(400);
    db.data.menu_items[0].category = 'BEER'; db.data.table_sessions[0].assigned_staff_id = 'user_other';
    expect((await returnBeer(json({ orderItemId: oid, quantity: 1 }))).status).toBe(403);
  });
});

describe('Live snapshot completeness', () => {
  it('paginates current orders beyond 1,000 rows without including closed bills in staff view', async () => {
    db.data.order_items = Array.from({ length: 1005 }, (_, index) => ({ ...item, id: `order-${index}` }));
    db.data.table_sessions.push({ ...session, id: 'closed-session', status: 'CLOSED' });
    const snapshot = await readSnapshot(actor() as StaffProfileRow, undefined, 'staff');
    expect(snapshot.orders).toHaveLength(1005); expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.orders[1004].id).toBe('order-1004');
  });
  it('gives a manager using the kitchen screen new-order alerts instead of serving alerts', async () => {
    db.data.order_items[0].station = 'KITCHEN'; db.data.order_items[0].status = 'QUEUED';
    const snapshot = await readSnapshot(actor('admin') as StaffProfileRow, undefined, 'kitchen');
    expect(snapshot.alerts.map((alert) => alert.id)).toEqual([`${oid}:queued`]);
  });
});
