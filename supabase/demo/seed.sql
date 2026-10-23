-- ============================================================================
-- 123Dzô DEV/DEMO ONLY: nhân sự và giao dịch giả, không dùng trên DB vận hành.
-- Chỉ database trống có tên kết thúc _demo; SET app.seed_mode='demo' trước khi chạy.
-- Guard chặn chạy lại trên dữ liệu đã tồn tại; không dùng để reset tồn/trạng thái.
-- ============================================================================

BEGIN;
DO $$ BEGIN
    IF current_database() !~ '_demo$' OR current_setting('app.seed_mode',true) IS DISTINCT FROM 'demo' THEN
        RAISE EXCEPTION 'Demo seed requires a dedicated _demo database and app.seed_mode=demo' USING ERRCODE='42501';
    END IF;
END $$;
LOCK TABLE public.zones,public.staff_profiles,public.tables,public.ingredients,public.inventory_logs,public.menu_items,public.table_sessions,public.order_items IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM public.zones) OR EXISTS(SELECT 1 FROM public.staff_profiles) OR EXISTS(SELECT 1 FROM public.tables)
       OR EXISTS(SELECT 1 FROM public.ingredients) OR EXISTS(SELECT 1 FROM public.inventory_logs) OR EXISTS(SELECT 1 FROM public.menu_items)
       OR EXISTS(SELECT 1 FROM public.table_sessions) OR EXISTS(SELECT 1 FROM public.order_items) THEN
        RAISE EXCEPTION 'Demo seed refuses an existing business dataset' USING ERRCODE='55000';
    END IF;
END $$;

-- ============================================================================
-- 1. KHU VỰC BÀN (ZONES)
-- ============================================================================
INSERT INTO public.zones (id, name, created_at)
VALUES
  ('11111111-1111-4111-8111-111111111101', 'Khu Sân Thượng Thoáng Mát', now() - interval '30 days'),
  ('11111111-1111-4111-8111-111111111102', 'Khu Phòng Lạnh VIP', now() - interval '30 days'),
  ('11111111-1111-4111-8111-111111111103', 'Khu Sảnh Chính Xem Bóng Đá', now() - interval '30 days')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ============================================================================
-- 2. HỒ SƠ NHÂN SỰ MẪU (STAFF_PROFILES)
-- Nhân sự demo không phải Clerk user thật. Đăng nhập không tự cấp quyền;
-- cấp nhân sự thật theo STAFF_ACCESS_RUNBOOK, không chạy seed trên DB vận hành.
-- ============================================================================
INSERT INTO public.staff_profiles (id, full_name, role, assigned_zone_id, push_subscription, is_active)
VALUES
  ('staff-admin-01', 'Trần Quản Lý', 'admin', '11111111-1111-4111-8111-111111111101', NULL, true),
  ('staff-waiter-01', 'Nguyễn Văn Hùng (Phục vụ Sân Thượng)', 'staff', '11111111-1111-4111-8111-111111111101', NULL, true),
  ('staff-waiter-02', 'Lê Thị Mai (Phục vụ VIP)', 'staff', '11111111-1111-4111-8111-111111111102', NULL, true),
  ('staff-kitchen-01', 'Bếp Trưởng Hoàng', 'kitchen', NULL, NULL, true)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  assigned_zone_id = EXCLUDED.assigned_zone_id,
  is_active = EXCLUDED.is_active;

-- ============================================================================
-- 3. NGUYÊN LIỆU KHO & BIA (INGREDIENTS)
-- Có sẵn 2 nguyên liệu dưới mức min_threshold để test Cảnh Báo Đỏ tại /admin/inventory
-- ============================================================================
INSERT INTO public.ingredients (id, name, unit, stock_quantity, min_threshold, unit_cost)
VALUES
  ('22222222-2222-4222-8222-222222222201', 'Bia Tiger Crystal (Lon)', 'lon', 168, 48, 15500),
  ('22222222-2222-4222-8222-222222222202', 'Bia Heineken Silver (Lon)', 'lon', 120, 48, 17500),
  ('22222222-2222-4222-8222-222222222203', 'Ốc Hương Tươi Sống (Loại 1)', 'kg', 3.5, 10, 280000),
  ('22222222-2222-4222-8222-222222222204', 'Thịt Bò Úc Thăn Nội', 'kg', 2.0, 8, 240000),
  ('22222222-2222-4222-8222-222222222205', 'Nước Ngọt Coca-Cola (Lon)', 'lon', 96, 24, 6500),
  ('22222222-2222-4222-8222-222222222206', 'Khăn Lạnh 123Dzô', 'cái', 350, 100, 1000)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  unit = EXCLUDED.unit,
  stock_quantity = EXCLUDED.stock_quantity,
  min_threshold = EXCLUDED.min_threshold,
  unit_cost = EXCLUDED.unit_cost;

-- ============================================================================
-- 4. LỊCH SỬ XUẤT NHẬP KHO (INVENTORY_LOGS)
-- ============================================================================
INSERT INTO public.inventory_logs (id, ingredient_id, type, quantity_change, total_cost, note, created_by, created_at)
VALUES
  ('33333333-3333-4333-8333-333333333301', '22222222-2222-4222-8222-222222222201', 'IMPORT', 240, 3720000, 'Nhập 10 thùng Tiger Crystal đầu tuần', 'staff-admin-01', now() - interval '2 days'),
  ('33333333-3333-4333-8333-333333333302', '22222222-2222-4222-8222-222222222202', 'IMPORT', 144, 2520000, 'Nhập 6 thùng Heineken Silver', 'staff-admin-01', now() - interval '2 days'),
  ('33333333-3333-4333-8333-333333333303', '22222222-2222-4222-8222-222222222201', 'RETURN_BEER', 6, 93000, 'Khách Bàn 01 trả lại 6 lon Tiger chưa khui', 'staff-waiter-01', now() - interval '3 hours'),
  ('33333333-3333-4333-8333-333333333304', '22222222-2222-4222-8222-222222222203', 'WASTAGE', -1.0, 280000, 'Hủy 1kg ốc hương ngộp cuối ca', 'staff-admin-01', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 5. THỰC ĐƠN QUÁN NHẬU (MENU_ITEMS)
-- Bao gồm đủ KITCHEN (Mồi nhậu nấu tại bếp) và BAR_INSTANT (Bia/Nước/Khăn lạnh lấy ngay)
-- ============================================================================
INSERT INTO public.menu_items (id, name, category, station, price, cost_price, prep_time_minutes, image_url, is_available, linked_ingredient_id)
VALUES
  ('44444444-4444-4444-8444-444444444401', 'Ốc Hương Xào Bơ Tỏi', 'FOOD', 'KITCHEN', 139000, 75000, 12, NULL, true, NULL),
  ('44444444-4444-4444-8444-444444444402', 'Bò Lúc Lắc Khoai Tây Chiên', 'FOOD', 'KITCHEN', 159000, 85000, 15, NULL, true, NULL),
  ('44444444-4444-4444-8444-444444444403', 'Lẩu Thái Hải Sản Chua Cay', 'FOOD', 'KITCHEN', 249000, 130000, 18, NULL, true, NULL),
  ('44444444-4444-4444-8444-444444444404', 'Sụn Gà Rang Muối Hồng Kông', 'FOOD', 'KITCHEN', 119000, 55000, 10, NULL, true, NULL),
  ('44444444-4444-4444-8444-444444444405', 'Mực Một Nắng Nướng Muối Ớt', 'FOOD', 'KITCHEN', 169000, 90000, 14, NULL, true, NULL),
  ('44444444-4444-4444-8444-444444444406', 'Đậu Hũ Chiên Giòn Chà Bông', 'FOOD', 'KITCHEN', 69000, 25000, 8, NULL, true, NULL),
  ('44444444-4444-4444-8444-444444444407', 'Bia Tiger Crystal Ướp Lạnh', 'BEER', 'BAR_INSTANT', 24000, 15500, 1, NULL, true, '22222222-2222-4222-8222-222222222201'),
  ('44444444-4444-4444-8444-444444444408', 'Bia Heineken Silver Lon Cao', 'BEER', 'BAR_INSTANT', 26000, 17500, 1, NULL, true, '22222222-2222-4222-8222-222222222202'),
  ('44444444-4444-4444-8444-444444444409', 'Coca-Cola Lon Ướp Lạnh', 'DRINK', 'BAR_INSTANT', 15000, 6500, 1, NULL, true, '22222222-2222-4222-8222-222222222205'),
  ('44444444-4444-4444-8444-444444444410', 'Khăn Lạnh 123Dzô', 'OTHER', 'BAR_INSTANT', 3000, 1000, 1, NULL, true, '22222222-2222-4222-8222-222222222206')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  station = EXCLUDED.station,
  price = EXCLUDED.price,
  cost_price = EXCLUDED.cost_price,
  prep_time_minutes = EXCLUDED.prep_time_minutes,
  is_available = EXCLUDED.is_available,
  linked_ingredient_id = EXCLUDED.linked_ingredient_id;

-- ============================================================================
-- 6. BÀN VẬT LÝ (TABLES) - Khởi tạo trước, lát nữa gán current_session_id sau
-- ============================================================================
INSERT INTO public.tables (id, table_number, zone_id, status, current_session_id)
VALUES
  ('55555555-5555-4555-8555-555555555501', 'Bàn 01', '11111111-1111-4111-8111-111111111101', 'OCCUPIED', NULL),
  ('55555555-5555-4555-8555-555555555502', 'Bàn 02', '11111111-1111-4111-8111-111111111101', 'OCCUPIED', NULL),
  ('55555555-5555-4555-8555-555555555503', 'Bàn 03', '11111111-1111-4111-8111-111111111101', 'AVAILABLE', NULL),
  ('55555555-5555-4555-8555-555555555504', 'Bàn 04', '11111111-1111-4111-8111-111111111101', 'AVAILABLE', NULL),
  ('55555555-5555-4555-8555-555555555505', 'VIP 01', '11111111-1111-4111-8111-111111111102', 'OCCUPIED', NULL),
  ('55555555-5555-4555-8555-555555555506', 'VIP 02', '11111111-1111-4111-8111-111111111102', 'AVAILABLE', NULL),
  ('55555555-5555-4555-8555-555555555507', 'Sảnh 01', '11111111-1111-4111-8111-111111111103', 'AVAILABLE', NULL),
  ('55555555-5555-4555-8555-555555555508', 'Sảnh 02', '11111111-1111-4111-8111-111111111103', 'AVAILABLE', NULL)
ON CONFLICT (id) DO UPDATE SET
  table_number = EXCLUDED.table_number,
  zone_id = EXCLUDED.zone_id,
  status = EXCLUDED.status;

-- ============================================================================
-- 7. PHIÊN NHẬU & ĐƠN MANG VỀ (TABLE_SESSIONS)
-- - Bàn 01 (ACTIVE): token = 'demo-table-session-token'
-- - Bàn 02 (ACTIVE): token = 'ban-02-active-token' (Cùng gọi trùng món với Bàn 01 để test Batch Cooking!)
-- - VIP 01 (REQUEST_BILL): token = 'vip-01-bill-token' (Đang gọi tính tiền để test In Bill K80 tại /admin/bills!)
-- - 2 Phiên CLOSED: Phục vụ hiển thị biểu đồ Doanh thu & KPI tại /admin
-- ============================================================================
INSERT INTO public.table_sessions (
  id, session_token, session_type, table_id, assigned_staff_id,
  customer_name, customer_phone, status, payment_method, payment_code,
  total_amount, opened_at, closed_at
)
VALUES
  (
    '66666666-6666-4666-8666-666666666601',
    'demo-table-session-token',
    'DINE_IN',
    '55555555-5555-4555-8555-555555555501',
    'staff-waiter-01',
    'Anh Trung (Bàn 01)',
    '0901234567',
    'ACTIVE',
    'VIETQR',
    'DZO2026BAN01',
    677000,
    now() - interval '45 minutes',
    NULL
  ),
  (
    '66666666-6666-4666-8666-666666666602',
    'ban-02-active-token',
    'DINE_IN',
    '55555555-5555-4555-8555-555555555502',
    'staff-waiter-01',
    'Anh Nam (Bàn 02)',
    '0912345678',
    'ACTIVE',
    'CASH',
    'DZO2026BAN02',
    557000,
    now() - interval '30 minutes',
    NULL
  ),
  (
    '66666666-6666-4666-8666-666666666603',
    'vip-01-bill-token',
    'DINE_IN',
    '55555555-5555-4555-8555-555555555505',
    'staff-waiter-02',
    'Đoàn Khách VIP 01',
    '0987654321',
    'REQUEST_BILL',
    'VIETQR',
    'DZO2026VIP01',
    978000,
    now() - interval '90 minutes',
    NULL
  ),
  (
    '66666666-6666-4666-8666-666666666604',
    'closed-session-01',
    'DINE_IN',
    '55555555-5555-4555-8555-555555555503',
    'staff-waiter-01',
    'Khách Đã Đóng Bàn 03',
    '0933445566',
    'CLOSED',
    'VIETQR',
    'DZO2026CLS01',
    1240000,
    now() - interval '4 hours',
    now() - interval '2 hours'
  ),
  (
    '66666666-6666-4666-8666-666666666605',
    'closed-takeaway-01',
    'TAKEAWAY',
    NULL,
    'staff-waiter-02',
    'Anh Tuấn Mang Về',
    '0977889900',
    'CLOSED',
    'VIETQR',
    'DZO2026TW99',
    417000,
    now() - interval '3 hours',
    now() - interval '2 hours 30 minutes'
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  total_amount = EXCLUDED.total_amount,
  assigned_staff_id = EXCLUDED.assigned_staff_id;

-- Liên kết current_session_id cho 3 bàn đang mở
UPDATE public.tables SET current_session_id = '66666666-6666-4666-8666-666666666601', status = 'OCCUPIED' WHERE id = '55555555-5555-4555-8555-555555555501';
UPDATE public.tables SET current_session_id = '66666666-6666-4666-8666-666666666602', status = 'OCCUPIED' WHERE id = '55555555-5555-4555-8555-555555555502';
UPDATE public.tables SET current_session_id = '66666666-6666-4666-8666-666666666603', status = 'OCCUPIED' WHERE id = '55555555-5555-4555-8555-555555555505';

-- ============================================================================
-- 8. CHI TIẾT ĐƠN GỌI MÓN (ORDER_ITEMS)
-- Thiết kế đầy đủ kịch bản:
-- - 2 bàn cùng gọi "Ốc Hương Xào Bơ Tỏi" (QUEUED) -> Hiện ngay ở cột Gom Món Trùng (Batch Cooking) bên /kitchen!
-- - 1 món "Lẩu Thái" đang COOKING -> Có thể bấm "Hoàn thành" ngay bên /kitchen!
-- - 2 món Bia Tiger & Sụn Gà đang READY -> Hiện ngay ở thanh "Món chờ bưng" bên /staff!
-- - Các món SERVED có đầy đủ cooking_started_at, ready_at, served_at -> Lên biểu đồ KPI tại /admin!
-- ============================================================================
INSERT INTO public.order_items (
  id, session_id, menu_item_id, quantity, note, station, status, batch_id,
  unit_price, unit_cost_price, served_by_staff_id,
  created_at, cooking_started_at, ready_at, served_at
)
VALUES
  -- [Bàn 01] Ốc Hương đang QUEUED (Trùng với Bàn 02 -> Gom mẻ Batch Cooking!)
  (
    '77777777-7777-4777-8777-777777777701',
    '66666666-6666-4666-8666-666666666601',
    '44444444-4444-4444-8444-444444444401',
    2,
    'Cay vừa, thêm bánh mì',
    'KITCHEN',
    'QUEUED',
    NULL,
    139000,
    75000,
    NULL,
    now() - interval '6 minutes',
    NULL,
    NULL,
    NULL
  ),
  -- [Bàn 02] Ốc Hương đang QUEUED (Trùng với Bàn 01 -> Gom mẻ Batch Cooking!)
  (
    '77777777-7777-4777-8777-777777777702',
    '66666666-6666-4666-8666-666666666602',
    '44444444-4444-4444-8444-444444444401',
    1,
    'Cay nhiều',
    'KITCHEN',
    'QUEUED',
    NULL,
    139000,
    75000,
    NULL,
    now() - interval '4 minutes',
    NULL,
    NULL,
    NULL
  ),
  -- [Bàn 01] Bò Lúc Lắc đang COOKING tại Bếp
  (
    '77777777-7777-4777-8777-777777777703',
    '66666666-6666-4666-8666-666666666601',
    '44444444-4444-4444-8444-444444444402',
    1,
    'Bò chín tới',
    'KITCHEN',
    'COOKING',
    NULL,
    159000,
    85000,
    NULL,
    now() - interval '10 minutes',
    now() - interval '5 minutes',
    NULL,
    NULL
  ),
  -- [Bàn 01] 10 Lon Bia Tiger (BAR_INSTANT -> Nhảy thẳng READY chờ nhân viên bưng & có thể test Trả bia thừa!)
  (
    '77777777-7777-4777-8777-777777777704',
    '66666666-6666-4666-8666-666666666601',
    '44444444-4444-4444-8444-444444444407',
    10,
    'Xô đá lớn',
    'BAR_INSTANT',
    'READY',
    NULL,
    24000,
    15500,
    NULL,
    now() - interval '3 minutes',
    NULL,
    now() - interval '3 minutes',
    NULL
  ),
  -- [Bàn 02] Lẩu Thái đã nấu xong (READY -> Chờ nhân viên bưng lên bàn!)
  (
    '77777777-7777-4777-8777-777777777705',
    '66666666-6666-4666-8666-666666666602',
    '44444444-4444-4444-8444-444444444403',
    1,
    'Thêm bún tươi',
    'KITCHEN',
    'READY',
    NULL,
    249000,
    130000,
    NULL,
    now() - interval '18 minutes',
    now() - interval '15 minutes',
    now() - interval '1 minute',
    NULL
  ),
  -- [Bàn 02] Mực Một Nắng đã bưng (SERVED)
  (
    '77777777-7777-4777-8777-777777777706',
    '66666666-6666-4666-8666-666666666602',
    '44444444-4444-4444-8444-444444444405',
    1,
    NULL,
    'KITCHEN',
    'SERVED',
    NULL,
    169000,
    90000,
    'staff-waiter-01',
    now() - interval '25 minutes',
    now() - interval '22 minutes',
    now() - interval '12 minutes',
    now() - interval '11 minutes'
  ),
  -- [VIP 01 - REQUEST_BILL] Các món đã phục vụ chờ In Bill nhiệt K80
  (
    '77777777-7777-4777-8777-777777777707',
    '66666666-6666-4666-8666-666666666603',
    '44444444-4444-4444-8444-444444444403',
    2,
    NULL,
    'KITCHEN',
    'SERVED',
    '88888888-8888-4888-8888-888888888801',
    249000,
    130000,
    'staff-waiter-02',
    now() - interval '80 minutes',
    now() - interval '75 minutes',
    now() - interval '60 minutes',
    now() - interval '59 minutes'
  ),
  (
    '77777777-7777-4777-8777-777777777708',
    '66666666-6666-4666-8666-666666666603',
    '44444444-4444-4444-8444-444444444407',
    20,
    NULL,
    'BAR_INSTANT',
    'SERVED',
    NULL,
    24000,
    15500,
    'staff-waiter-02',
    now() - interval '85 minutes',
    NULL,
    now() - interval '85 minutes',
    now() - interval '84 minutes'
  ),
  -- [Phiên Đã Đóng - CLOSED] Phục vụ thống kê Doanh thu & KPI
  (
    '77777777-7777-4777-8777-777777777709',
    '66666666-6666-4666-8666-666666666604',
    '44444444-4444-4444-8444-444444444401',
    4,
    NULL,
    'KITCHEN',
    'SERVED',
    '88888888-8888-4888-8888-888888888802',
    139000,
    75000,
    'staff-waiter-01',
    now() - interval '3 hours 50 minutes',
    now() - interval '3 hours 45 minutes',
    now() - interval '3 hours 35 minutes',
    now() - interval '3 hours 34 minutes'
  ),
  (
    '77777777-7777-4777-8777-777777777710',
    '66666666-6666-4666-8666-666666666604',
    '44444444-4444-4444-8444-444444444408',
    24,
    NULL,
    'BAR_INSTANT',
    'SERVED',
    NULL,
    26000,
    17500,
    'staff-waiter-01',
    now() - interval '3 hours 55 minutes',
    NULL,
    now() - interval '3 hours 55 minutes',
    now() - interval '3 hours 54 minutes'
  )
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  quantity = EXCLUDED.quantity;

UPDATE public.table_sessions AS s SET total_amount=(SELECT coalesce(sum(quantity*unit_price),0) FROM public.order_items WHERE session_id=s.id AND status<>'CANCELLED');
COMMIT;
