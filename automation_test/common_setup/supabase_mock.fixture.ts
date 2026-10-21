import type { Page, Route } from '@playwright/test';
import {
  MOCK_ACTIVE_SESSION,
  MOCK_INGREDIENTS,
  MOCK_INVENTORY_LOGS,
  MOCK_MENU_ITEMS,
  MOCK_ORDER_ITEMS,
  MOCK_STAFF,
  MOCK_TABLES,
  MOCK_ZONES,
} from './mock_data';

export interface CapturedSupabaseMutation {
  table: string;
  method: string;
  url: string;
  body: unknown;
}

/**
 * Thiết lập Network Interceptor cho các cuộc gọi REST tới Supabase & Internal APIs
 * Giúp kiểm thử 100% các thao tác gửi đơn, đổi trạng thái KDS, trả bia, nhập kho mà không làm bẩn DB thật.
 */
export async function setupSupabaseAndApiMocks(page: Page): Promise<{
  mutations: CapturedSupabaseMutation[];
  pushNotifications: unknown[];
}> {
  const mutations: CapturedSupabaseMutation[] = [];
  const pushNotifications: unknown[] = [];

  await page.route('**/rest/v1/**', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const tableMatch = url.match(/\/rest\/v1\/([a-z_]+)/i);
    const table = tableMatch?.[1] ?? 'unknown';

    let parsedBody: unknown = null;
    try {
      parsedBody = req.postDataJSON();
    } catch {
      parsedBody = null;
    }

    if (method !== 'GET') {
      mutations.push({ table, method, url, body: parsedBody });
    }

    if (table === 'table_sessions') {
      if (method === 'POST' || method === 'PATCH') {
        const merged = Array.isArray(parsedBody)
          ? { ...MOCK_ACTIVE_SESSION, ...parsedBody[0] }
          : { ...MOCK_ACTIVE_SESSION, ...(parsedBody as object) };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(merged),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([MOCK_ACTIVE_SESSION]),
      });
      return;
    }

    if (table === 'order_items') {
      if (method === 'POST') {
        const items = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
        const created = items.map((item, idx) => ({
          id: `mock-order-item-${Date.now()}-${idx}`,
          created_at: new Date().toISOString(),
          cooking_started_at: null,
          ready_at: null,
          served_at: null,
          served_by_staff_id: null,
          cancelled_by_staff_id: null,
          cancel_reason: null,
          batch_id: null,
          returned_quantity: 0,
          ...item,
        }));
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
        return;
      }

      if (method === 'PATCH') {
        const updated = MOCK_ORDER_ITEMS.map((item) => ({
          ...item,
          ...(parsedBody as object),
        }));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(updated),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ORDER_ITEMS),
      });
      return;
    }

    if (table === 'menu_items') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MENU_ITEMS),
      });
      return;
    }

    if (table === 'ingredients') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_INGREDIENTS),
      });
      return;
    }

    if (table === 'inventory_logs') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_INVENTORY_LOGS),
      });
      return;
    }

    if (table === 'tables') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TABLES),
      });
      return;
    }

    if (table === 'zones') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ZONES),
      });
      return;
    }

    if (table === 'staff_profiles') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_STAFF),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/push/notify', async (route: Route) => {
    try {
      pushNotifications.push(route.request().postDataJSON());
    } catch {
      pushNotifications.push({});
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, notifiedCount: 1 }),
    });
  });

  return { mutations, pushNotifications };
}
