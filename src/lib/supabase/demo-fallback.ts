/**
 * Kiểm tra xem biến môi trường NEXT_PUBLIC_SUPABASE_URL đã được cấu hình bằng Project thật hay chưa.
 * Nếu chưa cấu hình (hoặc đang để giá trị mẫu your-project-id.supabase.co),
 * hệ thống sẽ phản hồi tức thì (< 1ms) bằng dữ liệu Demo trong bộ nhớ thay vì treo DNS timeout 10-15 giây.
 */
export function isPlaceholderSupabaseUrl(url: string | undefined): boolean {
  if (!url) return true;
  if (!url.startsWith('http')) return true;
  return (
    url.includes('your-project-id.supabase.co') ||
    url.includes('placeholder-project.supabase.co')
  );
}

const DEMO_DATA_BY_TABLE: Record<string, unknown[]> = {
  zones: [
    {
      id: 'zone-san-thuong',
      name: 'Khu Sân Thượng Thoáng Mát',
      created_at: '2026-10-01T08:00:00.000Z',
    },
    {
      id: 'zone-phong-vip',
      name: 'Khu Phòng Lạnh VIP',
      created_at: '2026-10-01T08:00:00.000Z',
    },
  ],
  staff_profiles: [
    {
      id: 'staff-admin-01',
      full_name: 'Trần Quản Lý (Demo)',
      role: 'admin',
      assigned_zone_id: 'zone-san-thuong',
      push_subscription: null,
      is_active: true,
    },
    {
      id: 'staff-waiter-01',
      full_name: 'Nguyễn Phục Vụ (Demo)',
      role: 'staff',
      assigned_zone_id: 'zone-san-thuong',
      push_subscription: null,
      is_active: true,
    },
  ],
  tables: [
    {
      id: 'table-01',
      table_number: 'Bàn 01',
      zone_id: 'zone-san-thuong',
      status: 'OCCUPIED',
      current_session_id: 'session-demo-01',
    },
    {
      id: 'table-02',
      table_number: 'Bàn 02',
      zone_id: 'zone-san-thuong',
      status: 'AVAILABLE',
      current_session_id: null,
    },
    {
      id: 'table-03',
      table_number: 'Bàn VIP 01',
      zone_id: 'zone-phong-vip',
      status: 'AVAILABLE',
      current_session_id: null,
    },
  ],
  ingredients: [
    {
      id: 'ing-tiger',
      name: 'Bia Tiger Crystal (Lon)',
      unit: 'lon',
      stock_quantity: 144,
      min_threshold: 48,
      unit_cost: 15500,
    },
    {
      id: 'ing-oc-huong',
      name: 'Ốc Hương Tươi Sống',
      unit: 'kg',
      stock_quantity: 4,
      min_threshold: 10,
      unit_cost: 280000,
    },
  ],
  inventory_logs: [
    {
      id: 'log-demo-01',
      ingredient_id: 'ing-tiger',
      type: 'IMPORT',
      quantity_change: 144,
      total_cost: 2232000,
      note: 'Nhập 6 thùng Tiger đầu ca',
      created_by: 'staff-admin-01',
      created_at: '2026-10-21T08:00:00.000Z',
    },
  ],
  menu_items: [
    {
      id: 'menu-oc-huong',
      name: 'Ốc Hương Xào Bơ Tỏi',
      category: 'FOOD',
      station: 'KITCHEN',
      price: 139000,
      cost_price: 75000,
      prep_time_minutes: 12,
      image_url: null,
      is_available: true,
      linked_ingredient_id: 'ing-oc-huong',
    },
    {
      id: 'menu-bo-luc-lac',
      name: 'Bò Lúc Lắc Khoai Tây',
      category: 'FOOD',
      station: 'KITCHEN',
      price: 159000,
      cost_price: 85000,
      prep_time_minutes: 15,
      image_url: null,
      is_available: true,
      linked_ingredient_id: null,
    },
    {
      id: 'menu-lau-thai',
      name: 'Lẩu Thái Hải Sản Chua Cay',
      category: 'FOOD',
      station: 'KITCHEN',
      price: 249000,
      cost_price: 130000,
      prep_time_minutes: 18,
      image_url: null,
      is_available: true,
      linked_ingredient_id: null,
    },
    {
      id: 'menu-bia-tiger',
      name: 'Bia Tiger Crystal Ướp Lạnh',
      category: 'BEER',
      station: 'BAR_INSTANT',
      price: 24000,
      cost_price: 15500,
      prep_time_minutes: 1,
      image_url: null,
      is_available: true,
      linked_ingredient_id: 'ing-tiger',
    },
    {
      id: 'menu-khan-lanh',
      name: 'Khăn Lạnh 123Dzô',
      category: 'OTHER',
      station: 'BAR_INSTANT',
      price: 3000,
      cost_price: 1000,
      prep_time_minutes: 1,
      image_url: null,
      is_available: true,
      linked_ingredient_id: null,
    },
  ],
  table_sessions: [
    {
      id: 'session-demo-01',
      session_token: 'demo-table-session-token',
      session_type: 'DINE_IN',
      table_id: 'table-01',
      assigned_staff_id: 'staff-waiter-01',
      customer_name: 'Khách Bàn 01',
      customer_phone: '0901234567',
      status: 'ACTIVE',
      payment_method: 'VIETQR',
      payment_code: 'DZO2026DEMO',
      total_amount: 518000,
      opened_at: '2026-10-21T11:00:00.000Z',
      closed_at: null,
    },
  ],
  order_items: [
    {
      id: 'order-demo-01',
      session_id: 'session-demo-01',
      menu_item_id: 'menu-oc-huong',
      quantity: 2,
      note: 'Cay vừa, nhiều bơ tỏi',
      station: 'KITCHEN',
      status: 'QUEUED',
      batch_id: null,
      unit_price: 139000,
      unit_cost_price: 75000,
      served_by_staff_id: null,
      created_at: '2026-10-21T11:05:00.000Z',
      cooking_started_at: null,
      ready_at: null,
      served_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
    },
    {
      id: 'order-demo-02',
      session_id: 'session-demo-01',
      menu_item_id: 'menu-bia-tiger',
      quantity: 10,
      note: 'Ướp xô đá lớn',
      station: 'BAR_INSTANT',
      status: 'READY',
      batch_id: null,
      unit_price: 24000,
      unit_cost_price: 15500,
      served_by_staff_id: null,
      created_at: '2026-10-21T11:06:00.000Z',
      cooking_started_at: null,
      ready_at: '2026-10-21T11:06:00.000Z',
      served_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
    },
  ],
  vw_kpi_financial_summary: [
    {
      gross_revenue: 18500000,
      cash_revenue: 7200000,
      vietqr_revenue: 11300000,
      dine_in_revenue: 15400000,
      takeaway_revenue: 3100000,
      closed_sessions_count: 34,
      total_cogs: 8950000,
      total_wastage_cost: 250000,
      net_profit: 9300000,
    },
  ],
  vw_kpi_peak_hours: [
    {
      hour_of_day: 18,
      total_orders_count: 14,
      total_items_quantity: 45,
      total_order_value: 4200000,
    },
    {
      hour_of_day: 19,
      total_orders_count: 26,
      total_items_quantity: 88,
      total_order_value: 7800000,
    },
    {
      hour_of_day: 20,
      total_orders_count: 22,
      total_items_quantity: 74,
      total_order_value: 6500000,
    },
  ],
  vw_kpi_menu_analytics: [
    {
      menu_item_id: 'menu-oc-huong',
      name: 'Ốc Hương Xào Bơ Tỏi',
      category: 'FOOD',
      station: 'KITCHEN',
      is_available: true,
      total_quantity_sold: 48,
      gross_revenue: 6672000,
      total_cogs: 3600000,
      gross_profit: 3072000,
    },
    {
      menu_item_id: 'menu-bia-tiger',
      name: 'Bia Tiger Crystal Ướp Lạnh',
      category: 'BEER',
      station: 'BAR_INSTANT',
      is_available: true,
      total_quantity_sold: 320,
      gross_revenue: 7680000,
      total_cogs: 4960000,
      gross_profit: 2720000,
    },
  ],
  vw_kpi_kitchen_performance: [
    {
      total_cooked_items: 120,
      batch_cooked_items: 54,
      avg_queue_wait_minutes: 3.2,
      avg_actual_cook_minutes: 9.8,
      avg_standard_prep_minutes: 12.0,
      cook_time_evaluation: 'ON_TIME',
      batch_cooking_efficiency_pct: 45.0,
      slow_cancelled_count: 1,
    },
  ],
  vw_kpi_waitstaff_performance: [
    {
      staff_id: 'staff-waiter-01',
      full_name: 'Nguyễn Phục Vụ (Demo)',
      role: 'staff',
      assigned_zone_id: 'zone-san-thuong',
      is_active: true,
      tables_opened_count: 18,
      managed_tables_revenue: 11200000,
      active_serving_count: 85,
      avg_pickup_speed_seconds: 42,
      pickup_speed_evaluation: 'EXCELLENT',
    },
  ],
};

/**
 * Custom fetch tốc độ 0ms dùng khi người dùng chưa cấu hình Supabase thật trong .env.local
 */
export const instantDemoFetch: typeof fetch = async (input, init) => {
  const urlStr = typeof input === 'string' ? input : input.toString();
  const method = (init?.method ?? 'GET').toUpperCase();
  const acceptHeader =
    init?.headers &&
    typeof init.headers === 'object' &&
    'Accept' in init.headers
      ? String((init.headers as Record<string, string>).Accept)
      : '';
  const isSingleObject = acceptHeader.includes(
    'application/vnd.pgrst.object+json'
  );

  const match = urlStr.match(/\/rest\/v1\/([a-z0-9_]+)/i);
  const tableName = match?.[1] ?? '';
  const rows = DEMO_DATA_BY_TABLE[tableName] ?? [];

  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
      },
    });
  }

  // Nếu truy vấn theo session_token trên table_sessions, lọc đúng token để tránh trả nhầm khi test invalid token
  if (
    tableName === 'table_sessions' &&
    urlStr.includes('session_token=eq.')
  ) {
    const tokenMatch = urlStr.match(/session_token=eq\.([^&]+)/);
    const token = tokenMatch?.[1] ? decodeURIComponent(tokenMatch[1]) : '';
    const found = (rows as Array<{ session_token?: string }>).find(
      (r) => r.session_token === token
    );
    if (isSingleObject) {
      if (!found) {
        return new Response(
          JSON.stringify({
            code: 'PGRST116',
            message: 'The result contains 0 rows',
          }),
          { status: 406, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify(found), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(found ? [found] : []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (method !== 'GET') {
    let bodyObj: Record<string, unknown> = {};
    if (typeof init?.body === 'string') {
      try {
        const parsed = JSON.parse(init.body) as unknown;
        bodyObj = Array.isArray(parsed)
          ? ((parsed[0] as Record<string, unknown>) ?? {})
          : ((parsed as Record<string, unknown>) ?? {});
      } catch {
        bodyObj = {};
      }
    }
    const baseRow = (rows[0] as Record<string, unknown> | undefined) ?? {
      id: `demo-${Date.now()}`,
    };
    const merged = { ...baseRow, ...bodyObj };
    return new Response(
      JSON.stringify(isSingleObject ? merged : [merged]),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  if (isSingleObject) {
    const first = rows[0] ?? null;
    if (!first) {
      return new Response(
        JSON.stringify({
          code: 'PGRST116',
          message: 'The result contains 0 rows',
        }),
        { status: 406, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify(first), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
