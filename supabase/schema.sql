-- ============================================================================
-- 123Dzo Smart POS & KDS PWA - SUPABASE DATABASE SCHEMA (PostgreSQL)
-- Tuân thủ tuyệt đối Mục 5, Mục 11 và Mục 12 của tài liệu đặc tả (PRD_SPEC.md)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. BẢNG ZONES (Khu vực bàn)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. BẢNG STAFF_PROFILES (Hồ sơ nhân sự - Đồng bộ với Clerk)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.staff_profiles (
    id text PRIMARY KEY, -- clerk_user_id
    full_name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'staff', 'kitchen')),
    assigned_zone_id uuid REFERENCES public.zones(id) ON DELETE SET NULL,
    push_subscription jsonb,
    is_active boolean NOT NULL DEFAULT true
);

-- ============================================================================
-- 3. BẢNG TABLES (Bàn vật lý)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tables (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_number text NOT NULL,
    zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED')),
    current_session_id uuid
);

-- ============================================================================
-- 4. BẢNG INGREDIENTS (Kho nguyên liệu & Bia)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ingredients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    unit text NOT NULL,
    stock_quantity numeric NOT NULL DEFAULT 0,
    min_threshold numeric NOT NULL DEFAULT 0,
    unit_cost numeric NOT NULL DEFAULT 0
);

-- ============================================================================
-- 5. BẢNG INVENTORY_LOGS (Lịch sử Xuất / Nhập / Hủy kho)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.inventory_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
    type text NOT NULL CHECK (type IN ('IMPORT', 'EXPORT_SALE', 'RETURN_BEER', 'WASTAGE')),
    quantity_change numeric NOT NULL,
    total_cost numeric NOT NULL DEFAULT 0,
    note text,
    created_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. BẢNG MENU_ITEMS (Thực đơn)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.menu_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    category text NOT NULL CHECK (category IN ('FOOD', 'BEER', 'DRINK', 'OTHER')),
    station text NOT NULL CHECK (station IN ('KITCHEN', 'BAR_INSTANT')),
    price numeric NOT NULL CHECK (price >= 0),
    cost_price numeric NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    prep_time_minutes integer NOT NULL DEFAULT 10 CHECK (prep_time_minutes >= 0),
    image_url text,
    is_available boolean NOT NULL DEFAULT true,
    linked_ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE SET NULL
);

-- ============================================================================
-- 7. BẢNG TABLE_SESSIONS (Phiên nhậu tại bàn & Đơn mang về)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.table_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token text NOT NULL UNIQUE,
    session_type text NOT NULL CHECK (session_type IN ('DINE_IN', 'TAKEAWAY')),
    table_id uuid REFERENCES public.tables(id) ON DELETE SET NULL,
    assigned_staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
    customer_name text,
    customer_phone text,
    status text NOT NULL CHECK (status IN ('PENDING_PAYMENT', 'ACTIVE', 'REQUEST_BILL', 'CLOSED')),
    payment_method text CHECK (payment_method IN ('CASH', 'VIETQR')),
    payment_code text UNIQUE,
    total_amount numeric NOT NULL DEFAULT 0,
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);

-- Ràng buộc khóa ngoại hai chiều giữa tables.current_session_id và table_sessions.id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_tables_current_session'
    ) THEN
        ALTER TABLE public.tables
            ADD CONSTRAINT fk_tables_current_session
            FOREIGN KEY (current_session_id)
            REFERENCES public.table_sessions(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================================
-- 8. BẢNG ORDER_ITEMS (Chi tiết từng món gọi - Trái tim của Realtime & Analytics)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
    menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity > 0),
    note text,
    station text NOT NULL CHECK (station IN ('KITCHEN', 'BAR_INSTANT')),
    status text NOT NULL CHECK (status IN ('QUEUED', 'COOKING', 'READY', 'SERVED', 'CANCELLED')),
    batch_id uuid,
    unit_price numeric NOT NULL,
    unit_cost_price numeric NOT NULL,
    served_by_staff_id text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    cooking_started_at timestamptz,
    ready_at timestamptz,
    served_at timestamptz,
    cancelled_at timestamptz,
    cancelled_by text REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
    cancel_reason text
);

-- ============================================================================
-- 9. INDEXES TỐI ƯU HIỆU NĂNG TRUY VẤN & REALTIME
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_tables_zone_id ON public.tables(zone_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_token ON public.table_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_table_sessions_status ON public.table_sessions(status);
CREATE INDEX IF NOT EXISTS idx_table_sessions_opened_at ON public.table_sessions(opened_at);
CREATE INDEX IF NOT EXISTS idx_table_sessions_assigned_staff ON public.table_sessions(assigned_staff_id);
CREATE INDEX IF NOT EXISTS idx_order_items_session_id ON public.order_items(session_id);
CREATE INDEX IF NOT EXISTS idx_order_items_queue_lookup ON public.order_items(station, status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_served_by ON public.order_items(served_by_staff_id);
CREATE INDEX IF NOT EXISTS idx_order_items_created_at ON public.order_items(created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_created_at ON public.inventory_logs(created_at, type);

-- ============================================================================
-- 10. KÍCH HOẠT SUPABASE REALTIME CHO TABLE_SESSIONS & ORDER_ITEMS
-- ============================================================================
ALTER TABLE public.table_sessions REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'table_sessions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.table_sessions;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_items'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
    END IF;
END $$;

-- ============================================================================
-- 11. HỆ THỐNG SQL VIEWS & RPC FUNCTIONS PHỤC VỤ DASHBOARD KPI (MỤC 11)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 11.1. VIEW & FUNCTION ĐÁNH GIÁ TÀI CHÍNH (DOANH THU, COGS, HAO HỤT, LỢI NHUẬN RÒNG & GIỜ VÀNG)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_kpi_financial_summary AS
WITH session_rev AS (
    SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED'), 0) AS gross_revenue,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND payment_method = 'CASH'), 0) AS cash_revenue,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND payment_method = 'VIETQR'), 0) AS vietqr_revenue,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND session_type = 'DINE_IN'), 0) AS dine_in_revenue,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND session_type = 'TAKEAWAY'), 0) AS takeaway_revenue,
        COUNT(id) FILTER (WHERE status = 'CLOSED') AS closed_sessions_count
    FROM public.table_sessions
),
item_cogs AS (
    SELECT
        COALESCE(SUM(unit_cost_price * quantity) FILTER (WHERE status = 'SERVED'), 0) AS total_cogs
    FROM public.order_items
),
wastage AS (
    SELECT
        COALESCE(SUM(ABS(total_cost)) FILTER (WHERE type = 'WASTAGE'), 0) AS total_wastage_cost
    FROM public.inventory_logs
)
SELECT
    sr.gross_revenue,
    sr.cash_revenue,
    sr.vietqr_revenue,
    sr.dine_in_revenue,
    sr.takeaway_revenue,
    sr.closed_sessions_count,
    ic.total_cogs,
    w.total_wastage_cost,
    (sr.gross_revenue - ic.total_cogs - w.total_wastage_cost) AS net_profit
FROM session_rev sr
CROSS JOIN item_cogs ic
CROSS JOIN wastage w;

-- View Khung giờ vàng (Peak Hours Heatmap)
CREATE OR REPLACE VIEW public.vw_kpi_peak_hours AS
SELECT
    EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer AS hour_of_day,
    COUNT(id)::bigint AS total_orders_count,
    COALESCE(SUM(quantity), 0)::bigint AS total_items_quantity,
    COALESCE(SUM(unit_price * quantity), 0)::numeric AS total_order_value
FROM public.order_items
WHERE status <> 'CANCELLED'
GROUP BY EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))
ORDER BY hour_of_day ASC;

-- RPC Function lọc Tài chính theo khoảng thời gian (Hôm nay / Tuần này / Tháng này / Tùy chọn)
CREATE OR REPLACE FUNCTION public.fn_get_financial_kpi(
    p_start_date timestamptz DEFAULT (date_trunc('month', now())),
    p_end_date timestamptz DEFAULT now()
)
RETURNS TABLE (
    gross_revenue numeric,
    cash_revenue numeric,
    vietqr_revenue numeric,
    dine_in_revenue numeric,
    takeaway_revenue numeric,
    closed_sessions_count bigint,
    total_cogs numeric,
    total_wastage_cost numeric,
    net_profit numeric
)
LANGUAGE sql
STABLE
AS $$
    WITH session_rev AS (
        SELECT
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED'), 0) AS gross_revenue,
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND payment_method = 'CASH'), 0) AS cash_revenue,
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND payment_method = 'VIETQR'), 0) AS vietqr_revenue,
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND session_type = 'DINE_IN'), 0) AS dine_in_revenue,
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED' AND session_type = 'TAKEAWAY'), 0) AS takeaway_revenue,
            COUNT(id) FILTER (WHERE status = 'CLOSED') AS closed_sessions_count
        FROM public.table_sessions
        WHERE opened_at >= p_start_date AND opened_at <= p_end_date
    ),
    item_cogs AS (
        SELECT
            COALESCE(SUM(unit_cost_price * quantity) FILTER (WHERE status = 'SERVED'), 0) AS total_cogs
        FROM public.order_items
        WHERE created_at >= p_start_date AND created_at <= p_end_date
    ),
    wastage AS (
        SELECT
            COALESCE(SUM(ABS(total_cost)) FILTER (WHERE type = 'WASTAGE'), 0) AS total_wastage_cost
        FROM public.inventory_logs
        WHERE created_at >= p_start_date AND created_at <= p_end_date
    )
    SELECT
        sr.gross_revenue,
        sr.cash_revenue,
        sr.vietqr_revenue,
        sr.dine_in_revenue,
        sr.takeaway_revenue,
        sr.closed_sessions_count,
        ic.total_cogs,
        w.total_wastage_cost,
        (sr.gross_revenue - ic.total_cogs - w.total_wastage_cost) AS net_profit
    FROM session_rev sr
    CROSS JOIN item_cogs ic
    CROSS JOIN wastage w;
$$;

-- ----------------------------------------------------------------------------
-- 11.2. VIEW & FUNCTION ĐÁNH GIÁ THỰC ĐƠN (TOP MỒI BÉN, BIA TIÊU THỤ & CẢNH BÁO MÓN Ế)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_kpi_menu_analytics AS
SELECT
    m.id AS menu_item_id,
    m.name,
    m.category,
    m.station,
    m.is_available,
    COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::bigint AS total_quantity_sold,
    COALESCE(SUM(oi.unit_price * oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::numeric AS gross_revenue,
    COALESCE(SUM(oi.unit_cost_price * oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::numeric AS total_cogs,
    COALESCE(SUM((oi.unit_price - oi.unit_cost_price) * oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::numeric AS gross_profit
FROM public.menu_items m
LEFT JOIN public.order_items oi ON oi.menu_item_id = m.id
GROUP BY m.id, m.name, m.category, m.station, m.is_available;

CREATE OR REPLACE FUNCTION public.fn_get_menu_kpi(
    p_start_date timestamptz DEFAULT (date_trunc('month', now())),
    p_end_date timestamptz DEFAULT now()
)
RETURNS TABLE (
    menu_item_id uuid,
    name text,
    category text,
    station text,
    is_available boolean,
    total_quantity_sold bigint,
    gross_revenue numeric,
    total_cogs numeric,
    gross_profit numeric
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        m.id AS menu_item_id,
        m.name,
        m.category,
        m.station,
        m.is_available,
        COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::bigint AS total_quantity_sold,
        COALESCE(SUM(oi.unit_price * oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::numeric AS gross_revenue,
        COALESCE(SUM(oi.unit_cost_price * oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::numeric AS total_cogs,
        COALESCE(SUM((oi.unit_price - oi.unit_cost_price) * oi.quantity) FILTER (WHERE oi.status = 'SERVED'), 0)::numeric AS gross_profit
    FROM public.menu_items m
    LEFT JOIN public.order_items oi
        ON oi.menu_item_id = m.id
        AND oi.created_at >= p_start_date
        AND oi.created_at <= p_end_date
    GROUP BY m.id, m.name, m.category, m.station, m.is_available
    ORDER BY total_quantity_sold DESC, gross_profit DESC;
$$;

-- ----------------------------------------------------------------------------
-- 11.3. VIEW & FUNCTION ĐÁNH GIÁ HIỆU SUẤT ĐẦU BẾP (KITCHEN KPI)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_kpi_kitchen_performance AS
WITH kitchen_stats AS (
    SELECT
        COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED')::bigint AS total_cooked_items,
        COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED' AND oi.batch_id IS NOT NULL)::bigint AS batch_cooked_items,
        ROUND(
            COALESCE(
                AVG(EXTRACT(EPOCH FROM (oi.cooking_started_at - oi.created_at)) / 60.0)
                FILTER (WHERE oi.status = 'SERVED' AND oi.cooking_started_at IS NOT NULL),
                0
            )::numeric,
            2
        ) AS avg_queue_wait_minutes,
        ROUND(
            COALESCE(
                AVG(EXTRACT(EPOCH FROM (oi.ready_at - oi.cooking_started_at)) / 60.0)
                FILTER (WHERE oi.status = 'SERVED' AND oi.ready_at IS NOT NULL AND oi.cooking_started_at IS NOT NULL),
                0
            )::numeric,
            2
        ) AS avg_actual_cook_minutes,
        ROUND(
            COALESCE(
                AVG(m.prep_time_minutes) FILTER (WHERE oi.status = 'SERVED'),
                0
            )::numeric,
            2
        ) AS avg_standard_prep_minutes,
        COUNT(oi.id) FILTER (
            WHERE oi.status = 'CANCELLED'
            AND oi.cancelled_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (oi.cancelled_at - oi.created_at)) > 900
        )::bigint AS slow_cancelled_count
    FROM public.order_items oi
    INNER JOIN public.menu_items m ON m.id = oi.menu_item_id
    WHERE oi.station = 'KITCHEN'
)
SELECT
    ks.total_cooked_items,
    ks.batch_cooked_items,
    ks.avg_queue_wait_minutes,
    ks.avg_actual_cook_minutes,
    ks.avg_standard_prep_minutes,
    CASE
        WHEN ks.avg_standard_prep_minutes = 0 OR ks.avg_actual_cook_minutes <= ks.avg_standard_prep_minutes THEN 'ON_TIME'
        WHEN ks.avg_actual_cook_minutes <= (ks.avg_standard_prep_minutes * 1.3) THEN 'WARNING'
        ELSE 'LATE'
    END AS cook_time_evaluation,
    ROUND(
        CASE
            WHEN ks.total_cooked_items > 0 THEN (ks.batch_cooked_items::numeric / ks.total_cooked_items::numeric) * 100.0
            ELSE 0
        END,
        2
    ) AS batch_cooking_efficiency_pct,
    ks.slow_cancelled_count
FROM kitchen_stats ks;

CREATE OR REPLACE FUNCTION public.fn_get_kitchen_kpi(
    p_start_date timestamptz DEFAULT (date_trunc('month', now())),
    p_end_date timestamptz DEFAULT now()
)
RETURNS TABLE (
    total_cooked_items bigint,
    batch_cooked_items bigint,
    avg_queue_wait_minutes numeric,
    avg_actual_cook_minutes numeric,
    avg_standard_prep_minutes numeric,
    cook_time_evaluation text,
    batch_cooking_efficiency_pct numeric,
    slow_cancelled_count bigint
)
LANGUAGE sql
STABLE
AS $$
    WITH kitchen_stats AS (
        SELECT
            COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED')::bigint AS total_cooked_items,
            COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED' AND oi.batch_id IS NOT NULL)::bigint AS batch_cooked_items,
            ROUND(
                COALESCE(
                    AVG(EXTRACT(EPOCH FROM (oi.cooking_started_at - oi.created_at)) / 60.0)
                    FILTER (WHERE oi.status = 'SERVED' AND oi.cooking_started_at IS NOT NULL),
                    0
                )::numeric,
                2
            ) AS avg_queue_wait_minutes,
            ROUND(
                COALESCE(
                    AVG(EXTRACT(EPOCH FROM (oi.ready_at - oi.cooking_started_at)) / 60.0)
                    FILTER (WHERE oi.status = 'SERVED' AND oi.ready_at IS NOT NULL AND oi.cooking_started_at IS NOT NULL),
                    0
                )::numeric,
                2
            ) AS avg_actual_cook_minutes,
            ROUND(
                COALESCE(
                    AVG(m.prep_time_minutes) FILTER (WHERE oi.status = 'SERVED'),
                    0
                )::numeric,
                2
            ) AS avg_standard_prep_minutes,
            COUNT(oi.id) FILTER (
                WHERE oi.status = 'CANCELLED'
                AND oi.cancelled_at IS NOT NULL
                AND EXTRACT(EPOCH FROM (oi.cancelled_at - oi.created_at)) > 900
            )::bigint AS slow_cancelled_count
        FROM public.order_items oi
        INNER JOIN public.menu_items m ON m.id = oi.menu_item_id
        WHERE oi.station = 'KITCHEN'
          AND oi.created_at >= p_start_date
          AND oi.created_at <= p_end_date
    )
    SELECT
        ks.total_cooked_items,
        ks.batch_cooked_items,
        ks.avg_queue_wait_minutes,
        ks.avg_actual_cook_minutes,
        ks.avg_standard_prep_minutes,
        CASE
            WHEN ks.avg_standard_prep_minutes = 0 OR ks.avg_actual_cook_minutes <= ks.avg_standard_prep_minutes THEN 'ON_TIME'
            WHEN ks.avg_actual_cook_minutes <= (ks.avg_standard_prep_minutes * 1.3) THEN 'WARNING'
            ELSE 'LATE'
        END AS cook_time_evaluation,
        ROUND(
            CASE
                WHEN ks.total_cooked_items > 0 THEN (ks.batch_cooked_items::numeric / ks.total_cooked_items::numeric) * 100.0
                ELSE 0
            END,
            2
        ) AS batch_cooking_efficiency_pct,
        ks.slow_cancelled_count
    FROM kitchen_stats ks;
$$;

-- ----------------------------------------------------------------------------
-- 11.4. VIEW & FUNCTION ĐÁNH GIÁ HIỆU SUẤT NHÂN VIÊN CHẠY BÀN (WAITSTAFF KPI)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_kpi_waitstaff_performance AS
WITH session_metrics AS (
    SELECT
        assigned_staff_id AS staff_id,
        COUNT(id)::bigint AS tables_opened_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED'), 0)::numeric AS managed_tables_revenue
    FROM public.table_sessions
    WHERE assigned_staff_id IS NOT NULL
    GROUP BY assigned_staff_id
),
serving_metrics AS (
    SELECT
        served_by_staff_id AS staff_id,
        COUNT(id) FILTER (WHERE status = 'SERVED')::bigint AS active_serving_count,
        ROUND(
            COALESCE(
                AVG(EXTRACT(EPOCH FROM (served_at - ready_at)))
                FILTER (WHERE status = 'SERVED' AND served_at IS NOT NULL AND ready_at IS NOT NULL),
                0
            )::numeric,
            2
        ) AS avg_pickup_speed_seconds
    FROM public.order_items
    WHERE served_by_staff_id IS NOT NULL
    GROUP BY served_by_staff_id
)
SELECT
    sp.id AS staff_id,
    sp.full_name,
    sp.role,
    sp.assigned_zone_id,
    sp.is_active,
    COALESCE(sm.tables_opened_count, 0)::bigint AS tables_opened_count,
    COALESCE(sm.managed_tables_revenue, 0)::numeric AS managed_tables_revenue,
    COALESCE(svm.active_serving_count, 0)::bigint AS active_serving_count,
    COALESCE(svm.avg_pickup_speed_seconds, 0)::numeric AS avg_pickup_speed_seconds,
    CASE
        WHEN COALESCE(svm.active_serving_count, 0) = 0 THEN 'NO_DATA'
        WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) < 90 THEN 'EXCELLENT'
        WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) <= 180 THEN 'NORMAL'
        ELSE 'SLOW'
    END AS pickup_speed_evaluation
FROM public.staff_profiles sp
LEFT JOIN session_metrics sm ON sm.staff_id = sp.id
LEFT JOIN serving_metrics svm ON svm.staff_id = sp.id
WHERE sp.role IN ('staff', 'admin');

CREATE OR REPLACE FUNCTION public.fn_get_waitstaff_kpi(
    p_start_date timestamptz DEFAULT (date_trunc('month', now())),
    p_end_date timestamptz DEFAULT now()
)
RETURNS TABLE (
    staff_id text,
    full_name text,
    role text,
    assigned_zone_id uuid,
    is_active boolean,
    tables_opened_count bigint,
    managed_tables_revenue numeric,
    active_serving_count bigint,
    avg_pickup_speed_seconds numeric,
    pickup_speed_evaluation text
)
LANGUAGE sql
STABLE
AS $$
    WITH session_metrics AS (
        SELECT
            assigned_staff_id AS staff_id,
            COUNT(id)::bigint AS tables_opened_count,
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED'), 0)::numeric AS managed_tables_revenue
        FROM public.table_sessions
        WHERE assigned_staff_id IS NOT NULL
          AND opened_at >= p_start_date
          AND opened_at <= p_end_date
        GROUP BY assigned_staff_id
    ),
    serving_metrics AS (
        SELECT
            served_by_staff_id AS staff_id,
            COUNT(id) FILTER (WHERE status = 'SERVED')::bigint AS active_serving_count,
            ROUND(
                COALESCE(
                    AVG(EXTRACT(EPOCH FROM (served_at - ready_at)))
                    FILTER (WHERE status = 'SERVED' AND served_at IS NOT NULL AND ready_at IS NOT NULL),
                    0
                )::numeric,
                2
            ) AS avg_pickup_speed_seconds
        FROM public.order_items
        WHERE served_by_staff_id IS NOT NULL
          AND created_at >= p_start_date
          AND created_at <= p_end_date
        GROUP BY served_by_staff_id
    )
    SELECT
        sp.id AS staff_id,
        sp.full_name,
        sp.role,
        sp.assigned_zone_id,
        sp.is_active,
        COALESCE(sm.tables_opened_count, 0)::bigint AS tables_opened_count,
        COALESCE(sm.managed_tables_revenue, 0)::numeric AS managed_tables_revenue,
        COALESCE(svm.active_serving_count, 0)::bigint AS active_serving_count,
        COALESCE(svm.avg_pickup_speed_seconds, 0)::numeric AS avg_pickup_speed_seconds,
        CASE
            WHEN COALESCE(svm.active_serving_count, 0) = 0 THEN 'NO_DATA'
            WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) < 90 THEN 'EXCELLENT'
            WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) <= 180 THEN 'NORMAL'
            ELSE 'SLOW'
        END AS pickup_speed_evaluation
    FROM public.staff_profiles sp
    LEFT JOIN session_metrics sm ON sm.staff_id = sp.id
    LEFT JOIN serving_metrics svm ON svm.staff_id = sp.id
    WHERE sp.role IN ('staff', 'admin')
    ORDER BY active_serving_count DESC, managed_tables_revenue DESC;
$$;

-- Admin staff API (spec amendment 2026-10-22)
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_admin_save_staff(
    p_actor_id text,
    p_profile jsonb,
    p_expected jsonb
)
RETURNS TABLE (id text, full_name text, role text, assigned_zone_id uuid, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $$
DECLARE
    v_target public.staff_profiles%ROWTYPE;
    v_id text;
    v_name text;
    v_role text;
    v_active boolean;
    v_zone uuid;
    v_before jsonb;
BEGIN
    IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
        RAISE EXCEPTION 'Invalid profile' USING ERRCODE = '22023';
    END IF;
    IF NOT (p_profile ?& ARRAY['id','full_name','role','assigned_zone_id','is_active'])
       OR p_profile - ARRAY['id','full_name','role','assigned_zone_id','is_active'] <> '{}'::jsonb
       OR jsonb_typeof(p_profile->'id') <> 'string'
       OR (p_profile->>'id') !~ '^user_[A-Za-z0-9_]{1,128}$'
       OR jsonb_typeof(p_profile->'full_name') <> 'string'
       OR length(btrim(p_profile->>'full_name')) NOT BETWEEN 1 AND 120
       OR jsonb_typeof(p_profile->'role') <> 'string'
       OR (p_profile->>'role') NOT IN ('admin','staff','kitchen')
       OR jsonb_typeof(p_profile->'is_active') <> 'boolean'
       OR jsonb_typeof(p_profile->'assigned_zone_id') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'Invalid profile' USING ERRCODE = '22023';
    END IF;
    v_id := p_profile->>'id';
    v_name := btrim(p_profile->>'full_name');
    v_role := p_profile->>'role';
    v_active := (p_profile->>'is_active')::boolean;
    BEGIN
        v_zone := (p_profile->>'assigned_zone_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid zone' USING ERRCODE = '22023';
    END;

    -- Staff administration is infrequent. Serialize all writes, including
    -- service-role subscription updates, to prevent last-admin write skew.
    LOCK TABLE public.staff_profiles IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS (
        SELECT 1 FROM public.staff_profiles AS actor
        WHERE actor.id = p_actor_id AND actor.role = 'admin' AND actor.is_active
    ) THEN
        RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
    END IF;

    SELECT sp.* INTO v_target FROM public.staff_profiles AS sp WHERE sp.id = v_id;
    IF p_expected IS NULL THEN
        IF FOUND THEN
            RAISE EXCEPTION 'Profile already exists' USING ERRCODE = '23505';
        END IF;
        INSERT INTO public.staff_profiles (id, full_name, role, assigned_zone_id, is_active)
        VALUES (v_id, v_name, v_role, v_zone, v_active);
    ELSE
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
        END IF;
        v_before := jsonb_build_object(
            'id', v_target.id, 'full_name', v_target.full_name, 'role', v_target.role,
            'assigned_zone_id', v_target.assigned_zone_id, 'is_active', v_target.is_active
        );
        IF p_expected IS DISTINCT FROM v_before THEN
            RAISE EXCEPTION 'Profile changed' USING ERRCODE = '40001';
        END IF;
        IF v_target.role = 'admin' AND v_target.is_active AND (v_role <> 'admin' OR NOT v_active)
           AND (SELECT count(*) FROM public.staff_profiles AS sp WHERE sp.role = 'admin' AND sp.is_active) <= 1 THEN
            RAISE EXCEPTION 'Cannot remove the last active admin' USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.staff_profiles AS sp
        SET full_name = v_name, role = v_role, assigned_zone_id = v_zone, is_active = v_active
        WHERE sp.id = v_id;
    END IF;
    RETURN QUERY SELECT sp.id, sp.full_name, sp.role, sp.assigned_zone_id, sp.is_active
        FROM public.staff_profiles AS sp WHERE sp.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_save_staff(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_save_staff(text, jsonb, jsonb) TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, full_name, role, assigned_zone_id, push_subscription, is_active),
       UPDATE (id, full_name, role, assigned_zone_id, push_subscription, is_active)
       ON public.staff_profiles FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Operation ledger (spec amendment 2026-10-22)
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.operation_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_key text NOT NULL CHECK (length(btrim(scope_key)) BETWEEN 1 AND 256),
    operation_id uuid NOT NULL,
    action text NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 80),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    session_id uuid REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
    actor_id text REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
    result jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 16384)),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    UNIQUE (scope_key, operation_id),
    CHECK ((result IS NULL) = (completed_at IS NULL)),
    CHECK (completed_at IS NULL OR completed_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_operation_requests_created ON private.operation_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_operation_requests_session ON private.operation_requests(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operation_requests_actor ON private.operation_requests(actor_id);
ALTER TABLE private.operation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.operation_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_operation_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM private.operation_requests AS op WHERE op.id = NEW.id AND op.completed_at IS NULL) THEN
        RAISE EXCEPTION 'Operation must complete in its business transaction' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS operation_must_complete ON private.operation_requests;
CREATE CONSTRAINT TRIGGER operation_must_complete
    AFTER INSERT OR UPDATE ON private.operation_requests
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.assert_operation_completed();

CREATE OR REPLACE FUNCTION private.begin_operation(
    p_scope_key text, p_operation_id uuid, p_action text, p_request jsonb,
    p_session_id uuid, p_actor_id text
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    v_hash text;
    v_inserted uuid;
    v_op private.operation_requests%ROWTYPE;
BEGIN
    IF p_scope_key IS NULL OR length(btrim(p_scope_key)) NOT BETWEEN 1 AND 256
       OR p_operation_id IS NULL OR p_action IS NULL OR length(btrim(p_action)) NOT BETWEEN 1 AND 80
       OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
       OR octet_length(p_request::text) > 32768 THEN
        RAISE EXCEPTION 'Invalid operation request' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');
    INSERT INTO private.operation_requests(scope_key, operation_id, action, request_hash, session_id, actor_id)
    VALUES (p_scope_key, p_operation_id, p_action, v_hash, p_session_id, p_actor_id)
    ON CONFLICT (scope_key, operation_id) DO NOTHING
    RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN
        RETURN jsonb_build_object('replay', false);
    END IF;

    SELECT op.* INTO STRICT v_op FROM private.operation_requests AS op
    WHERE op.scope_key = p_scope_key AND op.operation_id = p_operation_id FOR UPDATE;
    IF v_op.request_hash <> v_hash OR v_op.action <> p_action
       OR v_op.session_id IS DISTINCT FROM p_session_id OR v_op.actor_id IS DISTINCT FROM p_actor_id THEN
        RAISE EXCEPTION 'Operation key reused with different input' USING ERRCODE = '22000';
    END IF;
    IF v_op.completed_at IS NULL THEN
        RAISE EXCEPTION 'Operation is already in progress in this transaction' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object('replay', true, 'result', v_op.result);
END;
$$;

CREATE OR REPLACE FUNCTION private.complete_operation(p_scope_key text, p_operation_id uuid, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    v_op private.operation_requests%ROWTYPE;
BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 16384 THEN
        RAISE EXCEPTION 'Invalid operation result' USING ERRCODE = '22023';
    END IF;
    SELECT op.* INTO v_op FROM private.operation_requests AS op
    WHERE op.scope_key = p_scope_key AND op.operation_id = p_operation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Operation not claimed' USING ERRCODE = 'P0002';
    END IF;
    IF v_op.completed_at IS NOT NULL THEN
        IF v_op.result IS DISTINCT FROM p_result THEN
            RAISE EXCEPTION 'Operation result is immutable' USING ERRCODE = '22000';
        END IF;
        RETURN v_op.result;
    END IF;
    UPDATE private.operation_requests AS op SET result = p_result, completed_at = clock_timestamp()
    WHERE op.id = v_op.id;
    RETURN p_result;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_operation_completed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.begin_operation(text, uuid, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.complete_operation(text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;

-- Dine-in orders (spec amendment 2026-10-22)
BEGIN;

-- A 30-line order with full notes needs more than the initial ledger 16KiB.
ALTER TABLE private.operation_requests DROP CONSTRAINT IF EXISTS operation_requests_result_check;
ALTER TABLE private.operation_requests ADD CONSTRAINT operation_requests_result_check
    CHECK (result IS NULL OR (jsonb_typeof(result)='object' AND octet_length(result::text)<=65536));

CREATE TABLE IF NOT EXISTS private.notification_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dedupe_key text NOT NULL UNIQUE,
    session_id uuid REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
    order_item_id uuid REFERENCES public.order_items(id) ON DELETE RESTRICT,
    kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 80),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 4096),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    locked_until timestamptz,
    delivered_at timestamptz,
    last_error text CHECK (length(last_error) <= 1000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_due ON private.notification_outbox(available_at, locked_until) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_outbox_session ON private.notification_outbox(session_id);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_item ON private.notification_outbox(order_item_id);
ALTER TABLE private.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.notification_outbox FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS idx_operation_requests_order_rate ON private.operation_requests(session_id, completed_at)
    WHERE action = 'dine_in.order';

CREATE OR REPLACE FUNCTION private.authorize_dine_in_session(p_session_id uuid, p_token text, p_actor text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_session public.table_sessions%ROWTYPE;
BEGIN
    SELECT s.* INTO v_session FROM public.table_sessions AS s WHERE s.id=p_session_id FOR UPDATE;
    IF NOT FOUND OR v_session.session_type <> 'DINE_IN' THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE='P0002';
    END IF;
    IF p_actor IS NULL THEN
        IF p_token IS NULL OR p_token IS DISTINCT FROM v_session.session_token THEN
            RAISE EXCEPTION 'Invalid capability' USING ERRCODE='42501';
        END IF;
    ELSE
        IF p_token IS NOT NULL THEN RAISE EXCEPTION 'Invalid identity' USING ERRCODE='42501'; END IF;
        PERFORM 1 FROM public.staff_profiles AS sp
          WHERE sp.id=p_actor AND sp.is_active AND sp.role IN ('staff','admin') FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
    END IF;
    IF v_session.status NOT IN ('ACTIVE','REQUEST_BILL') THEN
        RAISE EXCEPTION 'Session cannot accept orders' USING ERRCODE='P1001';
    END IF;
    RETURN 'session:' || p_session_id::text || ':' || CASE WHEN p_actor IS NULL THEN 'customer' ELSE 'staff:' || p_actor END;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_submit_dine_in_order(
    p_session_id uuid, p_session_token text, p_actor_id text, p_operation_id uuid, p_lines jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_scope text; v_claim jsonb; v_line jsonb; v_menu public.menu_items%ROWTYPE;
    v_stock record; v_item public.order_items%ROWTYPE; v_total numeric; v_now timestamptz;
    v_lines jsonb := '[]'::jsonb; v_items jsonb := '[]'::jsonb; v_result jsonb;
BEGIN
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'Invalid order lines' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 30 OR octet_length(p_lines::text)>32768 THEN
        RAISE EXCEPTION 'Invalid order lines' USING ERRCODE='22023';
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
        IF jsonb_typeof(v_line) <> 'object' THEN RAISE EXCEPTION 'Invalid line' USING ERRCODE='22023'; END IF;
        IF NOT (v_line ?& ARRAY['menu_item_id','quantity','note','expected_price'])
           OR v_line - ARRAY['menu_item_id','quantity','note','expected_price'] <> '{}'::jsonb
           OR jsonb_typeof(v_line->'menu_item_id') <> 'string'
           OR (v_line->>'menu_item_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
           OR jsonb_typeof(v_line->'quantity') <> 'number'
           OR jsonb_typeof(v_line->'expected_price') <> 'number'
           OR jsonb_typeof(v_line->'note') <> 'string' OR length(v_line->>'note')>500 THEN
            RAISE EXCEPTION 'Invalid line fields' USING ERRCODE='22023';
        END IF;
        IF (v_line->>'quantity')::numeric NOT BETWEEN 1 AND 99
           OR (v_line->>'quantity')::numeric <> trunc((v_line->>'quantity')::numeric)
           OR (v_line->>'expected_price')::numeric < 0 OR (v_line->>'expected_price')::numeric > 1000000000 THEN
            RAISE EXCEPTION 'Invalid line values' USING ERRCODE='22023';
        END IF;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'menu_item_id', (v_line->>'menu_item_id')::uuid, 'quantity',(v_line->>'quantity')::int,
          'note',btrim(v_line->>'note'),'expected_price',(v_line->>'expected_price')::numeric));
    END LOOP;

    v_scope := private.authorize_dine_in_session(p_session_id,p_session_token,p_actor_id);
    v_claim := private.begin_operation(v_scope,p_operation_id,'dine_in.order',jsonb_build_object('lines',v_lines),p_session_id,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.table_sessions WHERE id=p_session_id AND status='ACTIVE') THEN
        RAISE EXCEPTION 'Session is not active' USING ERRCODE='P1001';
    END IF;
    IF (SELECT count(*) FROM private.operation_requests AS op WHERE op.session_id=p_session_id
        AND op.action='dine_in.order' AND op.completed_at > clock_timestamp()-interval '10 seconds') >= 2 THEN
        RAISE EXCEPTION 'Order rate limit exceeded' USING ERRCODE='P1006';
    END IF;

    PERFORM m.id FROM public.menu_items AS m WHERE m.id IN
      (SELECT (value->>'menu_item_id')::uuid FROM jsonb_array_elements(v_lines)) ORDER BY m.id FOR SHARE;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
        SELECT m.* INTO v_menu FROM public.menu_items AS m WHERE m.id=(v_line->>'menu_item_id')::uuid;
        IF NOT FOUND OR NOT v_menu.is_available THEN RAISE EXCEPTION 'Menu unavailable' USING ERRCODE='P1002'; END IF;
        IF v_menu.price::text IN ('NaN','Infinity','-Infinity') OR v_menu.cost_price::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Menu cost needs verification' USING ERRCODE='P1005';
        END IF;
        IF v_menu.price <> (v_line->>'expected_price')::numeric THEN
            RAISE EXCEPTION 'Price changed' USING ERRCODE='P1003',
              DETAIL=jsonb_build_object('menuItemId',v_menu.id,'price',v_menu.price)::text;
        END IF;
        IF v_menu.linked_ingredient_id IS NOT NULL AND (v_menu.category='FOOD' OR v_menu.station<>'BAR_INSTANT') THEN
            RAISE EXCEPTION 'Inventory mapping needs verification' USING ERRCODE='P1005';
        END IF;
    END LOOP;
    FOR v_stock IN
      SELECT ing.id,ing.stock_quantity,ing.unit_cost,need.quantity FROM public.ingredients AS ing
      JOIN (SELECT m.linked_ingredient_id AS id,sum((line->>'quantity')::int) AS quantity
        FROM jsonb_array_elements(v_lines) AS line JOIN public.menu_items AS m ON m.id=(line->>'menu_item_id')::uuid
        WHERE m.linked_ingredient_id IS NOT NULL GROUP BY m.linked_ingredient_id) AS need ON need.id=ing.id
      ORDER BY ing.id FOR UPDATE OF ing
    LOOP
        IF v_stock.stock_quantity::text IN ('NaN','Infinity','-Infinity') OR v_stock.unit_cost::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Inventory values need verification' USING ERRCODE='P1005';
        END IF;
        IF v_stock.stock_quantity < v_stock.quantity OR v_stock.unit_cost < 0 THEN
            RAISE EXCEPTION 'Insufficient stock' USING ERRCODE='P1004';
        END IF;
        UPDATE public.ingredients SET stock_quantity=stock_quantity-v_stock.quantity WHERE id=v_stock.id;
        INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost,note,created_by)
        VALUES(v_stock.id,'EXPORT_SALE',-v_stock.quantity,v_stock.quantity*v_stock.unit_cost,
          'Order operation '||p_operation_id::text,p_actor_id);
    END LOOP;
    v_now := clock_timestamp();
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
        SELECT m.* INTO STRICT v_menu FROM public.menu_items AS m WHERE m.id=(v_line->>'menu_item_id')::uuid;
        INSERT INTO public.order_items(session_id,menu_item_id,quantity,note,station,status,unit_price,unit_cost_price,created_at,ready_at)
        VALUES(p_session_id,v_menu.id,(v_line->>'quantity')::int,nullif(v_line->>'note',''),v_menu.station,
          CASE WHEN v_menu.station='BAR_INSTANT' THEN 'READY' ELSE 'QUEUED' END,v_menu.price,v_menu.cost_price,
          v_now,CASE WHEN v_menu.station='BAR_INSTANT' THEN v_now ELSE NULL END) RETURNING * INTO v_item;
        v_items := v_items || jsonb_build_array(to_jsonb(v_item)-'unit_cost_price'-'served_by_staff_id'-'cancelled_by');
        INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload)
        VALUES('new-item:'||v_item.id::text,p_session_id,v_item.id,
          CASE WHEN v_menu.station='BAR_INSTANT' THEN 'ORDER_READY' ELSE 'KITCHEN_ORDER_CREATED' END,
          jsonb_build_object('sessionId',p_session_id,'orderItemId',v_item.id));
    END LOOP;
    SELECT coalesce(sum(oi.quantity*oi.unit_price),0) INTO v_total FROM public.order_items AS oi
      WHERE oi.session_id=p_session_id AND oi.status<>'CANCELLED';
    UPDATE public.table_sessions SET total_amount=v_total WHERE id=p_session_id;
    v_result := jsonb_build_object('sessionId',p_session_id,'operationId',p_operation_id,'totalAmount',v_total,'items',v_items);
    RETURN private.complete_operation(v_scope,p_operation_id,v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_dine_in_operation(
    p_session_id uuid, p_session_token text, p_actor_id text, p_operation_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_scope text; v_result jsonb;
BEGIN
    v_scope := private.authorize_dine_in_session(p_session_id,p_session_token,p_actor_id);
    SELECT op.result INTO v_result FROM private.operation_requests AS op
    WHERE op.scope_key=v_scope AND op.operation_id=p_operation_id AND op.action='dine_in.order';
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.authorize_dine_in_session(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_submit_dine_in_order(uuid,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_get_dine_in_operation(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_submit_dine_in_order(uuid,text,text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_dine_in_operation(uuid,text,text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION private.complete_operation(p_scope_key text, p_operation_id uuid, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    v_op private.operation_requests%ROWTYPE;
BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 65536 THEN
        RAISE EXCEPTION 'Invalid operation result' USING ERRCODE = '22023';
    END IF;
    SELECT op.* INTO v_op FROM private.operation_requests AS op
    WHERE op.scope_key = p_scope_key AND op.operation_id = p_operation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Operation not claimed' USING ERRCODE = 'P0002';
    END IF;
    IF v_op.completed_at IS NOT NULL THEN
        IF v_op.result IS DISTINCT FROM p_result THEN
            RAISE EXCEPTION 'Operation result is immutable' USING ERRCODE = '22000';
        END IF;
        RETURN v_op.result;
    END IF;
    UPDATE private.operation_requests AS op SET result = p_result, completed_at = clock_timestamp()
    WHERE op.id = v_op.id;
    RETURN p_result;
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Manual inventory API (spec amendment 2026-10-22)
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_admin_record_inventory(
    p_actor_id text, p_operation_id uuid, p_input jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET lock_timeout = '5s' AS $$
DECLARE
    v_scope text := 'manual-inventory:' || p_actor_id;
    v_type text;
    v_id uuid;
    v_quantity numeric;
    v_cost numeric;
    v_change numeric;
    v_note text;
    v_request jsonb;
    v_claim jsonb;
    v_ingredient public.ingredients%ROWTYPE;
    v_log_id uuid;
    v_result jsonb;
BEGIN
    PERFORM 1 FROM public.staff_profiles WHERE id = p_actor_id AND role = 'admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active admin required' USING ERRCODE = '42501'; END IF;
    IF p_operation_id IS NULL OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object'
       OR octet_length(p_input::text) > 8192 THEN
        RAISE EXCEPTION 'Invalid inventory input' USING ERRCODE = '22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_input) AS k)
       IS DISTINCT FROM ARRAY['ingredientId','note','quantity','type','unitCost']::text[]
       OR jsonb_typeof(p_input->'ingredientId') <> 'string'
       OR (p_input->>'ingredientId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR jsonb_typeof(p_input->'type') <> 'string'
       OR (p_input->>'type') NOT IN ('IMPORT','WASTAGE')
       OR jsonb_typeof(p_input->'quantity') <> 'number'
       OR jsonb_typeof(p_input->'note') <> 'string' OR length(p_input->>'note') > 500 THEN
        RAISE EXCEPTION 'Invalid inventory input' USING ERRCODE = '22023';
    END IF;
    v_type := p_input->>'type';
    v_id := (p_input->>'ingredientId')::uuid;
    v_quantity := trim_scale((p_input->>'quantity')::numeric);
    v_note := btrim(p_input->>'note');
    IF v_quantity <= 0 OR v_quantity > 1000000 OR round(v_quantity,3) <> v_quantity
       OR (v_type = 'WASTAGE' AND (v_note = '' OR p_input->'unitCost' <> 'null'::jsonb)) THEN
        RAISE EXCEPTION 'Invalid inventory quantity or reason' USING ERRCODE = '22023';
    END IF;
    IF v_type = 'IMPORT' THEN
        IF jsonb_typeof(p_input->'unitCost') <> 'number' THEN
            RAISE EXCEPTION 'Import cost required' USING ERRCODE = '22023';
        END IF;
        v_cost := trim_scale((p_input->>'unitCost')::numeric);
        IF v_cost < 0 OR v_cost > 1000000000 OR round(v_cost,2) <> v_cost THEN
            RAISE EXCEPTION 'Invalid import cost' USING ERRCODE = '22023';
        END IF;
    END IF;
    v_request := jsonb_build_object('ingredientId',v_id,'type',v_type,'quantity',v_quantity,
                                  'unitCost',v_cost,'note',v_note);
    -- GET uses this same lock, so it waits for an in-flight transaction before returning null.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope || ':' || p_operation_id::text,0));
    v_claim := private.begin_operation(v_scope,p_operation_id,'MANUAL_INVENTORY',v_request,NULL,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;

    SELECT * INTO v_ingredient FROM public.ingredients WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ingredient missing' USING ERRCODE = 'P0002'; END IF;
    IF NOT (v_ingredient.stock_quantity >= 0 AND v_ingredient.stock_quantity < 'Infinity'::numeric)
       OR NOT (v_ingredient.unit_cost >= 0 AND v_ingredient.unit_cost <= 1000000000) THEN
        RAISE EXCEPTION 'Invalid existing inventory value' USING ERRCODE = 'P1102';
    END IF;
    v_change := CASE WHEN v_type = 'IMPORT' THEN v_quantity ELSE -v_quantity END;
    IF v_ingredient.stock_quantity + v_change < 0 THEN
        RAISE EXCEPTION 'Insufficient stock' USING ERRCODE = 'P1004';
    END IF;
    IF v_type = 'WASTAGE' THEN v_cost := v_ingredient.unit_cost; END IF;
    UPDATE public.ingredients SET stock_quantity = stock_quantity + v_change,
        unit_cost = CASE WHEN v_type = 'IMPORT' THEN v_cost ELSE unit_cost END WHERE id = v_id;
    INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost,note,created_by)
    VALUES (v_id,v_type,v_change,round(v_quantity*v_cost,2),nullif(v_note,''),p_actor_id)
    RETURNING id INTO v_log_id;
    v_result := jsonb_build_object('operationId',p_operation_id,'ingredientId',v_id,'logId',v_log_id,
                                 'quantityChange',v_change,'totalCost',round(v_quantity*v_cost,2));
    RETURN private.complete_operation(v_scope,p_operation_id,v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_get_inventory_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog SET lock_timeout = '5s' AS $$
DECLARE v_scope text := 'manual-inventory:' || p_actor_id; v_result jsonb;
BEGIN
    PERFORM 1 FROM public.staff_profiles WHERE id = p_actor_id AND role = 'admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active admin required' USING ERRCODE = '42501'; END IF;
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE = '22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope || ':' || p_operation_id::text,0));
    SELECT result INTO v_result FROM private.operation_requests
    WHERE scope_key = v_scope AND operation_id = p_operation_id AND action = 'MANUAL_INVENTORY'
      AND actor_id = p_actor_id AND completed_at IS NOT NULL;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_admin_record_inventory(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_admin_get_inventory_operation(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_record_inventory(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_admin_get_inventory_operation(text,uuid) TO service_role;
COMMIT;

-- Beer returns (spec amendment 2026-10-22)
BEGIN;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS stock_export_log_id uuid
    REFERENCES public.inventory_logs(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_order_items_stock_export ON public.order_items(stock_export_log_id);
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_quantity_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_quantity_check CHECK(quantity >= 0);

CREATE OR REPLACE FUNCTION private.authorize_beer_return(p_actor text,p_session uuid)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_session public.table_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_session FROM public.table_sessions WHERE id=p_session FOR UPDATE;
    IF NOT FOUND OR v_session.session_type<>'DINE_IN' THEN
        RAISE EXCEPTION 'Session missing' USING ERRCODE='P0002';
    END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor AND is_active AND role IN ('staff','admin') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
    RETURN 'beer-return:'||p_session::text||':'||p_actor;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_return_beer(p_actor_id text,p_session_id uuid,p_operation_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_scope text; v_claim jsonb; v_item public.order_items%ROWTYPE; v_export public.inventory_logs%ROWTYPE;
    v_stock public.ingredients%ROWTYPE; v_category text; v_quantity int; v_expected int; v_item_id uuid;
    v_total numeric; v_result jsonb;
BEGIN
    IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>8192 THEN
        RAISE EXCEPTION 'Invalid return input' USING ERRCODE='22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_input) AS k)
        IS DISTINCT FROM ARRAY['confirmedUnused','expectedQuantity','orderItemId','quantity']::text[]
        OR p_input->'confirmedUnused'<>'true'::jsonb
        OR jsonb_typeof(p_input->'orderItemId')<>'string'
        OR (p_input->>'orderItemId') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        OR jsonb_typeof(p_input->'quantity')<>'number' OR jsonb_typeof(p_input->'expectedQuantity')<>'number' THEN
        RAISE EXCEPTION 'Invalid return fields' USING ERRCODE='22023';
    END IF;
    IF (p_input->>'quantity')::numeric NOT BETWEEN 1 AND 99
        OR (p_input->>'expectedQuantity')::numeric NOT BETWEEN 1 AND 99
        OR (p_input->>'quantity')::numeric<>trunc((p_input->>'quantity')::numeric)
        OR (p_input->>'expectedQuantity')::numeric<>trunc((p_input->>'expectedQuantity')::numeric)
        OR (p_input->>'quantity')::numeric>(p_input->>'expectedQuantity')::numeric THEN
        RAISE EXCEPTION 'Invalid return quantity' USING ERRCODE='22023';
    END IF;
    v_item_id := (p_input->>'orderItemId')::uuid;
    v_quantity := (p_input->>'quantity')::int;
    v_expected := (p_input->>'expectedQuantity')::int;
    v_scope := private.authorize_beer_return(p_actor_id,p_session_id);
    v_claim := private.begin_operation(v_scope,p_operation_id,'beer.return',jsonb_build_object(
        'orderItemId',v_item_id,'quantity',v_quantity,'expectedQuantity',v_expected,'confirmedUnused',true),p_session_id,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.table_sessions WHERE id=p_session_id AND status IN ('ACTIVE','REQUEST_BILL')) THEN
        RAISE EXCEPTION 'Session cannot accept returns' USING ERRCODE='P1001';
    END IF;
    SELECT * INTO v_item FROM public.order_items WHERE id=v_item_id AND session_id=p_session_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item missing' USING ERRCODE='P0002'; END IF;
    IF v_item.quantity<>v_expected THEN RAISE EXCEPTION 'Return item changed' USING ERRCODE='P1201'; END IF;
    SELECT category INTO v_category FROM public.menu_items WHERE id=v_item.menu_item_id FOR SHARE;
    IF v_item.station<>'BAR_INSTANT' OR v_category NOT IN ('BEER','DRINK')
        OR v_item.status NOT IN ('READY','SERVED') OR v_item.quantity<v_quantity THEN
        RAISE EXCEPTION 'Item cannot be returned' USING ERRCODE='P1202';
    END IF;
    SELECT * INTO v_export FROM public.inventory_logs WHERE id=v_item.stock_export_log_id FOR SHARE;
    IF NOT FOUND OR v_export.type<>'EXPORT_SALE' OR NOT(v_export.quantity_change<=-v_item.quantity AND v_export.quantity_change>'-Infinity'::numeric) THEN
        RAISE EXCEPTION 'Stock export provenance missing' USING ERRCODE='P1203';
    END IF;
    SELECT * INTO STRICT v_stock FROM public.ingredients WHERE id=v_export.ingredient_id FOR UPDATE;
    IF NOT(v_stock.stock_quantity>=0 AND v_stock.stock_quantity<'Infinity'::numeric)
        OR NOT(v_item.unit_cost_price>=0 AND v_item.unit_cost_price<=1000000000) THEN
        RAISE EXCEPTION 'Inventory snapshot invalid' USING ERRCODE='P1102';
    END IF;
    UPDATE public.order_items SET quantity=quantity-v_quantity WHERE id=v_item_id;
    UPDATE public.ingredients SET stock_quantity=stock_quantity+v_quantity WHERE id=v_stock.id;
    INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost,note,created_by)
    VALUES(v_stock.id,'RETURN_BEER',v_quantity,v_quantity*v_item.unit_cost_price,'Return item '||v_item_id::text,p_actor_id);
    SELECT coalesce(sum(quantity*unit_price),0) INTO v_total FROM public.order_items WHERE session_id=p_session_id AND status<>'CANCELLED';
    UPDATE public.table_sessions SET total_amount=v_total WHERE id=p_session_id;
    INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload)
    VALUES('return:'||v_scope||':'||p_operation_id::text,p_session_id,v_item_id,'SESSION_UPDATED',
        jsonb_build_object('sessionId',p_session_id,'orderItemId',v_item_id));
    v_result:=jsonb_build_object('sessionId',p_session_id,'operationId',p_operation_id,'orderItemId',v_item_id,
        'remainingQuantity',v_item.quantity-v_quantity,'totalAmount',v_total);
    RETURN private.complete_operation(v_scope,p_operation_id,v_result);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_beer_return_operation(p_actor_id text,p_session_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_scope text; v_result jsonb;
BEGIN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
    v_scope:=private.authorize_beer_return(p_actor_id,p_session_id);
    SELECT result INTO v_result FROM private.operation_requests WHERE scope_key=v_scope
        AND operation_id=p_operation_id AND action='beer.return';
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.authorize_beer_return(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_return_beer(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_get_beer_return_operation(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_return_beer(text,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_beer_return_operation(text,uuid,uuid) TO service_role;

-- Updated order function and zero-quantity KPI definitions follow in this migration.
CREATE OR REPLACE FUNCTION public.fn_submit_dine_in_order(
    p_session_id uuid, p_session_token text, p_actor_id text, p_operation_id uuid, p_lines jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_scope text; v_claim jsonb; v_line jsonb; v_menu public.menu_items%ROWTYPE;
    v_stock record; v_item public.order_items%ROWTYPE; v_total numeric; v_now timestamptz;
    v_export_logs jsonb := '{}'::jsonb; v_export_id uuid; v_lines jsonb := '[]'::jsonb; v_items jsonb := '[]'::jsonb; v_result jsonb;
BEGIN
    IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'Invalid order lines' USING ERRCODE='22023';
    END IF;
    IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 30 OR octet_length(p_lines::text)>32768 THEN
        RAISE EXCEPTION 'Invalid order lines' USING ERRCODE='22023';
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
        IF jsonb_typeof(v_line) <> 'object' THEN RAISE EXCEPTION 'Invalid line' USING ERRCODE='22023'; END IF;
        IF NOT (v_line ?& ARRAY['menu_item_id','quantity','note','expected_price'])
           OR v_line - ARRAY['menu_item_id','quantity','note','expected_price'] <> '{}'::jsonb
           OR jsonb_typeof(v_line->'menu_item_id') <> 'string'
           OR (v_line->>'menu_item_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
           OR jsonb_typeof(v_line->'quantity') <> 'number'
           OR jsonb_typeof(v_line->'expected_price') <> 'number'
           OR jsonb_typeof(v_line->'note') <> 'string' OR length(v_line->>'note')>500 THEN
            RAISE EXCEPTION 'Invalid line fields' USING ERRCODE='22023';
        END IF;
        IF (v_line->>'quantity')::numeric NOT BETWEEN 1 AND 99
           OR (v_line->>'quantity')::numeric <> trunc((v_line->>'quantity')::numeric)
           OR (v_line->>'expected_price')::numeric < 0 OR (v_line->>'expected_price')::numeric > 1000000000 THEN
            RAISE EXCEPTION 'Invalid line values' USING ERRCODE='22023';
        END IF;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'menu_item_id', (v_line->>'menu_item_id')::uuid, 'quantity',(v_line->>'quantity')::int,
          'note',btrim(v_line->>'note'),'expected_price',(v_line->>'expected_price')::numeric));
    END LOOP;

    v_scope := private.authorize_dine_in_session(p_session_id,p_session_token,p_actor_id);
    v_claim := private.begin_operation(v_scope,p_operation_id,'dine_in.order',jsonb_build_object('lines',v_lines),p_session_id,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.table_sessions WHERE id=p_session_id AND status='ACTIVE') THEN
        RAISE EXCEPTION 'Session is not active' USING ERRCODE='P1001';
    END IF;
    IF (SELECT count(*) FROM private.operation_requests AS op WHERE op.session_id=p_session_id
        AND op.action='dine_in.order' AND op.completed_at > clock_timestamp()-interval '10 seconds') >= 2 THEN
        RAISE EXCEPTION 'Order rate limit exceeded' USING ERRCODE='P1006';
    END IF;

    PERFORM m.id FROM public.menu_items AS m WHERE m.id IN
      (SELECT (value->>'menu_item_id')::uuid FROM jsonb_array_elements(v_lines)) ORDER BY m.id FOR SHARE;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
        SELECT m.* INTO v_menu FROM public.menu_items AS m WHERE m.id=(v_line->>'menu_item_id')::uuid;
        IF NOT FOUND OR NOT v_menu.is_available THEN RAISE EXCEPTION 'Menu unavailable' USING ERRCODE='P1002'; END IF;
        IF v_menu.price::text IN ('NaN','Infinity','-Infinity') OR v_menu.cost_price::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Menu cost needs verification' USING ERRCODE='P1005';
        END IF;
        IF v_menu.price <> (v_line->>'expected_price')::numeric THEN
            RAISE EXCEPTION 'Price changed' USING ERRCODE='P1003',
              DETAIL=jsonb_build_object('menuItemId',v_menu.id,'price',v_menu.price)::text;
        END IF;
        IF v_menu.linked_ingredient_id IS NOT NULL AND (v_menu.category='FOOD' OR v_menu.station<>'BAR_INSTANT') THEN
            RAISE EXCEPTION 'Inventory mapping needs verification' USING ERRCODE='P1005';
        END IF;
    END LOOP;
    FOR v_stock IN
      SELECT ing.id,ing.stock_quantity,ing.unit_cost,need.quantity FROM public.ingredients AS ing
      JOIN (SELECT m.linked_ingredient_id AS id,sum((line->>'quantity')::int) AS quantity
        FROM jsonb_array_elements(v_lines) AS line JOIN public.menu_items AS m ON m.id=(line->>'menu_item_id')::uuid
        WHERE m.linked_ingredient_id IS NOT NULL GROUP BY m.linked_ingredient_id) AS need ON need.id=ing.id
      ORDER BY ing.id FOR UPDATE OF ing
    LOOP
        IF v_stock.stock_quantity::text IN ('NaN','Infinity','-Infinity') OR v_stock.unit_cost::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Inventory values need verification' USING ERRCODE='P1005';
        END IF;
        IF v_stock.stock_quantity < v_stock.quantity OR v_stock.unit_cost < 0 THEN
            RAISE EXCEPTION 'Insufficient stock' USING ERRCODE='P1004';
        END IF;
        UPDATE public.ingredients SET stock_quantity=stock_quantity-v_stock.quantity WHERE id=v_stock.id;
        INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost,note,created_by)
        VALUES(v_stock.id,'EXPORT_SALE',-v_stock.quantity,v_stock.quantity*v_stock.unit_cost,
          'Order operation '||p_operation_id::text,p_actor_id) RETURNING id INTO v_export_id;
        v_export_logs:=v_export_logs||jsonb_build_object(v_stock.id::text,v_export_id);
    END LOOP;
    v_now := clock_timestamp();
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
        SELECT m.* INTO STRICT v_menu FROM public.menu_items AS m WHERE m.id=(v_line->>'menu_item_id')::uuid;
        INSERT INTO public.order_items(session_id,menu_item_id,quantity,note,station,status,unit_price,unit_cost_price,created_at,ready_at,stock_export_log_id)
        VALUES(p_session_id,v_menu.id,(v_line->>'quantity')::int,nullif(v_line->>'note',''),v_menu.station,
          CASE WHEN v_menu.station='BAR_INSTANT' THEN 'READY' ELSE 'QUEUED' END,v_menu.price,v_menu.cost_price,
          v_now,CASE WHEN v_menu.station='BAR_INSTANT' THEN v_now ELSE NULL END,
          (v_export_logs->>v_menu.linked_ingredient_id::text)::uuid) RETURNING * INTO v_item;
        v_items := v_items || jsonb_build_array(to_jsonb(v_item)-'stock_export_log_id'-'unit_cost_price'-'served_by_staff_id'-'cancelled_by');
        INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload)
        VALUES('new-item:'||v_item.id::text,p_session_id,v_item.id,
          CASE WHEN v_menu.station='BAR_INSTANT' THEN 'ORDER_READY' ELSE 'KITCHEN_ORDER_CREATED' END,
          jsonb_build_object('sessionId',p_session_id,'orderItemId',v_item.id));
    END LOOP;
    SELECT coalesce(sum(oi.quantity*oi.unit_price),0) INTO v_total FROM public.order_items AS oi
      WHERE oi.session_id=p_session_id AND oi.status<>'CANCELLED';
    UPDATE public.table_sessions SET total_amount=v_total WHERE id=p_session_id;
    v_result := jsonb_build_object('sessionId',p_session_id,'operationId',p_operation_id,'totalAmount',v_total,'items',v_items);
    RETURN private.complete_operation(v_scope,p_operation_id,v_result);
END;
$$;


CREATE OR REPLACE VIEW public.vw_kpi_peak_hours AS
SELECT
    EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer AS hour_of_day,
    COUNT(id)::bigint AS total_orders_count,
    COALESCE(SUM(quantity), 0)::bigint AS total_items_quantity,
    COALESCE(SUM(unit_price * quantity), 0)::numeric AS total_order_value
FROM public.order_items
WHERE quantity > 0 AND status <> 'CANCELLED'
GROUP BY EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))
ORDER BY hour_of_day ASC;
CREATE OR REPLACE VIEW public.vw_kpi_kitchen_performance AS
WITH kitchen_stats AS (
    SELECT
        COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED')::bigint AS total_cooked_items,
        COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED' AND oi.batch_id IS NOT NULL)::bigint AS batch_cooked_items,
        ROUND(
            COALESCE(
                AVG(EXTRACT(EPOCH FROM (oi.cooking_started_at - oi.created_at)) / 60.0)
                FILTER (WHERE oi.status = 'SERVED' AND oi.cooking_started_at IS NOT NULL),
                0
            )::numeric,
            2
        ) AS avg_queue_wait_minutes,
        ROUND(
            COALESCE(
                AVG(EXTRACT(EPOCH FROM (oi.ready_at - oi.cooking_started_at)) / 60.0)
                FILTER (WHERE oi.status = 'SERVED' AND oi.ready_at IS NOT NULL AND oi.cooking_started_at IS NOT NULL),
                0
            )::numeric,
            2
        ) AS avg_actual_cook_minutes,
        ROUND(
            COALESCE(
                AVG(m.prep_time_minutes) FILTER (WHERE oi.status = 'SERVED'),
                0
            )::numeric,
            2
        ) AS avg_standard_prep_minutes,
        COUNT(oi.id) FILTER (
            WHERE oi.status = 'CANCELLED'
            AND oi.cancelled_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (oi.cancelled_at - oi.created_at)) > 900
        )::bigint AS slow_cancelled_count
    FROM public.order_items oi
    INNER JOIN public.menu_items m ON m.id = oi.menu_item_id
    WHERE oi.quantity > 0 AND oi.station = 'KITCHEN'
)
SELECT
    ks.total_cooked_items,
    ks.batch_cooked_items,
    ks.avg_queue_wait_minutes,
    ks.avg_actual_cook_minutes,
    ks.avg_standard_prep_minutes,
    CASE
        WHEN ks.avg_standard_prep_minutes = 0 OR ks.avg_actual_cook_minutes <= ks.avg_standard_prep_minutes THEN 'ON_TIME'
        WHEN ks.avg_actual_cook_minutes <= (ks.avg_standard_prep_minutes * 1.3) THEN 'WARNING'
        ELSE 'LATE'
    END AS cook_time_evaluation,
    ROUND(
        CASE
            WHEN ks.total_cooked_items > 0 THEN (ks.batch_cooked_items::numeric / ks.total_cooked_items::numeric) * 100.0
            ELSE 0
        END,
        2
    ) AS batch_cooking_efficiency_pct,
    ks.slow_cancelled_count
FROM kitchen_stats ks;

CREATE OR REPLACE FUNCTION public.fn_get_kitchen_kpi(
    p_start_date timestamptz DEFAULT (date_trunc('month', now())),
    p_end_date timestamptz DEFAULT now()
)
RETURNS TABLE (
    total_cooked_items bigint,
    batch_cooked_items bigint,
    avg_queue_wait_minutes numeric,
    avg_actual_cook_minutes numeric,
    avg_standard_prep_minutes numeric,
    cook_time_evaluation text,
    batch_cooking_efficiency_pct numeric,
    slow_cancelled_count bigint
)
LANGUAGE sql
STABLE
AS $$
    WITH kitchen_stats AS (
        SELECT
            COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED')::bigint AS total_cooked_items,
            COUNT(oi.id) FILTER (WHERE oi.status = 'SERVED' AND oi.batch_id IS NOT NULL)::bigint AS batch_cooked_items,
            ROUND(
                COALESCE(
                    AVG(EXTRACT(EPOCH FROM (oi.cooking_started_at - oi.created_at)) / 60.0)
                    FILTER (WHERE oi.status = 'SERVED' AND oi.cooking_started_at IS NOT NULL),
                    0
                )::numeric,
                2
            ) AS avg_queue_wait_minutes,
            ROUND(
                COALESCE(
                    AVG(EXTRACT(EPOCH FROM (oi.ready_at - oi.cooking_started_at)) / 60.0)
                    FILTER (WHERE oi.status = 'SERVED' AND oi.ready_at IS NOT NULL AND oi.cooking_started_at IS NOT NULL),
                    0
                )::numeric,
                2
            ) AS avg_actual_cook_minutes,
            ROUND(
                COALESCE(
                    AVG(m.prep_time_minutes) FILTER (WHERE oi.status = 'SERVED'),
                    0
                )::numeric,
                2
            ) AS avg_standard_prep_minutes,
            COUNT(oi.id) FILTER (
                WHERE oi.status = 'CANCELLED'
                AND oi.cancelled_at IS NOT NULL
                AND EXTRACT(EPOCH FROM (oi.cancelled_at - oi.created_at)) > 900
            )::bigint AS slow_cancelled_count
        FROM public.order_items oi
        INNER JOIN public.menu_items m ON m.id = oi.menu_item_id
        WHERE oi.quantity > 0 AND oi.station = 'KITCHEN'
          AND oi.created_at >= p_start_date
          AND oi.created_at <= p_end_date
    )
    SELECT
        ks.total_cooked_items,
        ks.batch_cooked_items,
        ks.avg_queue_wait_minutes,
        ks.avg_actual_cook_minutes,
        ks.avg_standard_prep_minutes,
        CASE
            WHEN ks.avg_standard_prep_minutes = 0 OR ks.avg_actual_cook_minutes <= ks.avg_standard_prep_minutes THEN 'ON_TIME'
            WHEN ks.avg_actual_cook_minutes <= (ks.avg_standard_prep_minutes * 1.3) THEN 'WARNING'
            ELSE 'LATE'
        END AS cook_time_evaluation,
        ROUND(
            CASE
                WHEN ks.total_cooked_items > 0 THEN (ks.batch_cooked_items::numeric / ks.total_cooked_items::numeric) * 100.0
                ELSE 0
            END,
            2
        ) AS batch_cooking_efficiency_pct,
        ks.slow_cancelled_count
    FROM kitchen_stats ks;
$$;

-- ----------------------------------------------------------------------------
-- 11.4. VIEW & FUNCTION ĐÁNH GIÁ HIỆU SUẤT NHÂN VIÊN CHẠY BÀN (WAITSTAFF KPI)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_kpi_waitstaff_performance AS
WITH session_metrics AS (
    SELECT
        assigned_staff_id AS staff_id,
        COUNT(id)::bigint AS tables_opened_count,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED'), 0)::numeric AS managed_tables_revenue
    FROM public.table_sessions
    WHERE assigned_staff_id IS NOT NULL
    GROUP BY assigned_staff_id
),
serving_metrics AS (
    SELECT
        served_by_staff_id AS staff_id,
        COUNT(id) FILTER (WHERE status = 'SERVED')::bigint AS active_serving_count,
        ROUND(
            COALESCE(
                AVG(EXTRACT(EPOCH FROM (served_at - ready_at)))
                FILTER (WHERE status = 'SERVED' AND served_at IS NOT NULL AND ready_at IS NOT NULL),
                0
            )::numeric,
            2
        ) AS avg_pickup_speed_seconds
    FROM public.order_items
    WHERE quantity > 0 AND served_by_staff_id IS NOT NULL
    GROUP BY served_by_staff_id
)
SELECT
    sp.id AS staff_id,
    sp.full_name,
    sp.role,
    sp.assigned_zone_id,
    sp.is_active,
    COALESCE(sm.tables_opened_count, 0)::bigint AS tables_opened_count,
    COALESCE(sm.managed_tables_revenue, 0)::numeric AS managed_tables_revenue,
    COALESCE(svm.active_serving_count, 0)::bigint AS active_serving_count,
    COALESCE(svm.avg_pickup_speed_seconds, 0)::numeric AS avg_pickup_speed_seconds,
    CASE
        WHEN COALESCE(svm.active_serving_count, 0) = 0 THEN 'NO_DATA'
        WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) < 90 THEN 'EXCELLENT'
        WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) <= 180 THEN 'NORMAL'
        ELSE 'SLOW'
    END AS pickup_speed_evaluation
FROM public.staff_profiles sp
LEFT JOIN session_metrics sm ON sm.staff_id = sp.id
LEFT JOIN serving_metrics svm ON svm.staff_id = sp.id
WHERE sp.role IN ('staff', 'admin');

CREATE OR REPLACE FUNCTION public.fn_get_waitstaff_kpi(
    p_start_date timestamptz DEFAULT (date_trunc('month', now())),
    p_end_date timestamptz DEFAULT now()
)
RETURNS TABLE (
    staff_id text,
    full_name text,
    role text,
    assigned_zone_id uuid,
    is_active boolean,
    tables_opened_count bigint,
    managed_tables_revenue numeric,
    active_serving_count bigint,
    avg_pickup_speed_seconds numeric,
    pickup_speed_evaluation text
)
LANGUAGE sql
STABLE
AS $$
    WITH session_metrics AS (
        SELECT
            assigned_staff_id AS staff_id,
            COUNT(id)::bigint AS tables_opened_count,
            COALESCE(SUM(total_amount) FILTER (WHERE status = 'CLOSED'), 0)::numeric AS managed_tables_revenue
        FROM public.table_sessions
        WHERE assigned_staff_id IS NOT NULL
          AND opened_at >= p_start_date
          AND opened_at <= p_end_date
        GROUP BY assigned_staff_id
    ),
    serving_metrics AS (
        SELECT
            served_by_staff_id AS staff_id,
            COUNT(id) FILTER (WHERE status = 'SERVED')::bigint AS active_serving_count,
            ROUND(
                COALESCE(
                    AVG(EXTRACT(EPOCH FROM (served_at - ready_at)))
                    FILTER (WHERE status = 'SERVED' AND served_at IS NOT NULL AND ready_at IS NOT NULL),
                    0
                )::numeric,
                2
            ) AS avg_pickup_speed_seconds
        FROM public.order_items
        WHERE quantity > 0 AND served_by_staff_id IS NOT NULL
          AND created_at >= p_start_date
          AND created_at <= p_end_date
        GROUP BY served_by_staff_id
    )
    SELECT
        sp.id AS staff_id,
        sp.full_name,
        sp.role,
        sp.assigned_zone_id,
        sp.is_active,
        COALESCE(sm.tables_opened_count, 0)::bigint AS tables_opened_count,
        COALESCE(sm.managed_tables_revenue, 0)::numeric AS managed_tables_revenue,
        COALESCE(svm.active_serving_count, 0)::bigint AS active_serving_count,
        COALESCE(svm.avg_pickup_speed_seconds, 0)::numeric AS avg_pickup_speed_seconds,
        CASE
            WHEN COALESCE(svm.active_serving_count, 0) = 0 THEN 'NO_DATA'
            WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) < 90 THEN 'EXCELLENT'
            WHEN COALESCE(svm.avg_pickup_speed_seconds, 0) <= 180 THEN 'NORMAL'
            ELSE 'SLOW'
        END AS pickup_speed_evaluation
    FROM public.staff_profiles sp
    LEFT JOIN session_metrics sm ON sm.staff_id = sp.id
    LEFT JOIN serving_metrics svm ON svm.staff_id = sp.id
    WHERE sp.role IN ('staff', 'admin')
    ORDER BY active_serving_count DESC, managed_tables_revenue DESC;
$$;


NOTIFY pgrst,'reload schema';
COMMIT;

-- Session lifecycle (spec amendment 2026-10-22)
BEGIN;
CREATE OR REPLACE FUNCTION private.authorize_session_action(p_actor text,p_token text,p_session uuid)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_session public.table_sessions%ROWTYPE;
BEGIN
    IF p_actor IS NOT NULL THEN
        IF p_token IS NOT NULL THEN RAISE EXCEPTION 'Ambiguous identity' USING ERRCODE='42501'; END IF;
        PERFORM 1 FROM public.staff_profiles WHERE id=p_actor AND is_active AND role IN ('staff','admin') FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
        RETURN 'session-action:staff:'||p_actor;
    END IF;
    SELECT * INTO v_session FROM public.table_sessions WHERE id=p_session FOR UPDATE;
    IF NOT FOUND OR v_session.session_type<>'DINE_IN' OR v_session.status NOT IN ('ACTIVE','REQUEST_BILL')
        OR p_token IS NULL OR v_session.session_token IS DISTINCT FROM p_token THEN
        RAISE EXCEPTION 'Invalid session capability' USING ERRCODE='42501';
    END IF;
    RETURN 'session-action:customer:'||p_session::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_session_action(p_actor_id text,p_session_token text,p_operation_id uuid,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_scope text; v_claim jsonb; v_session public.table_sessions%ROWTYPE; v_table public.tables%ROWTYPE;
    v_session_id uuid; v_table_id uuid; v_target_id uuid; v_keys text[]; v_total numeric; v_result jsonb;
BEGIN
    IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>8192
       OR p_action IS NULL OR p_action NOT IN ('OPEN','TRANSFER','HANDOVER','REQUEST_BILL','CLOSE') THEN
        RAISE EXCEPTION 'Invalid session action' USING ERRCODE='22023';
    END IF;
    IF p_actor_id IS NULL AND p_action<>'REQUEST_BILL' THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
    v_keys:=CASE p_action
        WHEN 'OPEN' THEN ARRAY['tableId']
        WHEN 'TRANSFER' THEN ARRAY['expectedTableId','sessionId','targetTableId']
        WHEN 'HANDOVER' THEN ARRAY['assignedStaffId','expectedAssignedStaffId','sessionId']
        WHEN 'REQUEST_BILL' THEN ARRAY['paymentMethod','sessionId']
        WHEN 'CLOSE' THEN ARRAY['confirmedReceived','expectedTotal','paymentMethod','sessionId'] END;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_input) AS k) IS DISTINCT FROM v_keys THEN
        RAISE EXCEPTION 'Invalid session fields' USING ERRCODE='22023';
    END IF;
    IF p_action='OPEN' THEN
        IF jsonb_typeof(p_input->'tableId')<>'string' THEN RAISE EXCEPTION 'Table required' USING ERRCODE='22023'; END IF;
        v_table_id:=(p_input->>'tableId')::uuid;
    ELSE
        IF jsonb_typeof(p_input->'sessionId')<>'string' THEN RAISE EXCEPTION 'Session required' USING ERRCODE='22023'; END IF;
        v_session_id:=(p_input->>'sessionId')::uuid;
    END IF;
    IF p_action IN ('REQUEST_BILL','CLOSE') AND (jsonb_typeof(p_input->'paymentMethod')<>'string'
       OR p_input->>'paymentMethod' NOT IN ('CASH','VIETQR')) THEN
        RAISE EXCEPTION 'Invalid payment method' USING ERRCODE='22023';
    END IF;
    IF p_action='CLOSE' THEN
        IF p_input->'confirmedReceived'<>'true'::jsonb OR jsonb_typeof(p_input->'expectedTotal')<>'number' THEN
            RAISE EXCEPTION 'Payment confirmation required' USING ERRCODE='22023';
        END IF;
        IF (p_input->>'expectedTotal')::numeric<0 OR (p_input->>'expectedTotal')::numeric>1000000000000000 THEN
            RAISE EXCEPTION 'Invalid total' USING ERRCODE='22023';
        END IF;
    END IF;
    IF p_action='TRANSFER' THEN
        IF jsonb_typeof(p_input->'targetTableId')<>'string' OR jsonb_typeof(p_input->'expectedTableId')<>'string' THEN
            RAISE EXCEPTION 'Transfer tables required' USING ERRCODE='22023';
        END IF;
        v_target_id:=(p_input->>'targetTableId')::uuid;
        PERFORM (p_input->>'expectedTableId')::uuid;
    END IF;
    IF p_action='HANDOVER' AND (jsonb_typeof(p_input->'assignedStaffId')<>'string'
       OR jsonb_typeof(p_input->'expectedAssignedStaffId') NOT IN ('string','null')) THEN
        RAISE EXCEPTION 'Invalid assignment' USING ERRCODE='22023';
    END IF;
    v_scope:=private.authorize_session_action(p_actor_id,p_session_token,v_session_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    v_claim:=private.begin_operation(v_scope,p_operation_id,'session.action',jsonb_build_object('action',p_action,'input',p_input),v_session_id,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;

    IF p_action='OPEN' THEN
        SELECT * INTO v_table FROM public.tables WHERE id=v_table_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Table missing' USING ERRCODE='P0002'; END IF;
        IF v_table.status<>'AVAILABLE' OR v_table.current_session_id IS NOT NULL OR EXISTS(
            SELECT 1 FROM public.table_sessions WHERE table_id=v_table_id AND status<>'CLOSED') THEN
            RAISE EXCEPTION 'Table occupied' USING ERRCODE='P1301';
        END IF;
        INSERT INTO public.table_sessions(session_token,session_type,table_id,assigned_staff_id,status,payment_code,total_amount)
        VALUES(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'DINE_IN',v_table_id,p_actor_id,'ACTIVE',
            'DZO'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,18)),0) RETURNING * INTO v_session;
        UPDATE public.tables SET status='OCCUPIED',current_session_id=v_session.id WHERE id=v_table_id;
    ELSE
        SELECT * INTO v_session FROM public.table_sessions WHERE id=v_session_id FOR UPDATE;
        IF NOT FOUND OR v_session.session_type<>'DINE_IN' THEN RAISE EXCEPTION 'Session missing' USING ERRCODE='P0002'; END IF;
        IF v_session.status NOT IN ('ACTIVE','REQUEST_BILL') THEN RAISE EXCEPTION 'Session closed' USING ERRCODE='P1001'; END IF;
        IF p_action='TRANSFER' THEN
            IF v_session.table_id IS DISTINCT FROM (p_input->>'expectedTableId')::uuid OR v_session.table_id=v_target_id THEN
                RAISE EXCEPTION 'Source table changed' USING ERRCODE='P1302';
            END IF;
            PERFORM id FROM public.tables WHERE id IN (v_session.table_id,v_target_id) ORDER BY id FOR UPDATE;
            IF NOT EXISTS(SELECT 1 FROM public.tables WHERE id=v_session.table_id AND status='OCCUPIED' AND current_session_id=v_session.id) THEN
                RAISE EXCEPTION 'Source pointer inconsistent' USING ERRCODE='P1302';
            END IF;
            IF NOT EXISTS(SELECT 1 FROM public.tables WHERE id=v_target_id AND status='AVAILABLE' AND current_session_id IS NULL)
                OR EXISTS(SELECT 1 FROM public.table_sessions WHERE table_id=v_target_id AND status<>'CLOSED') THEN
                RAISE EXCEPTION 'Target table unavailable' USING ERRCODE='P1301';
            END IF;
            UPDATE public.tables SET status='AVAILABLE',current_session_id=NULL WHERE id=v_session.table_id;
            UPDATE public.tables SET status='OCCUPIED',current_session_id=v_session.id WHERE id=v_target_id;
            UPDATE public.table_sessions SET table_id=v_target_id WHERE id=v_session.id RETURNING * INTO v_session;
        ELSIF p_action='HANDOVER' THEN
            IF v_session.assigned_staff_id IS DISTINCT FROM p_input->>'expectedAssignedStaffId' THEN
                RAISE EXCEPTION 'Assignment changed' USING ERRCODE='P1302';
            END IF;
            PERFORM 1 FROM public.staff_profiles WHERE id=p_input->>'assignedStaffId' AND is_active AND role IN ('staff','admin') FOR SHARE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Assignee unavailable' USING ERRCODE='P1303'; END IF;
            UPDATE public.table_sessions SET assigned_staff_id=p_input->>'assignedStaffId' WHERE id=v_session.id RETURNING * INTO v_session;
        ELSE
            SELECT coalesce(sum(quantity*unit_price),0) INTO v_total FROM public.order_items WHERE session_id=v_session.id AND status<>'CANCELLED';
            IF NOT(v_total>=0 AND v_total<'Infinity'::numeric) THEN RAISE EXCEPTION 'Invalid bill values' USING ERRCODE='P1102'; END IF;
            IF p_action='REQUEST_BILL' THEN
                IF v_session.status<>'ACTIVE' THEN RAISE EXCEPTION 'Bill already requested' USING ERRCODE='P1304'; END IF;
                UPDATE public.table_sessions SET status='REQUEST_BILL',payment_method=p_input->>'paymentMethod',total_amount=v_total
                    WHERE id=v_session.id RETURNING * INTO v_session;
            ELSE
                IF EXISTS(SELECT 1 FROM public.order_items WHERE session_id=v_session.id AND quantity>0 AND status NOT IN ('SERVED','CANCELLED')) THEN
                    RAISE EXCEPTION 'Unresolved items' USING ERRCODE='P1305';
                END IF;
                IF v_total<>(p_input->>'expectedTotal')::numeric THEN
                    RAISE EXCEPTION 'Bill total changed' USING ERRCODE='P1306',DETAIL=jsonb_build_object('totalAmount',v_total)::text;
                END IF;
                SELECT * INTO v_table FROM public.tables WHERE id=v_session.table_id FOR UPDATE;
                IF NOT FOUND OR v_table.current_session_id IS DISTINCT FROM v_session.id OR v_table.status<>'OCCUPIED' THEN
                    RAISE EXCEPTION 'Table pointer inconsistent' USING ERRCODE='P1302';
                END IF;
                UPDATE public.table_sessions SET status='CLOSED',closed_at=clock_timestamp(),payment_method=p_input->>'paymentMethod',total_amount=v_total
                    WHERE id=v_session.id RETURNING * INTO v_session;
                UPDATE public.tables SET status='AVAILABLE',current_session_id=NULL WHERE id=v_table.id;
            END IF;
        END IF;
    END IF;
    INSERT INTO private.notification_outbox(dedupe_key,session_id,kind,payload)
    VALUES('session-action:'||v_scope||':'||p_operation_id::text,v_session.id,'SESSION_UPDATED',jsonb_build_object('sessionId',v_session.id));
    v_result:=jsonb_build_object('operationId',p_operation_id,'action',p_action,'sessionId',v_session.id,
        'tableId',v_session.table_id,'status',v_session.status,'totalAmount',v_session.total_amount);
    RETURN private.complete_operation(v_scope,p_operation_id,v_result);
EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid session identifier' USING ERRCODE='22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_session_action_operation(p_actor_id text,p_session_token text,p_session_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_scope text; v_result jsonb;
BEGIN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
    v_scope:=private.authorize_session_action(p_actor_id,p_session_token,p_session_id);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    SELECT result INTO v_result FROM private.operation_requests WHERE scope_key=v_scope AND operation_id=p_operation_id AND action='session.action';
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.authorize_session_action(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_session_action(text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_get_session_action_operation(text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_session_action(text,text,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_session_action_operation(text,text,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Full bill detail (spec amendment 2026-10-22)
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_get_session_bill(p_actor_id text,p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_session public.table_sessions%ROWTYPE; v_items jsonb; v_total numeric;
BEGIN
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
    SELECT * INTO v_session FROM public.table_sessions WHERE id=p_session_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session missing' USING ERRCODE='P0002'; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(oi)-'unit_cost_price'-'served_by_staff_id'-'cancelled_by'-'stock_export_log_id'
        ORDER BY oi.created_at,oi.id),'[]'::jsonb),
        coalesce(sum(oi.quantity*oi.unit_price) FILTER(WHERE oi.status<>'CANCELLED'),0)
    INTO v_items,v_total FROM public.order_items AS oi WHERE oi.session_id=p_session_id;
    IF NOT(v_total>=0 AND v_total<'Infinity'::numeric) THEN RAISE EXCEPTION 'Invalid bill' USING ERRCODE='P1102'; END IF;
    IF v_session.status='CLOSED' AND v_session.total_amount IS DISTINCT FROM v_total THEN
        RAISE EXCEPTION 'Closed bill needs reconciliation' USING ERRCODE='P1102';
    END IF;
    RETURN jsonb_build_object('sessionId',p_session_id,'status',v_session.status,'totalAmount',v_total,'closedAt',v_session.closed_at,'items',v_items);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_get_session_bill(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_session_bill(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Item state transitions (spec amendment 2026-10-22)
BEGIN;
CREATE OR REPLACE FUNCTION private.assert_item_action_access(p_actor text,p_action text,p_admin_cancel boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_role text;
BEGIN
    SELECT role INTO v_role FROM public.staff_profiles WHERE id=p_actor AND is_active FOR SHARE;
    IF NOT FOUND OR (p_action IN ('START','READY') AND v_role NOT IN ('kitchen','admin'))
       OR (p_action IN ('SERVE','CANCEL') AND v_role NOT IN ('staff','admin'))
       OR (p_admin_cancel AND v_role<>'admin') THEN
        RAISE EXCEPTION 'Item action forbidden' USING ERRCODE='42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_transition_order_items(p_actor_id text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_action text; v_reason text; v_line jsonb; v_lines jsonb:='[]'::jsonb; v_claim jsonb;
    v_scope text:='item-action:'||p_actor_id; v_item public.order_items%ROWTYPE;
    v_session_id uuid; v_count int; v_expected text; v_target text; v_now timestamptz;
    v_batch uuid; v_total numeric; v_result jsonb; v_items jsonb:='[]'::jsonb; v_menu uuid;
BEGIN
    IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>32768 THEN
        RAISE EXCEPTION 'Invalid item action' USING ERRCODE='22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_command) AS k) IS DISTINCT FROM ARRAY['action','items','reason']::text[]
       OR jsonb_typeof(p_command->'action')<>'string' OR p_command->>'action' NOT IN ('START','READY','SERVE','CANCEL')
       OR jsonb_typeof(p_command->'items')<>'array' OR jsonb_typeof(p_command->'reason')<>'string' THEN
        RAISE EXCEPTION 'Invalid action fields' USING ERRCODE='22023';
    END IF;
    v_action:=p_command->>'action'; v_reason:=btrim(p_command->>'reason'); v_count:=jsonb_array_length(p_command->'items');
    IF v_count NOT BETWEEN 1 AND 100 OR (v_action IN ('SERVE','CANCEL') AND v_count<>1)
       OR length(p_command->>'reason')>500 OR (v_action='CANCEL' AND v_reason='') OR (v_action<>'CANCEL' AND v_reason<>'') THEN
        RAISE EXCEPTION 'Invalid action size/reason' USING ERRCODE='22023';
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_command->'items') LOOP
        IF jsonb_typeof(v_line)<>'object' THEN RAISE EXCEPTION 'Invalid item' USING ERRCODE='22023'; END IF;
        IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_line) AS k) IS DISTINCT FROM ARRAY['expectedQuantity','expectedStatus','id','sessionId']::text[]
           OR jsonb_typeof(v_line->'id')<>'string' OR jsonb_typeof(v_line->'sessionId')<>'string'
           OR jsonb_typeof(v_line->'expectedStatus')<>'string' OR v_line->>'expectedStatus' NOT IN ('QUEUED','COOKING','READY','SERVED')
           OR jsonb_typeof(v_line->'expectedQuantity')<>'number' THEN RAISE EXCEPTION 'Invalid item fields' USING ERRCODE='22023'; END IF;
        IF (v_line->>'expectedQuantity')::numeric NOT BETWEEN 1 AND 99
           OR (v_line->>'expectedQuantity')::numeric<>trunc((v_line->>'expectedQuantity')::numeric) THEN
            RAISE EXCEPTION 'Invalid quantity' USING ERRCODE='22023';
        END IF;
        v_lines:=v_lines||jsonb_build_array(jsonb_build_object('id',(v_line->>'id')::uuid,'sessionId',(v_line->>'sessionId')::uuid,
            'expectedStatus',v_line->>'expectedStatus','expectedQuantity',(v_line->>'expectedQuantity')::int));
    END LOOP;
    IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(v_lines))<>v_count THEN
        RAISE EXCEPTION 'Duplicate item IDs' USING ERRCODE='22023';
    END IF;
    SELECT jsonb_agg(value ORDER BY value->>'id') INTO v_lines FROM jsonb_array_elements(v_lines);
    -- Reject missing/inactive identities before taking any business locks.
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin','kitchen');
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    PERFORM s.id FROM public.table_sessions AS s WHERE s.id IN
        (SELECT (value->>'sessionId')::uuid FROM jsonb_array_elements(v_lines)) ORDER BY s.id FOR UPDATE;
    PERFORM private.assert_item_action_access(p_actor_id,v_action,
        v_action='CANCEL' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_lines) WHERE value->>'expectedStatus'<>'QUEUED'));
    v_claim:=private.begin_operation(v_scope,p_operation_id,'item.transition',jsonb_build_object('action',v_action,'items',v_lines,'reason',v_reason),NULL,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_lines) AS line LEFT JOIN public.table_sessions AS s ON s.id=(line->>'sessionId')::uuid
        WHERE s.id IS NULL OR s.status NOT IN ('ACTIVE','REQUEST_BILL')) THEN
        RAISE EXCEPTION 'Session cannot process items' USING ERRCODE='P1001';
    END IF;
    PERFORM oi.id FROM public.order_items AS oi WHERE oi.id IN
        (SELECT (value->>'id')::uuid FROM jsonb_array_elements(v_lines)) ORDER BY oi.id FOR UPDATE;
    v_now:=clock_timestamp();
    v_target:=CASE v_action WHEN 'START' THEN 'COOKING' WHEN 'READY' THEN 'READY' WHEN 'SERVE' THEN 'SERVED' ELSE 'CANCELLED' END;
    IF v_action='START' AND v_count>1 THEN v_batch:=gen_random_uuid(); END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
        SELECT * INTO v_item FROM public.order_items WHERE id=(v_line->>'id')::uuid;
        IF NOT FOUND OR v_item.session_id<>(v_line->>'sessionId')::uuid OR v_item.quantity<>(v_line->>'expectedQuantity')::int
           OR v_item.status<>v_line->>'expectedStatus' THEN RAISE EXCEPTION 'Item changed' USING ERRCODE='P1401'; END IF;
        v_expected:=v_item.status;
        IF v_action='START' THEN
            IF v_item.station<>'KITCHEN' OR v_expected<>'QUEUED' OR v_item.cooking_started_at IS NOT NULL
               OR v_item.ready_at IS NOT NULL OR v_item.served_at IS NOT NULL THEN
                RAISE EXCEPTION 'Invalid start transition' USING ERRCODE='P1402';
            END IF;
            IF v_menu IS NOT NULL AND v_menu<>v_item.menu_item_id THEN RAISE EXCEPTION 'Mixed menu batch' USING ERRCODE='P1402'; END IF;
            v_menu:=v_item.menu_item_id;
        ELSIF v_action='READY' THEN
            IF v_item.station<>'KITCHEN' OR v_expected<>'COOKING' OR v_item.cooking_started_at IS NULL
               OR v_item.ready_at IS NOT NULL OR v_item.served_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid ready transition' USING ERRCODE='P1402'; END IF;
        ELSIF v_action='SERVE' THEN
            IF v_expected<>'READY' OR v_item.ready_at IS NULL OR v_item.served_at IS NOT NULL THEN
                RAISE EXCEPTION 'Invalid serve transition' USING ERRCODE='P1402';
            END IF;
        ELSIF v_expected='CANCELLED' THEN RAISE EXCEPTION 'Already cancelled' USING ERRCODE='P1401';
        END IF;
        IF NOT isfinite(v_item.created_at) OR NOT isfinite(v_item.cooking_started_at) OR NOT isfinite(v_item.ready_at) OR NOT isfinite(v_item.served_at)
           OR v_item.created_at>v_now OR v_item.cooking_started_at>v_now OR v_item.ready_at>v_now OR v_item.served_at>v_now
           OR v_item.cooking_started_at<v_item.created_at OR v_item.ready_at<coalesce(v_item.cooking_started_at,v_item.created_at)
           OR v_item.served_at<v_item.ready_at THEN RAISE EXCEPTION 'Invalid item timestamps' USING ERRCODE='P1403'; END IF;
        UPDATE public.order_items SET status=v_target,
            cooking_started_at=CASE WHEN v_action='START' THEN v_now ELSE cooking_started_at END,
            batch_id=CASE WHEN v_action='START' THEN v_batch ELSE batch_id END,
            ready_at=CASE WHEN v_action='READY' THEN v_now ELSE ready_at END,
            served_at=CASE WHEN v_action='SERVE' THEN v_now ELSE served_at END,
            served_by_staff_id=CASE WHEN v_action='SERVE' THEN p_actor_id ELSE served_by_staff_id END,
            cancelled_at=CASE WHEN v_action='CANCEL' THEN v_now ELSE cancelled_at END,
            cancelled_by=CASE WHEN v_action='CANCEL' THEN p_actor_id ELSE cancelled_by END,
            cancel_reason=CASE WHEN v_action='CANCEL' THEN v_reason ELSE cancel_reason END WHERE id=v_item.id;
        v_items:=v_items||jsonb_build_array(jsonb_build_object('id',v_item.id,'sessionId',v_item.session_id,'fromStatus',v_expected,'status',v_target));
        IF v_action='READY' THEN
            INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload)
            VALUES('ready:'||v_item.id::text,v_item.session_id,v_item.id,'ORDER_READY',jsonb_build_object('sessionId',v_item.session_id,'orderItemId',v_item.id));
        END IF;
    END LOOP;
    FOR v_session_id IN SELECT DISTINCT (value->>'sessionId')::uuid FROM jsonb_array_elements(v_lines) LOOP
        IF v_action='CANCEL' THEN
            SELECT coalesce(sum(quantity*unit_price),0) INTO v_total FROM public.order_items WHERE session_id=v_session_id AND status<>'CANCELLED';
            IF NOT(v_total>=0 AND v_total<'Infinity'::numeric) THEN RAISE EXCEPTION 'Invalid bill' USING ERRCODE='P1102'; END IF;
            UPDATE public.table_sessions SET total_amount=v_total WHERE id=v_session_id;
        END IF;
        IF v_action<>'READY' THEN
            INSERT INTO private.notification_outbox(dedupe_key,session_id,kind,payload)
            VALUES('transition:'||v_scope||':'||p_operation_id::text||':'||v_session_id::text,v_session_id,'SESSION_UPDATED',jsonb_build_object('sessionId',v_session_id));
        END IF;
    END LOOP;
    v_result:=jsonb_build_object('operationId',p_operation_id,'action',v_action,'batchId',v_batch,'items',v_items);
    RETURN private.complete_operation(v_scope,p_operation_id,v_result);
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid item identifier' USING ERRCODE='22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_item_action_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_result jsonb; v_scope text:='item-action:'||p_actor_id;
BEGIN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin','kitchen') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    SELECT result INTO v_result FROM private.operation_requests WHERE scope_key=v_scope AND operation_id=p_operation_id AND action='item.transition';
    IF v_result IS NOT NULL THEN
        PERFORM private.assert_item_action_access(p_actor_id,v_result->>'action',v_result->>'action'='CANCEL' AND
            EXISTS(SELECT 1 FROM jsonb_array_elements(v_result->'items') WHERE value->>'fromStatus'<>'QUEUED'));
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_item_action_access(text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_transition_order_items(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_get_item_action_operation(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_transition_order_items(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_item_action_operation(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Menu actions (spec amendment 2026-10-22)
BEGIN;
CREATE OR REPLACE FUNCTION private.assert_menu_fields(p_item jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_field text; v_price numeric;
BEGIN
    IF p_item IS NULL OR jsonb_typeof(p_item)<>'object' THEN RAISE EXCEPTION 'Invalid menu fields' USING ERRCODE='22023'; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_item) AS k) IS DISTINCT FROM
       ARRAY['category','cost_price','image_url','is_available','linked_ingredient_id','name','prep_time_minutes','price','station']::text[]
       OR jsonb_typeof(p_item->'name')<>'string' OR length(p_item->>'name')>120 OR btrim(p_item->>'name')=''
       OR jsonb_typeof(p_item->'category')<>'string' OR p_item->>'category' NOT IN ('FOOD','BEER','DRINK','OTHER')
       OR jsonb_typeof(p_item->'station')<>'string' OR p_item->>'station' NOT IN ('KITCHEN','BAR_INSTANT')
       OR jsonb_typeof(p_item->'is_available')<>'boolean'
       OR jsonb_typeof(p_item->'prep_time_minutes')<>'number'
       OR jsonb_typeof(p_item->'image_url') NOT IN ('string','null')
       OR jsonb_typeof(p_item->'linked_ingredient_id') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'Invalid menu fields' USING ERRCODE='22023';
    END IF;
    FOREACH v_field IN ARRAY ARRAY['price','cost_price'] LOOP
        IF jsonb_typeof(p_item->v_field)<>'number' THEN RAISE EXCEPTION 'Invalid money' USING ERRCODE='22023'; END IF;
        v_price:=(p_item->>v_field)::numeric;
        IF NOT(v_price>=0 AND v_price<=1e12 AND v_price=round(v_price,2)) THEN RAISE EXCEPTION 'Invalid money' USING ERRCODE='22023'; END IF;
    END LOOP;
    v_price:=(p_item->>'prep_time_minutes')::numeric;
    IF v_price NOT BETWEEN 0 AND 1440 OR v_price<>trunc(v_price)
       OR (p_item->>'image_url' IS NOT NULL AND (length(p_item->>'image_url')>2048 OR p_item->>'image_url' !~* '^https://[^[:space:]]+$')) THEN
        RAISE EXCEPTION 'Invalid menu fields' USING ERRCODE='22023';
    END IF;
    IF p_item->>'linked_ingredient_id' IS NOT NULL THEN
        IF p_item->>'linked_ingredient_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
           OR p_item->>'category'='FOOD' OR p_item->>'station'<>'BAR_INSTANT' THEN
            RAISE EXCEPTION 'Invalid stock mapping' USING ERRCODE='22023';
        END IF;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_menu_action(p_actor_id text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_action text; v_id uuid; v_role text; v_item jsonb; v_expected jsonb; v_before jsonb;
    v_scope text:='menu-action:'||p_actor_id; v_claim jsonb; v_row public.menu_items%ROWTYPE;
BEGIN
    IF p_operation_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>16384 THEN
        RAISE EXCEPTION 'Invalid menu command' USING ERRCODE='22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_command) AS k) IS DISTINCT FROM ARRAY['action','expected','id','item']::text[]
       OR jsonb_typeof(p_command->'action')<>'string' OR p_command->>'action' NOT IN ('CREATE','UPDATE','DELETE','AVAILABILITY')
       OR jsonb_typeof(p_command->'id')<>'string' OR p_command->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
        RAISE EXCEPTION 'Invalid menu command' USING ERRCODE='22023';
    END IF;
    v_action:=p_command->>'action'; v_id:=(p_command->>'id')::uuid; v_item:=p_command->'item'; v_expected:=p_command->'expected';
    IF v_action='AVAILABILITY' THEN
        IF jsonb_typeof(v_item)<>'object' OR jsonb_typeof(v_expected)<>'object' THEN RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023'; END IF;
        IF v_item - 'is_available'<>'{}'::jsonb OR jsonb_typeof(v_item->'is_available') IS DISTINCT FROM 'boolean'
           OR v_expected - 'is_available'<>'{}'::jsonb OR jsonb_typeof(v_expected->'is_available') IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023';
        END IF;
    ELSE
        IF v_action='CREATE' THEN
            IF v_expected<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid create' USING ERRCODE='22023'; END IF;
        ELSE PERFORM private.assert_menu_fields(v_expected); END IF;
        IF v_action='DELETE' THEN
            IF v_item<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid delete' USING ERRCODE='22023'; END IF;
        ELSE PERFORM private.assert_menu_fields(v_item); END IF;
    END IF;
    SELECT role INTO v_role FROM public.staff_profiles WHERE id=p_actor_id AND is_active FOR SHARE;
    IF NOT FOUND OR v_role NOT IN ('admin','kitchen') OR (v_action<>'AVAILABILITY' AND v_role<>'admin') THEN
        RAISE EXCEPTION 'Menu action forbidden' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    v_claim:=private.begin_operation(v_scope,p_operation_id,'menu.action',p_command||jsonb_build_object('id',v_id),NULL,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    SELECT * INTO v_row FROM public.menu_items WHERE id=v_id FOR UPDATE;
    IF v_action='CREATE' THEN
        IF FOUND THEN RAISE EXCEPTION 'Menu ID exists' USING ERRCODE='23505'; END IF;
        INSERT INTO public.menu_items(id,name,category,station,price,cost_price,prep_time_minutes,image_url,is_available,linked_ingredient_id)
        VALUES(v_id,v_item->>'name',v_item->>'category',v_item->>'station',(v_item->>'price')::numeric,(v_item->>'cost_price')::numeric,
            (v_item->>'prep_time_minutes')::numeric::int,v_item->>'image_url',(v_item->>'is_available')::boolean,(v_item->>'linked_ingredient_id')::uuid);
    ELSE
        IF NOT FOUND THEN RAISE EXCEPTION 'Menu missing' USING ERRCODE='P1501'; END IF;
        v_before:=to_jsonb(v_row)-'id';
        IF (CASE WHEN v_action='AVAILABILITY' THEN jsonb_build_object('is_available',v_row.is_available) ELSE v_before END) IS DISTINCT FROM v_expected THEN
            RAISE EXCEPTION 'Menu changed' USING ERRCODE='P1502';
        END IF;
        IF v_action='AVAILABILITY' THEN
            UPDATE public.menu_items SET is_available=(v_item->>'is_available')::boolean WHERE id=v_id;
        ELSE
            IF EXISTS(SELECT 1 FROM public.order_items WHERE menu_item_id=v_id) AND
               (v_action='DELETE' OR v_before->'category' IS DISTINCT FROM v_item->'category'
                OR v_before->'station' IS DISTINCT FROM v_item->'station' OR v_before->'linked_ingredient_id' IS DISTINCT FROM v_item->'linked_ingredient_id') THEN
                RAISE EXCEPTION 'Menu history must be preserved' USING ERRCODE='P1503';
            END IF;
            IF v_action='DELETE' THEN DELETE FROM public.menu_items WHERE id=v_id;
            ELSE
                UPDATE public.menu_items SET name=v_item->>'name',category=v_item->>'category',station=v_item->>'station',
                    price=(v_item->>'price')::numeric,cost_price=(v_item->>'cost_price')::numeric,
                    prep_time_minutes=(v_item->>'prep_time_minutes')::numeric::int,image_url=v_item->>'image_url',
                    is_available=(v_item->>'is_available')::boolean,linked_ingredient_id=(v_item->>'linked_ingredient_id')::uuid WHERE id=v_id;
            END IF;
        END IF;
    END IF;
    RETURN private.complete_operation(v_scope,p_operation_id,jsonb_build_object('operationId',p_operation_id,'action',v_action,'menuItemId',v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_menu_action_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_result jsonb; v_role text; v_scope text:='menu-action:'||p_actor_id;
BEGIN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
    SELECT role INTO v_role FROM public.staff_profiles WHERE id=p_actor_id AND is_active FOR SHARE;
    IF NOT FOUND OR v_role NOT IN ('admin','kitchen') THEN RAISE EXCEPTION 'Menu access required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    SELECT result INTO v_result FROM private.operation_requests WHERE scope_key=v_scope AND operation_id=p_operation_id AND action='menu.action';
    IF v_result IS NOT NULL AND v_result->>'action'<>'AVAILABILITY' AND v_role<>'admin' THEN
        RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_menu_fields(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_menu_action(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_get_menu_action_operation(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_menu_action(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_menu_action_operation(text,uuid) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.menu_items FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,name,category,station,price,cost_price,prep_time_minutes,image_url,is_available,linked_ingredient_id),
    UPDATE(id,name,category,station,price,cost_price,prep_time_minutes,image_url,is_available,linked_ingredient_id) ON public.menu_items FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='menu_items') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
    END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Admin metadata (spec amendment 2026-10-22)
BEGIN;
-- Preserve references instead of cascading away tables or clearing bill/staff routing.
ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_zone_id_fkey;
ALTER TABLE public.tables ADD CONSTRAINT tables_zone_id_fkey FOREIGN KEY(zone_id) REFERENCES public.zones(id) ON DELETE RESTRICT;
ALTER TABLE public.staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_assigned_zone_id_fkey;
ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_assigned_zone_id_fkey FOREIGN KEY(assigned_zone_id) REFERENCES public.zones(id) ON DELETE RESTRICT;
ALTER TABLE public.table_sessions DROP CONSTRAINT IF EXISTS table_sessions_table_id_fkey;
ALTER TABLE public.table_sessions ADD CONSTRAINT table_sessions_table_id_fkey FOREIGN KEY(table_id) REFERENCES public.tables(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.assert_metadata_fields(p_resource text,p_item jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_keys text[]; v_number numeric;
BEGIN
    IF p_item IS NULL OR jsonb_typeof(p_item)<>'object' THEN RAISE EXCEPTION 'Invalid metadata' USING ERRCODE='22023'; END IF;
    v_keys:=CASE p_resource WHEN 'INGREDIENT' THEN ARRAY['min_threshold','name','unit'] WHEN 'ZONE' THEN ARRAY['name'] WHEN 'TABLE' THEN ARRAY['table_number','zone_id'] END;
    IF v_keys IS NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_item) AS k) IS DISTINCT FROM v_keys THEN
        RAISE EXCEPTION 'Invalid metadata fields' USING ERRCODE='22023';
    END IF;
    IF p_resource='TABLE' THEN
        IF jsonb_typeof(p_item->'table_number')<>'string' OR length(p_item->>'table_number') NOT BETWEEN 1 AND 120 OR btrim(p_item->>'table_number')=''
           OR jsonb_typeof(p_item->'zone_id')<>'string' OR p_item->>'zone_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
            RAISE EXCEPTION 'Invalid table' USING ERRCODE='22023';
        END IF;
    ELSE
        IF jsonb_typeof(p_item->'name')<>'string' OR length(p_item->>'name') NOT BETWEEN 1 AND 120 OR btrim(p_item->>'name')='' THEN
            RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023';
        END IF;
        IF p_resource='INGREDIENT' THEN
            IF jsonb_typeof(p_item->'unit')<>'string' OR length(p_item->>'unit') NOT BETWEEN 1 AND 30 OR btrim(p_item->>'unit')=''
               OR jsonb_typeof(p_item->'min_threshold')<>'number' THEN RAISE EXCEPTION 'Invalid ingredient' USING ERRCODE='22023'; END IF;
            v_number:=(p_item->>'min_threshold')::numeric;
            IF NOT(v_number>=0 AND v_number<=1e12 AND v_number=round(v_number,3)) THEN RAISE EXCEPTION 'Invalid threshold' USING ERRCODE='22023'; END IF;
        END IF;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_metadata_action(p_actor_id text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_resource text; v_action text; v_id uuid; v_item jsonb; v_expected jsonb; v_before jsonb;
    v_scope text:='metadata:'||p_actor_id; v_claim jsonb; v_exists boolean;
    v_ingredient public.ingredients%ROWTYPE; v_zone public.zones%ROWTYPE; v_table public.tables%ROWTYPE;
BEGIN
    IF p_operation_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>8192 THEN
        RAISE EXCEPTION 'Invalid metadata command' USING ERRCODE='22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_command) AS k) IS DISTINCT FROM ARRAY['action','expected','id','item','resource']::text[]
       OR jsonb_typeof(p_command->'resource')<>'string' OR p_command->>'resource' NOT IN ('INGREDIENT','ZONE','TABLE')
       OR jsonb_typeof(p_command->'action')<>'string' OR p_command->>'action' NOT IN ('CREATE','UPDATE','DELETE')
       OR jsonb_typeof(p_command->'id')<>'string' OR p_command->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
        RAISE EXCEPTION 'Invalid metadata command fields' USING ERRCODE='22023';
    END IF;
    v_resource:=p_command->>'resource'; v_action:=p_command->>'action'; v_id:=(p_command->>'id')::uuid;
    v_item:=p_command->'item'; v_expected:=p_command->'expected';
    IF v_resource='INGREDIENT' AND v_action='DELETE' THEN RAISE EXCEPTION 'Ingredient deletion unsupported' USING ERRCODE='22023'; END IF;
    IF v_action='CREATE' THEN
        IF v_expected IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Invalid create expectation' USING ERRCODE='22023'; END IF;
    ELSE PERFORM private.assert_metadata_fields(v_resource,v_expected); END IF;
    IF v_action='DELETE' THEN
        IF v_item IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Invalid delete fields' USING ERRCODE='22023'; END IF;
    ELSE PERFORM private.assert_metadata_fields(v_resource,v_item); END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    v_claim:=private.begin_operation(v_scope,p_operation_id,'metadata.action',p_command,NULL,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    IF v_resource='INGREDIENT' THEN
        SELECT * INTO v_ingredient FROM public.ingredients WHERE id=v_id FOR UPDATE; v_exists:=FOUND;
        v_before:=jsonb_build_object('name',v_ingredient.name,'unit',v_ingredient.unit,'min_threshold',v_ingredient.min_threshold);
    ELSIF v_resource='ZONE' THEN
        SELECT * INTO v_zone FROM public.zones WHERE id=v_id FOR UPDATE; v_exists:=FOUND;
        v_before:=jsonb_build_object('name',v_zone.name);
    ELSE
        SELECT * INTO v_table FROM public.tables WHERE id=v_id FOR UPDATE; v_exists:=FOUND;
        v_before:=jsonb_build_object('table_number',v_table.table_number,'zone_id',v_table.zone_id);
    END IF;
    IF v_action='CREATE' THEN
        IF v_exists THEN RAISE EXCEPTION 'Entity already exists' USING ERRCODE='23505'; END IF;
    ELSE
        IF NOT v_exists THEN RAISE EXCEPTION 'Entity missing' USING ERRCODE='P1601'; END IF;
        IF v_before IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Metadata changed' USING ERRCODE='P1602'; END IF;
    END IF;
    IF v_resource='INGREDIENT' THEN
        IF v_action='CREATE' THEN
            INSERT INTO public.ingredients(id,name,unit,min_threshold,stock_quantity,unit_cost)
            VALUES(v_id,v_item->>'name',v_item->>'unit',(v_item->>'min_threshold')::numeric,0,0);
        ELSE
            IF v_ingredient.unit IS DISTINCT FROM v_item->>'unit' AND (v_ingredient.stock_quantity<>0 OR
               EXISTS(SELECT 1 FROM public.inventory_logs WHERE ingredient_id=v_id) OR EXISTS(SELECT 1 FROM public.menu_items WHERE linked_ingredient_id=v_id)) THEN
                RAISE EXCEPTION 'Unit has stock/history/mapping' USING ERRCODE='P1603';
            END IF;
            UPDATE public.ingredients SET name=v_item->>'name',unit=v_item->>'unit',min_threshold=(v_item->>'min_threshold')::numeric WHERE id=v_id;
        END IF;
    ELSIF v_resource='ZONE' THEN
        IF v_action='CREATE' THEN INSERT INTO public.zones(id,name) VALUES(v_id,v_item->>'name');
        ELSIF v_action='UPDATE' THEN UPDATE public.zones SET name=v_item->>'name' WHERE id=v_id;
        ELSE DELETE FROM public.zones WHERE id=v_id; END IF;
    ELSE
        IF v_action<>'CREATE' AND (v_table.status<>'AVAILABLE' OR v_table.current_session_id IS NOT NULL OR
           EXISTS(SELECT 1 FROM public.table_sessions WHERE table_id=v_id AND status<>'CLOSED')) THEN
            RAISE EXCEPTION 'Table is in use' USING ERRCODE='P1604';
        END IF;
        IF v_action='CREATE' THEN
            INSERT INTO public.tables(id,table_number,zone_id,status,current_session_id) VALUES(v_id,v_item->>'table_number',(v_item->>'zone_id')::uuid,'AVAILABLE',NULL);
        ELSIF v_action='UPDATE' THEN
            UPDATE public.tables SET table_number=v_item->>'table_number',zone_id=(v_item->>'zone_id')::uuid WHERE id=v_id;
        ELSE DELETE FROM public.tables WHERE id=v_id; END IF;
    END IF;
    RETURN private.complete_operation(v_scope,p_operation_id,jsonb_build_object('operationId',p_operation_id,'resource',v_resource,'action',v_action,'entityId',v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_admin_metadata_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_scope text:='metadata:'||p_actor_id; v_result jsonb;
BEGIN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    SELECT result INTO v_result FROM private.operation_requests WHERE scope_key=v_scope AND operation_id=p_operation_id AND action='metadata.action';
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_metadata_fields(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_admin_metadata_action(text,uuid,jsonb),public.fn_get_admin_metadata_operation(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_metadata_action(text,uuid,jsonb),public.fn_get_admin_metadata_operation(text,uuid) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.ingredients,public.zones,public.tables FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,name,unit,stock_quantity,min_threshold,unit_cost),UPDATE(id,name,unit,stock_quantity,min_threshold,unit_cost) ON public.ingredients FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,name,created_at),UPDATE(id,name,created_at) ON public.zones FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,table_number,zone_id,status,current_session_id),UPDATE(id,table_number,zone_id,status,current_session_id) ON public.tables FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Menu image authorization (spec amendment 2026-10-22)
BEGIN;
CREATE TABLE IF NOT EXISTS private.menu_image_uploads(
    id uuid PRIMARY KEY,
    actor_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
    content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
    object_path text NOT NULL UNIQUE,
    public_url text NOT NULL UNIQUE,
    state text NOT NULL CHECK(state IN ('UPLOADING','READY','DELETING','DELETED')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.menu_image_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.menu_image_uploads FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS menu_image_cleanup_idx ON private.menu_image_uploads(state,created_at);

CREATE OR REPLACE FUNCTION public.fn_menu_image_upload(p_actor_id text,p_id uuid,p_hash text,p_url text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_image private.menu_image_uploads%ROWTYPE; v_path text:='managed/'||p_id::text||'.webp';
BEGIN
    IF p_id IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_url IS NULL OR length(p_url)>2048
       OR p_url !~ '^https://[^[:space:]]+/storage/v1/object/public/menu-images/managed/[a-f0-9-]{36}\.webp$'
       OR right(p_url,length(v_path))<>v_path OR p_action IS NULL OR p_action NOT IN ('RESERVE','READY') THEN
        RAISE EXCEPTION 'Invalid image reservation' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
    -- Serialize reservations per actor to make the hourly quota exact.
    PERFORM pg_advisory_xact_lock(hashtextextended('menu-images:'||p_actor_id,0));
    SELECT * INTO v_image FROM private.menu_image_uploads WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN
        IF p_action<>'RESERVE' THEN RAISE EXCEPTION 'Image reservation missing' USING ERRCODE='P1701'; END IF;
        IF (SELECT count(*) FROM private.menu_image_uploads WHERE actor_id=p_actor_id AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN
            RAISE EXCEPTION 'Image upload limit' USING ERRCODE='P1704';
        END IF;
        INSERT INTO private.menu_image_uploads(id,actor_id,content_hash,object_path,public_url,state)
        VALUES(p_id,p_actor_id,p_hash,v_path,p_url,'UPLOADING') RETURNING * INTO v_image;
    ELSE
        IF v_image.actor_id<>p_actor_id OR v_image.content_hash<>p_hash OR v_image.public_url<>p_url THEN
            RAISE EXCEPTION 'Upload identity conflict' USING ERRCODE='22000';
        END IF;
        IF v_image.state IN ('DELETING','DELETED') THEN RAISE EXCEPTION 'Image retired' USING ERRCODE='P1702'; END IF;
        IF p_action='READY' THEN
            UPDATE private.menu_image_uploads SET state='READY',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_image;
        END IF;
    END IF;
    RETURN jsonb_build_object('id',v_image.id,'path',v_image.object_path,'url',v_image.public_url,'state',v_image.state);
END;
$$;

CREATE OR REPLACE FUNCTION private.check_menu_image_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
    IF NEW.image_url IS NULL THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN RETURN NEW; END IF;
    PERFORM 1 FROM private.menu_image_uploads WHERE public_url=NEW.image_url AND state='READY' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Image is not ready or managed' USING ERRCODE='P1703'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS check_menu_image_reference ON public.menu_items;
CREATE TRIGGER check_menu_image_reference BEFORE INSERT OR UPDATE OF image_url ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION private.check_menu_image_reference();

CREATE OR REPLACE FUNCTION public.fn_claim_menu_image_cleanup(p_actor_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_image private.menu_image_uploads%ROWTYPE; v_result jsonb:='[]'::jsonb;
BEGIN
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
    FOR v_image IN SELECT * FROM private.menu_image_uploads
      WHERE (state='DELETING' OR (state IN ('UPLOADING','READY') AND created_at<clock_timestamp()-interval '24 hours'))
        AND NOT EXISTS(SELECT 1 FROM public.menu_items WHERE image_url=menu_image_uploads.public_url)
      ORDER BY updated_at,id LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
        IF EXISTS(SELECT 1 FROM public.menu_items WHERE image_url=v_image.public_url) THEN CONTINUE; END IF;
        UPDATE private.menu_image_uploads SET state='DELETING',updated_at=clock_timestamp() WHERE id=v_image.id;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_image.id,'path',v_image.object_path));
    END LOOP;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_finish_menu_image_cleanup(p_actor_id text,p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
    UPDATE private.menu_image_uploads SET state='DELETED',updated_at=clock_timestamp() WHERE id=p_id AND state='DELETING';
END;
$$;
REVOKE ALL ON FUNCTION private.check_menu_image_reference() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_menu_image_upload(text,uuid,text,text,text),public.fn_claim_menu_image_cleanup(text),public.fn_finish_menu_image_cleanup(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_menu_image_upload(text,uuid,text,text,text),public.fn_claim_menu_image_cleanup(text),public.fn_finish_menu_image_cleanup(text,uuid) TO service_role;

DO $$ BEGIN
    IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
        INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
        VALUES('menu-images','menu-images',true,81919,ARRAY['image/webp'])
        ON CONFLICT(id) DO UPDATE SET public=true,file_size_limit=81919,allowed_mime_types=ARRAY['image/webp'];
        DROP POLICY IF EXISTS menu_images_no_browser_insert ON storage.objects;
        DROP POLICY IF EXISTS menu_images_no_browser_update ON storage.objects;
        DROP POLICY IF EXISTS menu_images_no_browser_delete ON storage.objects;
        CREATE POLICY menu_images_no_browser_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'menu-images');
        CREATE POLICY menu_images_no_browser_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'menu-images') WITH CHECK(bucket_id<>'menu-images');
        CREATE POLICY menu_images_no_browser_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'menu-images');
    END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Server read boundaries (spec amendment 12.13). Ship with migrated callers.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_dine_in_snapshot(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '5s'
AS $$
DECLARE s public.table_sessions%ROWTYPE; result jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO s FROM public.table_sessions
    WHERE session_token = p_token AND session_type = 'DINE_IN'
      AND status IN ('ACTIVE','REQUEST_BILL') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0002'; END IF;
  SELECT jsonb_build_object(
    'session', jsonb_build_object('id',s.id,'status',s.status,'payment_method',s.payment_method),
    'table', (SELECT jsonb_build_object('table_number',t.table_number) FROM public.tables t WHERE t.id=s.table_id),
    'zone', (SELECT jsonb_build_object('name',z.name) FROM public.zones z JOIN public.tables t ON t.zone_id=z.id WHERE t.id=s.table_id),
    'menu', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'category',m.category,
      'station',m.station,'price',m.price,'prep_time_minutes',m.prep_time_minutes,'image_url',m.image_url,
      'is_available',m.is_available) ORDER BY m.name,m.id) FROM public.menu_items m),'[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) - ARRAY['unit_cost_price','served_by_staff_id','cancelled_by','stock_export_log_id'] ORDER BY i.created_at,i.id)
      FROM public.order_items i WHERE i.session_id=s.id),'[]'::jsonb),
    'queuePositions', COALESCE((SELECT jsonb_object_agg(own.id::text,
      (SELECT count(*)+1 FROM public.order_items q JOIN public.table_sessions qs ON qs.id=q.session_id
        WHERE q.station='KITCHEN' AND q.status='QUEUED' AND q.quantity>0
          AND qs.status IN ('ACTIVE','REQUEST_BILL') AND q.created_at<own.created_at))
      FROM public.order_items own WHERE own.session_id=s.id AND own.station='KITCHEN'
        AND own.status='QUEUED' AND own.quantity>0),'{}'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

DO $$
DECLARE rel text; col record; fn record;
BEGIN
  FOREACH rel IN ARRAY ARRAY['zones','staff_profiles','tables','ingredients','inventory_logs','menu_items','table_sessions','order_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',rel);
    EXECUTE format('DROP POLICY IF EXISTS deny_browser_business ON public.%I',rel);
    EXECUTE format('CREATE POLICY deny_browser_business ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING (false) WITH CHECK (false)',rel);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',rel);
    -- REVOKE table privileges does not remove pre-existing column grants.
    FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=format('public.%I',rel)::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM PUBLIC,anon,authenticated,service_role',
        col.attname,col.attname,col.attname,col.attname,rel);
    END LOOP;
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role',rel);
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['vw_kpi_financial_summary','vw_kpi_peak_hours','vw_kpi_menu_analytics','vw_kpi_kitchen_performance','vw_kpi_waitstaff_performance'] LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker=true)',rel);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',rel);
    FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=format('public.%I',rel)::regclass AND attnum>0 AND NOT attisdropped LOOP
      EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I FROM PUBLIC,anon,authenticated,service_role',
        col.attname,col.attname,col.attname,col.attname,rel);
    END LOOP;
    EXECUTE format('GRANT SELECT ON public.%I TO service_role',rel);
  END LOOP;
  -- Application functions only; do not change pgcrypto/extension privileges.
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'fn\_%' ESCAPE '\' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);
  END LOOP;
END $$;
GRANT UPDATE (push_subscription) ON public.staff_profiles TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;

-- Preflight: operator must reconcile legacy conflicts before this atomic upgrade.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.table_sessions WHERE session_type='DINE_IN' AND status<>'CLOSED'
    AND table_id IS NOT NULL GROUP BY table_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'READ_BOUNDARY_PREFLIGHT_DUPLICATE_LIVE_TABLE' USING ERRCODE='23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tables t JOIN public.table_sessions s ON s.id=t.current_session_id
    WHERE s.table_id IS DISTINCT FROM t.id OR s.session_type<>'DINE_IN' OR s.status NOT IN ('ACTIVE','REQUEST_BILL')) THEN
    RAISE EXCEPTION 'READ_BOUNDARY_PREFLIGHT_SESSION_POINTER' USING ERRCODE='23514';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS one_live_dine_in_per_table ON public.table_sessions(table_id)
  WHERE session_type='DINE_IN' AND status<>'CLOSED' AND table_id IS NOT NULL;

DO $$ DECLARE constraint_row record; BEGIN
  FOR constraint_row IN SELECT * FROM (VALUES
    ('ingredients','finite_nonnegative_stock', 'stock_quantity>=0 AND stock_quantity<''Infinity''::numeric AND min_threshold>=0 AND min_threshold<''Infinity''::numeric AND unit_cost>=0 AND unit_cost<''Infinity''::numeric'),
    ('menu_items','finite_menu_prices','price>=0 AND price<''Infinity''::numeric AND cost_price>=0 AND cost_price<''Infinity''::numeric'),
    ('order_items','finite_item_prices','quantity>=0 AND unit_price>=0 AND unit_price<''Infinity''::numeric AND unit_cost_price>=0 AND unit_cost_price<''Infinity''::numeric'),
    ('table_sessions','finite_session_total','total_amount>=0 AND total_amount<''Infinity''::numeric'),
    ('inventory_logs','finite_signed_inventory_log','total_cost>=0 AND total_cost<''Infinity''::numeric AND quantity_change>''-Infinity''::numeric AND quantity_change<''Infinity''::numeric AND ((type IN (''IMPORT'',''RETURN_BEER'') AND quantity_change>0) OR (type IN (''EXPORT_SALE'',''WASTAGE'') AND quantity_change<0))')
  ) AS checks(rel,name,expression) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=format('public.%I',constraint_row.rel)::regclass AND conname=constraint_row.name) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID',constraint_row.rel,constraint_row.name,constraint_row.expression);
    END IF;
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',constraint_row.rel,constraint_row.name);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS session_item_display_idx ON public.order_items(session_id,created_at,id);
CREATE INDEX IF NOT EXISTS bill_status_page_idx ON public.table_sessions(status DESC,opened_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS inventory_type_page_idx ON public.inventory_logs(type,created_at DESC,id DESC);
NOTIFY pgrst,'reload schema';
COMMIT;

-- Durable push delivery; spec 12.14. No external network is performed in SQL.
BEGIN;
ALTER TABLE private.notification_outbox ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE private.notification_outbox ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE private.notification_outbox ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('SENT','SKIPPED','FAILED'));
CREATE TABLE IF NOT EXISTS private.notification_receipts (
  outbox_id uuid NOT NULL REFERENCES private.notification_outbox(id) ON DELETE RESTRICT,
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  subscription_hash text NOT NULL CHECK (subscription_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(outbox_id,staff_id,subscription_hash)
);
ALTER TABLE private.notification_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.notification_receipts,private.notification_outbox FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS notification_actionable_idx ON private.notification_outbox(available_at,id)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

CREATE OR REPLACE FUNCTION private.enqueue_bill_notification()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF OLD.status='ACTIVE' AND NEW.status='REQUEST_BILL' THEN
    INSERT INTO private.notification_outbox(dedupe_key,session_id,kind,payload)
    VALUES('bill-request:'||NEW.id::text,NEW.id,'BILL_REQUESTED',jsonb_build_object('sessionId',NEW.id)) ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enqueue_bill_notification() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS enqueue_bill_notification ON public.table_sessions;
CREATE TRIGGER enqueue_bill_notification AFTER UPDATE OF status ON public.table_sessions FOR EACH ROW EXECUTE FUNCTION private.enqueue_bill_notification();

CREATE OR REPLACE FUNCTION private.notification_targets(p_job private.notification_outbox)
RETURNS TABLE(staff_id text,subscription jsonb,subscription_hash text)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT p.id,p.push_subscription,encode(public.digest(p.push_subscription::text,'sha256'),'hex')
  FROM public.table_sessions s LEFT JOIN public.tables t ON t.id=s.table_id
  LEFT JOIN public.order_items i ON i.id=p_job.order_item_id AND i.session_id=s.id
  JOIN public.staff_profiles p ON p.is_active AND p.role IN ('staff','admin') AND p.push_subscription IS NOT NULL
  WHERE s.id=p_job.session_id AND s.status IN ('ACTIVE','REQUEST_BILL') AND (
    (p_job.kind IN ('ORDER_READY','ORDER_READY_FALLBACK') AND i.status='READY' AND i.quantity>0 AND i.served_at IS NULL
      AND i.ready_at IS NOT NULL AND isfinite(i.ready_at) AND i.ready_at<=now()
      AND (p_job.kind<>'ORDER_READY_FALLBACK' OR i.ready_at<=now()-interval '120 seconds'))
    OR (p_job.kind='BILL_REQUESTED' AND s.status='REQUEST_BILL')
  ) AND (
    (p_job.kind<>'ORDER_READY_FALLBACK' AND p.id=s.assigned_staff_id AND EXISTS(
      SELECT 1 FROM public.staff_profiles a WHERE a.id=s.assigned_staff_id AND a.is_active AND a.role IN ('staff','admin')))
    OR ((p_job.kind='ORDER_READY_FALLBACK' OR NOT EXISTS(
      SELECT 1 FROM public.staff_profiles a WHERE a.id=s.assigned_staff_id AND a.is_active AND a.role IN ('staff','admin')))
      AND t.zone_id IS NOT NULL AND p.assigned_zone_id=t.zone_id)
  ) AND NOT EXISTS(SELECT 1 FROM private.notification_receipts r WHERE r.outbox_id=p_job.id AND r.staff_id=p.id
    AND r.subscription_hash=encode(public.digest(p.push_subscription::text,'sha256'),'hex'))
  ORDER BY p.id;
$$;
REVOKE ALL ON FUNCTION private.notification_targets(private.notification_outbox) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_claim_notification_job()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE j private.notification_outbox; BEGIN
  WITH ignored AS (SELECT id FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL
    AND kind NOT IN ('ORDER_READY','ORDER_READY_FALLBACK','BILL_REQUESTED') AND (locked_until IS NULL OR locked_until<=clock_timestamp())
    ORDER BY available_at,id LIMIT 100 FOR UPDATE SKIP LOCKED)
  UPDATE private.notification_outbox o SET delivered_at=clock_timestamp(),outcome='SKIPPED',last_error='NOT_PUSH_EVENT',locked_until=NULL,lease_token=NULL
    FROM ignored x WHERE o.id=x.id;
  WITH exhausted AS (SELECT id FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL
    AND attempts>=8 AND (locked_until IS NULL OR locked_until<=clock_timestamp()) ORDER BY available_at,id LIMIT 50 FOR UPDATE SKIP LOCKED)
  UPDATE private.notification_outbox o SET failed_at=clock_timestamp(),outcome='FAILED',lease_token=NULL,locked_until=NULL,
    last_error=coalesce(last_error,'LEASE_EXHAUSTED') FROM exhausted e WHERE o.id=e.id;
  SELECT * INTO j FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL AND attempts<8
    AND available_at<=clock_timestamp() AND (locked_until IS NULL OR locked_until<=clock_timestamp())
    ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF j.kind='ORDER_READY' THEN
    INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload,available_at)
    SELECT 'ready-fallback:'||i.id::text,i.session_id,i.id,'ORDER_READY_FALLBACK',jsonb_build_object('orderItemId',i.id),i.ready_at+interval '120 seconds'
    FROM public.order_items i JOIN public.table_sessions s ON s.id=i.session_id
    WHERE i.id=j.order_item_id AND i.session_id=j.session_id AND i.status='READY' AND i.quantity>0 AND i.ready_at IS NOT NULL
      AND isfinite(i.ready_at) AND s.status IN ('ACTIVE','REQUEST_BILL') ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  UPDATE private.notification_outbox SET attempts=attempts+1,lease_token=gen_random_uuid(),locked_until=clock_timestamp()+interval '45 seconds'
    WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('id',j.id,'leaseToken',j.lease_token,'kind',j.kind);
END $$;

CREATE OR REPLACE FUNCTION private.assert_notification_lease(p_id uuid,p_lease uuid)
RETURNS private.notification_outbox LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE j private.notification_outbox; BEGIN
  SELECT * INTO j FROM private.notification_outbox WHERE id=p_id AND lease_token=p_lease AND locked_until>clock_timestamp()
    AND delivered_at IS NULL AND failed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_LEASE_LOST' USING ERRCODE='40001'; END IF;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION private.assert_notification_lease(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_prepare_notification_job(p_id uuid,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE j private.notification_outbox; target jsonb; BEGIN
  j:=private.assert_notification_lease(p_id,p_lease);
  SELECT jsonb_build_object('staffId',t.staff_id,'subscription',t.subscription,'subscriptionHash',t.subscription_hash)
    INTO target FROM private.notification_targets(j) t LIMIT 1;
  RETURN jsonb_build_object('kind',j.kind,'tag','notification-'||j.id::text,'target',target);
END $$;

CREATE OR REPLACE FUNCTION public.fn_ack_notification_recipient(p_id uuid,p_lease uuid,p_staff_id text,p_hash text,p_expired boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
  PERFORM private.assert_notification_lease(p_id,p_lease);
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_staff_id IS NULL OR p_expired IS NULL THEN RAISE EXCEPTION 'INVALID_RECEIPT' USING ERRCODE='22023'; END IF;
  IF p_expired THEN
    UPDATE public.staff_profiles SET push_subscription=NULL WHERE id=p_staff_id
      AND encode(public.digest(push_subscription::text,'sha256'),'hex')=p_hash;
  ELSE
    INSERT INTO private.notification_receipts(outbox_id,staff_id,subscription_hash) VALUES(p_id,p_staff_id,p_hash) ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_finish_notification_job(p_id uuid,p_lease uuid,p_retry boolean,p_error text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE j private.notification_outbox; state text; BEGIN
  j:=private.assert_notification_lease(p_id,p_lease);
  IF p_retry IS NULL OR (p_error IS NOT NULL AND p_error NOT IN ('PUSH_TRANSIENT','PUSH_REJECTED','DELIVERY_UNCERTAIN','WORKER_ERROR','BUDGET_EXHAUSTED')) THEN RAISE EXCEPTION 'INVALID_JOB_RESULT' USING ERRCODE='22023'; END IF;
  IF NOT p_retry AND NOT EXISTS(SELECT 1 FROM private.notification_targets(j)) THEN
    state:=CASE WHEN EXISTS(SELECT 1 FROM private.notification_receipts WHERE outbox_id=j.id) THEN 'SENT' ELSE 'SKIPPED' END;
    UPDATE private.notification_outbox SET delivered_at=clock_timestamp(),outcome=state,lease_token=NULL,locked_until=NULL,
      last_error=CASE WHEN state='SKIPPED' THEN 'NO_ELIGIBLE_RECIPIENT' ELSE NULL END WHERE id=j.id;
    RETURN state;
  END IF;
  state:=CASE WHEN j.attempts>=8 THEN 'FAILED' ELSE 'RETRY' END;
  UPDATE private.notification_outbox SET lease_token=NULL,locked_until=NULL,last_error=coalesce(p_error,'BUDGET_EXHAUSTED'),
    available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,least(j.attempts,6))*5)::int),
    failed_at=CASE WHEN state='FAILED' THEN clock_timestamp() ELSE NULL END,
    outcome=CASE WHEN state='FAILED' THEN 'FAILED' ELSE NULL END WHERE id=j.id;
  RETURN state;
END $$;

CREATE OR REPLACE FUNCTION public.fn_set_push_subscription(p_actor_id text,p_subscription jsonb,p_expected_endpoint text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
  PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_subscription IS NULL THEN
    IF p_expected_endpoint IS NULL OR length(p_expected_endpoint)>2048 THEN RAISE EXCEPTION 'EXPECTED_ENDPOINT_REQUIRED' USING ERRCODE='22023'; END IF;
    UPDATE public.staff_profiles SET push_subscription=NULL WHERE id=p_actor_id AND push_subscription->>'endpoint'=p_expected_endpoint;
  ELSE
    IF jsonb_typeof(p_subscription)<>'object' OR octet_length(p_subscription::text)>4096 THEN RAISE EXCEPTION 'INVALID_SUBSCRIPTION' USING ERRCODE='22023'; END IF;
    UPDATE public.staff_profiles SET push_subscription=p_subscription WHERE id=p_actor_id;
  END IF;
END $$;
REVOKE UPDATE(push_subscription) ON public.staff_profiles FROM service_role;

CREATE OR REPLACE FUNCTION public.fn_admin_notification_jobs(p_actor_id text,p_retry_id uuid DEFAULT NULL,p_expected_attempts integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE result jsonb; BEGIN
  PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role='admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_retry_id IS NOT NULL THEN
    UPDATE private.notification_outbox SET attempts=0,failed_at=NULL,outcome=NULL,available_at=clock_timestamp(),last_error=NULL,
      locked_until=NULL,lease_token=NULL WHERE id=p_retry_id AND failed_at IS NOT NULL AND attempts=p_expected_attempts;
    IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CHANGED' USING ERRCODE='40001'; END IF;
  END IF;
  SELECT jsonb_build_object('pending',(SELECT count(*) FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL),
    'failed',(SELECT count(*) FROM private.notification_outbox WHERE failed_at IS NOT NULL),
    'jobs',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT id,kind,attempts,available_at,locked_until,failed_at,outcome,last_error FROM private.notification_outbox
      WHERE delivered_at IS NULL ORDER BY failed_at DESC NULLS LAST,available_at,id LIMIT 25) x),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.fn_claim_notification_job(),public.fn_prepare_notification_job(uuid,uuid),
  public.fn_ack_notification_recipient(uuid,uuid,text,text,boolean),public.fn_finish_notification_job(uuid,uuid,boolean,text),
  public.fn_set_push_subscription(text,jsonb,text),public.fn_admin_notification_jobs(text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_notification_job(),public.fn_prepare_notification_job(uuid,uuid),
  public.fn_ack_notification_recipient(uuid,uuid,text,text,boolean),public.fn_finish_notification_job(uuid,uuid,boolean,text),
  public.fn_set_push_subscription(text,jsonb,text),public.fn_admin_notification_jobs(text,uuid,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Private invalidation only (spec 12.16). No application row payloads.
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_realtime_receive_allowed(p_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; t numeric := extract(epoch FROM now());
BEGIN
  c := nullif(current_setting('request.jwt.claims',true),'')::jsonb;
  IF c IS NULL OR c->>'app' IS DISTINCT FROM '123dzo-live-v1'
    OR c->>'role' IS DISTINCT FROM 'authenticated' OR c->>'aud' IS DISTINCT FROM 'authenticated'
    OR c->>'topic' IS DISTINCT FROM p_topic
    OR jsonb_typeof(c->'exp') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'iat') IS DISTINCT FROM 'number'
    OR (c->>'exp')::numeric <= t OR (c->>'iat')::numeric > t+5
    OR (c->>'iat')::numeric < t-125
    OR (c->>'exp')::numeric - (c->>'iat')::numeric NOT BETWEEN 1 AND 120
  THEN RETURN false; END IF;
  IF c->>'scope'='session' THEN
    RETURN p_topic='123dzo:session:'||(c->>'actor_id') AND EXISTS (
      SELECT 1 FROM public.table_sessions s WHERE s.id::text=c->>'actor_id'
        AND s.session_type='DINE_IN' AND s.status IN ('ACTIVE','REQUEST_BILL'));
  END IF;
  RETURN c->>'scope' IN ('staff','kitchen','admin')
    AND p_topic='123dzo:role:'||(c->>'scope') AND EXISTS (
      SELECT 1 FROM public.staff_profiles s WHERE s.id=c->>'actor_id'
        AND s.is_active AND s.role::text=c->>'scope');
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.fn_realtime_receive_allowed(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_realtime_receive_allowed(text) TO authenticated;

-- Supabase owns this table/RLS. Plain PostgreSQL fixtures have no managed schema.
DO $$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='realtime.messages'::regclass) THEN
      RAISE EXCEPTION 'Realtime messages must already have RLS enabled';
    END IF;
    EXECUTE 'DROP POLICY IF EXISTS dzo_receive ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS dzo_receive_boundary ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS dzo_anon_boundary ON realtime.messages';
    EXECUTE 'CREATE POLICY dzo_receive ON realtime.messages FOR SELECT TO authenticated
      USING (topic LIKE ''123dzo:%'' AND topic=(SELECT realtime.topic()) AND extension=''broadcast''
        AND public.fn_realtime_receive_allowed(topic))';
    EXECUTE 'CREATE POLICY dzo_receive_boundary ON realtime.messages AS RESTRICTIVE FOR SELECT TO authenticated
      USING ((topic NOT LIKE ''123dzo:%'' AND coalesce((SELECT realtime.topic()),'''') NOT LIKE ''123dzo:%'')
        OR (topic=(SELECT realtime.topic()) AND extension=''broadcast'' AND public.fn_realtime_receive_allowed(topic)))';
    EXECUTE 'CREATE POLICY dzo_anon_boundary ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon
      USING (topic NOT LIKE ''123dzo:%'' AND coalesce((SELECT realtime.topic()),'''') NOT LIKE ''123dzo:%'')';
    EXECUTE 'DROP POLICY IF EXISTS dzo_no_insert ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS dzo_no_update ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS dzo_no_delete ON realtime.messages';
    EXECUTE 'CREATE POLICY dzo_no_insert ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated
      WITH CHECK (topic NOT LIKE ''123dzo:%'' AND coalesce((SELECT realtime.topic()),'''') NOT LIKE ''123dzo:%'')';
    EXECUTE 'CREATE POLICY dzo_no_update ON realtime.messages AS RESTRICTIVE FOR UPDATE TO anon,authenticated
      USING (topic NOT LIKE ''123dzo:%'') WITH CHECK (topic NOT LIKE ''123dzo:%'')';
    EXECUTE 'CREATE POLICY dzo_no_delete ON realtime.messages AS RESTRICTIVE FOR DELETE TO anon,authenticated
      USING (topic NOT LIKE ''123dzo:%'')';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.emit_invalidation(p_former_session uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE dest text; payload jsonb := jsonb_build_object('v',1,'id',gen_random_uuid());
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN; END IF;
  FOR dest IN
    SELECT '123dzo:role:'||r FROM unnest(ARRAY['staff','kitchen','admin']) r
    UNION SELECT '123dzo:session:'||s.id FROM public.table_sessions s
      WHERE s.session_type='DINE_IN' AND s.status IN ('ACTIVE','REQUEST_BILL')
    UNION SELECT '123dzo:session:'||p_former_session WHERE p_former_session IS NOT NULL
  LOOP
    PERFORM realtime.send(payload,'invalidate',dest,true);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  -- Realtime availability must not roll back a sale. Guarded polling recovers.
  RAISE WARNING '123dzo invalidation unavailable; clients use protected refresh';
END $$;
CREATE OR REPLACE FUNCTION private.invalidate_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM private.emit_invalidation(); RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION private.invalidate_session()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN PERFORM private.emit_invalidation();
  ELSE PERFORM private.emit_invalidation(OLD.id); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.emit_invalidation(uuid),private.invalidate_statement(),private.invalidate_session()
  FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['order_items','menu_items','tables','zones','staff_profiles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS dzo_invalidate ON public.%I',tab);
    EXECUTE format('CREATE TRIGGER dzo_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.%I
      FOR EACH STATEMENT EXECUTE FUNCTION private.invalidate_statement()',tab);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS dzo_invalidate ON public.table_sessions;
CREATE TRIGGER dzo_invalidate AFTER INSERT OR UPDATE OR DELETE ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_session();
COMMIT;

-- KPI period correction (spec12.17).
BEGIN;
ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS activated_at timestamptz;

CREATE OR REPLACE FUNCTION public.fn_get_financial_kpi(
    p_start_date timestamptz DEFAULT '-infinity'::timestamptz,
    p_end_date timestamptz DEFAULT 'infinity'::timestamptz
)
RETURNS TABLE (
    gross_revenue numeric,
    cash_revenue numeric,
    vietqr_revenue numeric,
    dine_in_revenue numeric,
    takeaway_revenue numeric,
    closed_sessions_count bigint,
    total_cogs numeric,
    total_wastage_cost numeric,
    net_profit numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
WITH revenue AS (
 SELECT coalesce(sum(total_amount),0) gross_revenue,
 coalesce(sum(total_amount) FILTER(WHERE payment_method='CASH'),0) cash_revenue,
 coalesce(sum(total_amount) FILTER(WHERE payment_method='VIETQR'),0) vietqr_revenue,
 coalesce(sum(total_amount) FILTER(WHERE session_type='DINE_IN'),0) dine_in_revenue,
 coalesce(sum(total_amount) FILTER(WHERE session_type='TAKEAWAY'),0) takeaway_revenue,
 count(*) closed_sessions_count FROM public.table_sessions
 WHERE status='CLOSED' AND closed_at>=p_start_date AND closed_at<p_end_date
), costs AS (
 SELECT coalesce(sum(o.unit_cost_price*o.quantity),0) total_cogs
 FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id
 WHERE s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') AND o.quantity>0
 AND (o.status='SERVED' OR (o.status='CANCELLED' AND (o.cooking_started_at IS NOT NULL OR o.ready_at IS NOT NULL)))
 AND coalesce(o.served_at,o.cancelled_at)>=p_start_date AND coalesce(o.served_at,o.cancelled_at)<p_end_date
), waste AS (
 SELECT coalesce(sum(abs(total_cost)),0) total_wastage_cost FROM public.inventory_logs
 WHERE type='WASTAGE' AND created_at>=p_start_date AND created_at<p_end_date
) SELECT r.*,c.total_cogs,w.total_wastage_cost,r.gross_revenue-c.total_cogs-w.total_wastage_cost net_profit
 FROM revenue r CROSS JOIN costs c CROSS JOIN waste w;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_menu_kpi(
    p_start_date timestamptz DEFAULT '-infinity'::timestamptz,
    p_end_date timestamptz DEFAULT 'infinity'::timestamptz
)
RETURNS TABLE (
    menu_item_id uuid,
    name text,
    category text,
    station text,
    is_available boolean,
    total_quantity_sold bigint,
    gross_revenue numeric,
    total_cogs numeric,
    gross_profit numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
SELECT m.id,m.name,m.category,m.station,m.is_available,
 coalesce(sum(o.quantity),0)::bigint,coalesce(sum(o.unit_price*o.quantity),0)::numeric,
 coalesce(sum(o.unit_cost_price*o.quantity),0)::numeric,coalesce(sum((o.unit_price-o.unit_cost_price)*o.quantity),0)::numeric
 FROM public.menu_items m LEFT JOIN public.order_items o ON o.menu_item_id=m.id AND o.status='SERVED' AND o.quantity>0
 AND o.served_at>=p_start_date AND o.served_at<p_end_date
 AND EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id=o.session_id AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED'))
 GROUP BY m.id,m.name,m.category,m.station,m.is_available ORDER BY 6 DESC,m.id;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_kitchen_kpi(
    p_start_date timestamptz DEFAULT '-infinity'::timestamptz,
    p_end_date timestamptz DEFAULT 'infinity'::timestamptz
)
RETURNS TABLE (
    total_cooked_items bigint,
    batch_cooked_items bigint,
    avg_queue_wait_minutes numeric,
    avg_actual_cook_minutes numeric,
    avg_standard_prep_minutes numeric,
    cook_time_evaluation text,
    batch_cooking_efficiency_pct numeric,
    slow_cancelled_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
WITH relevant AS (
 SELECT o.*,m.prep_time_minutes,CASE WHEN s.session_type='DINE_IN' THEN o.created_at
 WHEN s.activated_at IS NOT NULL THEN greatest(o.created_at,s.activated_at) END queue_at
 FROM public.order_items o JOIN public.menu_items m ON m.id=o.menu_item_id
 JOIN public.table_sessions s ON s.id=o.session_id WHERE o.station='KITCHEN' AND o.quantity>0
 AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED')
), stats AS (
 SELECT count(*) FILTER(WHERE status='SERVED' AND served_at>=p_start_date AND served_at<p_end_date) total_cooked_items,
 count(*) FILTER(WHERE status='SERVED' AND batch_id IS NOT NULL AND served_at>=p_start_date AND served_at<p_end_date) batch_cooked_items,
 coalesce(round(avg(extract(epoch FROM(cooking_started_at-queue_at))/60) FILTER(WHERE status='SERVED'
 AND served_at>=p_start_date AND served_at<p_end_date AND cooking_started_at>=queue_at),2),0) avg_queue_wait_minutes,
 coalesce(round(avg(extract(epoch FROM(ready_at-cooking_started_at))/60) FILTER(WHERE status='SERVED'
 AND served_at>=p_start_date AND served_at<p_end_date AND ready_at>=cooking_started_at),2),0) actual,
 coalesce(round(avg(prep_time_minutes) FILTER(WHERE status='SERVED' AND served_at>=p_start_date AND served_at<p_end_date
 AND ready_at>=cooking_started_at),2),0) standard,
 count(*) FILTER(WHERE status='SERVED' AND served_at>=p_start_date AND served_at<p_end_date AND ready_at>=cooking_started_at) samples,
 count(*) FILTER(WHERE status='CANCELLED' AND cancelled_at>=p_start_date AND cancelled_at<p_end_date
 AND cancelled_at>queue_at+interval '15 minutes') slow_cancelled_count FROM relevant
) SELECT total_cooked_items,batch_cooked_items,avg_queue_wait_minutes,actual,standard,
 CASE WHEN samples=0 THEN 'NO_DATA' WHEN actual<=standard THEN 'ON_TIME' WHEN actual<=standard*1.3 THEN 'WARNING' ELSE 'LATE' END,
 CASE WHEN total_cooked_items=0 THEN 0::numeric ELSE round(batch_cooked_items*100.0/total_cooked_items,2) END,
 slow_cancelled_count FROM stats;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_waitstaff_kpi(
    p_start_date timestamptz DEFAULT '-infinity'::timestamptz,
    p_end_date timestamptz DEFAULT 'infinity'::timestamptz
)
RETURNS TABLE (
    staff_id text,
    full_name text,
    role text,
    assigned_zone_id uuid,
    is_active boolean,
    tables_opened_count bigint,
    managed_tables_revenue numeric,
    active_serving_count bigint,
    avg_pickup_speed_seconds numeric,
    pickup_speed_evaluation text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
WITH sessions AS (
 SELECT assigned_staff_id staff_id,count(*) FILTER(WHERE opened_at>=p_start_date AND opened_at<p_end_date) opened,
 coalesce(sum(total_amount) FILTER(WHERE status='CLOSED' AND closed_at>=p_start_date AND closed_at<p_end_date),0) revenue
 FROM public.table_sessions WHERE assigned_staff_id IS NOT NULL AND status IN ('ACTIVE','REQUEST_BILL','CLOSED') GROUP BY assigned_staff_id
), serving AS (
 SELECT o.served_by_staff_id staff_id,count(*) count_served,
 count(*) FILTER(WHERE o.served_at>=o.ready_at) samples,
 coalesce(round(avg(extract(epoch FROM(o.served_at-o.ready_at))) FILTER(WHERE o.served_at>=o.ready_at),2),0) speed
 FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id WHERE o.status='SERVED' AND o.quantity>0
 AND o.served_at>=p_start_date AND o.served_at<p_end_date AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') GROUP BY o.served_by_staff_id
) SELECT p.id,p.full_name,p.role,p.assigned_zone_id,p.is_active,coalesce(s.opened,0)::bigint,coalesce(s.revenue,0)::numeric,
 coalesce(v.count_served,0)::bigint,coalesce(v.speed,0)::numeric,
 CASE WHEN coalesce(v.samples,0)=0 THEN 'NO_DATA' WHEN v.speed<90 THEN 'EXCELLENT' WHEN v.speed<=180 THEN 'NORMAL' ELSE 'SLOW' END
 FROM public.staff_profiles p LEFT JOIN sessions s ON s.staff_id=p.id LEFT JOIN serving v ON v.staff_id=p.id
 WHERE p.role IN ('staff','admin') ORDER BY 8 DESC,p.id;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_peak_hours_kpi(p_start_date timestamptz DEFAULT '-infinity',p_end_date timestamptz DEFAULT 'infinity')
RETURNS TABLE(hour_of_day integer,total_orders_count bigint,total_items_quantity bigint,total_order_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 WITH eligible AS (
 SELECT o.*,CASE WHEN s.session_type='DINE_IN' THEN o.created_at WHEN s.activated_at IS NOT NULL THEN greatest(o.created_at,s.activated_at) END queue_at
 FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id
 WHERE o.status<>'CANCELLED' AND o.quantity>0 AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED')
 ) SELECT extract(hour FROM(queue_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer,count(*),sum(quantity)::bigint,sum(unit_price*quantity)::numeric
 FROM eligible WHERE queue_at>=p_start_date AND queue_at<p_end_date GROUP BY 1 ORDER BY 1;
$$;

CREATE OR REPLACE VIEW public.vw_kpi_financial_summary WITH(security_invoker=true) AS SELECT * FROM public.fn_get_financial_kpi('-infinity','infinity');

REVOKE ALL ON public.vw_kpi_financial_summary FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.vw_kpi_financial_summary TO service_role;

CREATE OR REPLACE VIEW public.vw_kpi_menu_analytics WITH(security_invoker=true) AS SELECT * FROM public.fn_get_menu_kpi('-infinity','infinity');

REVOKE ALL ON public.vw_kpi_menu_analytics FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.vw_kpi_menu_analytics TO service_role;

CREATE OR REPLACE VIEW public.vw_kpi_kitchen_performance WITH(security_invoker=true) AS SELECT * FROM public.fn_get_kitchen_kpi('-infinity','infinity');

REVOKE ALL ON public.vw_kpi_kitchen_performance FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.vw_kpi_kitchen_performance TO service_role;

CREATE OR REPLACE VIEW public.vw_kpi_waitstaff_performance WITH(security_invoker=true) AS SELECT * FROM public.fn_get_waitstaff_kpi('-infinity','infinity');

REVOKE ALL ON public.vw_kpi_waitstaff_performance FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.vw_kpi_waitstaff_performance TO service_role;

CREATE OR REPLACE VIEW public.vw_kpi_peak_hours WITH(security_invoker=true) AS SELECT * FROM public.fn_get_peak_hours_kpi('-infinity','infinity');

REVOKE ALL ON public.vw_kpi_peak_hours FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.vw_kpi_peak_hours TO service_role;

REVOKE ALL ON FUNCTION public.fn_get_financial_kpi(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_get_financial_kpi(timestamptz,timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.fn_get_menu_kpi(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_get_menu_kpi(timestamptz,timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.fn_get_kitchen_kpi(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_get_kitchen_kpi(timestamptz,timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.fn_get_waitstaff_kpi(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_get_waitstaff_kpi(timestamptz,timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.fn_get_peak_hours_kpi(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_get_peak_hours_kpi(timestamptz,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_get_dine_in_snapshot(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog SET lock_timeout = '5s'
AS $$
DECLARE s public.table_sessions%ROWTYPE; result jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO s FROM public.table_sessions
    WHERE session_token = p_token AND session_type = 'DINE_IN'
      AND status IN ('ACTIVE','REQUEST_BILL') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_UNAVAILABLE' USING ERRCODE = 'P0002'; END IF;
  SELECT jsonb_build_object(
    'session', jsonb_build_object('id',s.id,'status',s.status,'payment_method',s.payment_method),
    'table', (SELECT jsonb_build_object('table_number',t.table_number) FROM public.tables t WHERE t.id=s.table_id),
    'zone', (SELECT jsonb_build_object('name',z.name) FROM public.zones z JOIN public.tables t ON t.zone_id=z.id WHERE t.id=s.table_id),
    'menu', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'category',m.category,
      'station',m.station,'price',m.price,'prep_time_minutes',m.prep_time_minutes,'image_url',m.image_url,
      'is_available',m.is_available) ORDER BY m.name,m.id) FROM public.menu_items m),'[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) - ARRAY['unit_cost_price','served_by_staff_id','cancelled_by','stock_export_log_id'] ORDER BY i.created_at,i.id)
      FROM public.order_items i WHERE i.session_id=s.id),'[]'::jsonb),
    'queuePositions', COALESCE((SELECT jsonb_object_agg(own.id::text,
      (SELECT count(*)+1 FROM public.order_items q JOIN public.table_sessions qs ON qs.id=q.session_id
        WHERE q.station='KITCHEN' AND q.status='QUEUED' AND q.quantity>0
          AND qs.status IN ('ACTIVE','REQUEST_BILL') AND (CASE WHEN qs.session_type='DINE_IN' THEN q.created_at WHEN qs.activated_at IS NOT NULL THEN greatest(q.created_at,qs.activated_at) END)<own.created_at))
      FROM public.order_items own WHERE own.session_id=s.id AND own.station='KITCHEN'
        AND own.status='QUEUED' AND own.quantity>0),'{}'::jsonb)
  ) INTO result;
  RETURN result;
END $$;

CREATE INDEX IF NOT EXISTS kpi_closed_period_idx ON public.table_sessions(closed_at) WHERE status='CLOSED';

CREATE INDEX IF NOT EXISTS kpi_served_period_idx ON public.order_items(served_at) WHERE status='SERVED' AND quantity>0;

COMMIT;

-- Read-only reconciliation: never rewrites historical records.
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_admin_data_health(p_actor_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('checkedAt',now(),'checks',jsonb_build_array(
  jsonb_build_object('code','DUPLICATE_LIVE_TABLE','count',(SELECT count(*) FROM (
   SELECT table_id FROM public.table_sessions WHERE session_type='DINE_IN' AND status IN ('ACTIVE','REQUEST_BILL') AND table_id IS NOT NULL GROUP BY table_id HAVING count(*)>1) x)),
  jsonb_build_object('code','TABLE_POINTER_MISMATCH','count',(SELECT count(*) FROM public.tables t WHERE
   (t.current_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id=t.current_session_id AND s.table_id=t.id AND s.session_type='DINE_IN' AND s.status IN ('ACTIVE','REQUEST_BILL')))
   OR (t.status='AVAILABLE' AND t.current_session_id IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.table_id=t.id AND s.session_type='DINE_IN' AND s.status IN ('ACTIVE','REQUEST_BILL') AND (t.current_session_id IS DISTINCT FROM s.id OR t.status<>'OCCUPIED')))),
  jsonb_build_object('code','BILL_TOTAL_MISMATCH','count',(SELECT count(*) FROM public.table_sessions s WHERE s.total_amount IS DISTINCT FROM
   (SELECT coalesce(sum(o.quantity*o.unit_price),0) FROM public.order_items o WHERE o.session_id=s.id AND o.status<>'CANCELLED'))),
  jsonb_build_object('code','NEGATIVE_STOCK','count',(SELECT count(*) FROM public.ingredients WHERE stock_quantity<0)),
  jsonb_build_object('code','MISSING_KPI_TIMESTAMPS','count',(SELECT count(*) FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id
   WHERE s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') AND o.quantity>0 AND
    ((o.status='COOKING' AND o.cooking_started_at IS NULL)
    OR (o.status IN ('READY','SERVED') AND o.ready_at IS NULL)
    OR (o.status='SERVED' AND (o.served_at IS NULL OR o.served_by_staff_id IS NULL))
    OR (o.status IN ('READY','SERVED') AND o.station='KITCHEN' AND o.cooking_started_at IS NULL)
    OR o.ready_at<o.cooking_started_at OR o.served_at<o.ready_at))),
  jsonb_build_object('code','UNVERIFIED_TAKEAWAY_ACTIVATION','count',(SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND status IN ('ACTIVE','CLOSED') AND activated_at IS NULL)),
  jsonb_build_object('code','MISSING_EXPORT_PROVENANCE','count',(SELECT count(*) FROM public.order_items o JOIN public.menu_items m ON m.id=o.menu_item_id
   WHERE o.station='BAR_INSTANT' AND m.linked_ingredient_id IS NOT NULL AND o.quantity>0 AND NOT EXISTS(
    SELECT 1 FROM public.inventory_logs l WHERE l.id=o.stock_export_log_id AND l.type='EXPORT_SALE' AND l.quantity_change<0)))
 ));
END $$;
REVOKE ALL ON FUNCTION public.fn_admin_data_health(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_data_health(text) TO service_role;
COMMIT;

-- Manual receipts: PRD 12.20. Audit remains in the private immutable operation ledger.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_receipt_session ON private.operation_requests(session_id)
 WHERE action='manual.payment.confirm';
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_receipt_reference ON private.operation_requests((result->>'reference'))
 WHERE action='manual.payment.confirm' AND result->>'paymentMethod'='VIETQR';
CREATE INDEX IF NOT EXISTS idx_manual_receipt_history ON private.operation_requests(completed_at DESC,id DESC)
 WHERE action IN ('manual.payment.confirm','session.action');

CREATE OR REPLACE FUNCTION public.fn_confirm_manual_payment(p_actor_id text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
 s public.table_sessions%ROWTYPE; actor public.staff_profiles%ROWTYPE;
 scope text:='manual-payment:staff:'||p_actor_id; claim jsonb; total numeric;
 ref text; method text; stamp timestamptz; stock record; export_id uuid; result jsonb;
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>4096
  OR NOT(p_command ?& ARRAY['sessionId','expectedTotal','paymentMethod','reference','confirmedReceived'])
  OR p_command-ARRAY['sessionId','expectedTotal','paymentMethod','reference','confirmedReceived']<>'{}'::jsonb
  OR jsonb_typeof(p_command->'sessionId')<>'string' OR jsonb_typeof(p_command->'expectedTotal')<>'number'
  OR jsonb_typeof(p_command->'paymentMethod')<>'string' OR jsonb_typeof(p_command->'reference')<>'string'
  OR p_command->'confirmedReceived'<>'true'::jsonb OR p_operation_id IS NULL THEN
  RAISE EXCEPTION 'Invalid payment confirmation' USING ERRCODE='22023';
 END IF;
 method:=p_command->>'paymentMethod';
 ref:=upper(regexp_replace(btrim(p_command->>'reference'),'\s+','','g'));
 IF method NOT IN ('CASH','VIETQR') OR length(p_command->>'reference')>120
  OR (method='VIETQR' AND length(ref) NOT BETWEEN 1 AND 120) OR (method='CASH' AND ref<>'')
  OR NOT((p_command->>'expectedTotal')::numeric>0 AND (p_command->>'expectedTotal')::numeric<=1000000000000000) THEN
  RAISE EXCEPTION 'Invalid amount or reference' USING ERRCODE='22023';
 END IF;
 SELECT * INTO s FROM public.table_sessions WHERE id=(p_command->>'sessionId')::uuid FOR UPDATE;
 IF NOT FOUND OR s.session_type<>'TAKEAWAY' THEN RAISE EXCEPTION 'Takeaway missing' USING ERRCODE='P0002'; END IF;
 SELECT * INTO actor FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Serving staff required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope||':'||p_operation_id::text,0));
 claim:=private.begin_operation(scope,p_operation_id,'manual.payment.confirm',p_command,s.id,p_actor_id);
 IF (claim->>'replay')::boolean THEN RETURN claim->'result'; END IF;
 IF s.status<>'PENDING_PAYMENT' OR s.activated_at IS NOT NULL THEN RAISE EXCEPTION 'Payment already handled' USING ERRCODE='P1501'; END IF;
 PERFORM id FROM public.order_items WHERE session_id=s.id ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.order_items WHERE session_id=s.id) NOT BETWEEN 1 AND 30
  OR EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND (quantity NOT BETWEEN 1 AND 99
   OR cooking_started_at IS NOT NULL OR ready_at IS NOT NULL OR served_at IS NOT NULL
   OR cancelled_at IS NOT NULL OR stock_export_log_id IS NOT NULL
   OR (station='KITCHEN' AND status<>'QUEUED') OR (station='BAR_INSTANT' AND status<>'READY'))) THEN
  RAISE EXCEPTION 'Pending items need reconciliation' USING ERRCODE='P1503';
 END IF;
 SELECT sum(quantity*unit_price) INTO total FROM public.order_items WHERE session_id=s.id;
 IF total IS DISTINCT FROM s.total_amount OR total IS DISTINCT FROM (p_command->>'expectedTotal')::numeric
  OR NOT(total>0 AND total<'Infinity'::numeric) THEN RAISE EXCEPTION 'Bill changed' USING ERRCODE='P1306'; END IF;
 PERFORM m.id FROM public.menu_items m JOIN public.order_items oi ON oi.menu_item_id=m.id
  WHERE oi.session_id=s.id ORDER BY m.id FOR SHARE OF m;
 IF EXISTS(SELECT 1 FROM public.order_items oi JOIN public.menu_items m ON m.id=oi.menu_item_id
  WHERE oi.session_id=s.id AND (NOT m.is_available OR m.station<>oi.station
   OR (m.linked_ingredient_id IS NOT NULL AND (m.category='FOOD' OR m.station<>'BAR_INSTANT')))) THEN
  RAISE EXCEPTION 'Menu needs reconciliation before receipt' USING ERRCODE='P1503';
 END IF;
 FOR stock IN SELECT ing.id,ing.stock_quantity,ing.unit_cost,need.quantity FROM public.ingredients ing
  JOIN (SELECT m.linked_ingredient_id id,sum(oi.quantity) quantity FROM public.order_items oi
   JOIN public.menu_items m ON m.id=oi.menu_item_id WHERE oi.session_id=s.id AND m.linked_ingredient_id IS NOT NULL
   GROUP BY m.linked_ingredient_id) need ON need.id=ing.id ORDER BY ing.id FOR UPDATE OF ing
 LOOP
  IF stock.stock_quantity<stock.quantity THEN RAISE EXCEPTION 'Insufficient stock' USING ERRCODE='P1004'; END IF;
  UPDATE public.ingredients SET stock_quantity=stock_quantity-stock.quantity WHERE id=stock.id;
  INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost,note,created_by)
   VALUES(stock.id,'EXPORT_SALE',-stock.quantity,stock.quantity*stock.unit_cost,'Manual receipt '||p_operation_id,p_actor_id)
   RETURNING id INTO export_id;
  UPDATE public.order_items oi SET stock_export_log_id=export_id FROM public.menu_items m
   WHERE oi.session_id=s.id AND oi.menu_item_id=m.id AND m.linked_ingredient_id=stock.id;
 END LOOP;
 stamp:=clock_timestamp();
 UPDATE public.table_sessions SET status='ACTIVE',activated_at=stamp,payment_method=method,total_amount=total,assigned_staff_id=p_actor_id WHERE id=s.id;
 UPDATE public.order_items SET ready_at=stamp WHERE session_id=s.id AND station='BAR_INSTANT';
 INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload)
  SELECT 'new-item:'||id::text,s.id,id,CASE WHEN station='BAR_INSTANT' THEN 'ORDER_READY' ELSE 'KITCHEN_ORDER_CREATED' END,
   jsonb_build_object('sessionId',s.id,'orderItemId',id) FROM public.order_items WHERE session_id=s.id;
 result:=jsonb_build_object('operationId',p_operation_id,'sessionId',s.id,'amount',total,'paymentMethod',method,
  'reference',ref,'confirmedAt',stamp,'confirmedBy',actor.id,'confirmedByName',actor.full_name,'confirmedByRole',actor.role,
  'statusBefore','PENDING_PAYMENT','statusAfter','ACTIVE');
 RETURN private.complete_operation(scope,p_operation_id,result);
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid confirmation values' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_manual_payment_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE result jsonb; scope text:='manual-payment:staff:'||p_actor_id;
BEGIN
 PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Serving staff required' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope||':'||p_operation_id::text,0));
 SELECT op.result INTO result FROM private.operation_requests op
  WHERE op.scope_key=scope AND op.operation_id=p_operation_id AND op.action='manual.payment.confirm';
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.fn_manual_payment_status(p_actor_id text,p_pending_page integer DEFAULT 1,p_history_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pending jsonb; history jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin')) THEN
  RAISE EXCEPTION 'Serving staff required' USING ERRCODE='42501'; END IF;
 IF p_pending_page IS NULL OR p_history_page IS NULL OR p_pending_page NOT BETWEEN 1 AND 10000 OR p_history_page NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION 'Invalid payment page' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO pending FROM (
  SELECT id AS "sessionId",payment_code AS "paymentCode",customer_name AS "customerName",customer_phone AS "customerPhone",
   total_amount AS amount,opened_at AS "openedAt" FROM public.table_sessions
   WHERE session_type='TAKEAWAY' AND status='PENDING_PAYMENT' ORDER BY opened_at,id LIMIT 26 OFFSET (p_pending_page-1)*25
 ) row;
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO history FROM (
  SELECT op.id AS "recordId",op.operation_id AS "operationId",op.session_id AS "sessionId",
   CASE WHEN op.action='manual.payment.confirm' THEN 'CONFIRM_PAYMENT' ELSE 'CLOSE_BILL' END AS action,
   coalesce(op.result->'amount',op.result->'totalAmount') AS amount,
   coalesce(op.result->>'paymentMethod',s.payment_method) AS "paymentMethod",
   coalesce(op.result->>'reference','') AS reference,op.actor_id AS "confirmedBy",
   coalesce(op.result->>'confirmedByName',sp.full_name) AS "confirmedByName",
   coalesce(op.result->>'confirmedAt',op.completed_at::text) AS "confirmedAt"
  FROM private.operation_requests op JOIN public.staff_profiles sp ON sp.id=op.actor_id
  JOIN public.table_sessions s ON s.id=op.session_id
  WHERE op.completed_at IS NOT NULL AND (op.action='manual.payment.confirm' OR (op.action='session.action' AND op.result->>'action'='CLOSE'))
  ORDER BY op.completed_at DESC,op.id DESC LIMIT 26 OFFSET (p_history_page-1)*25
 ) row;
 RETURN jsonb_build_object('pending',(SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(pending) WITH ORDINALITY a(value,n) WHERE n<=25),
  'history',(SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(history) WITH ORDINALITY a(value,n) WHERE n<=25),
  'pendingHasMore',jsonb_array_length(pending)>25,'historyHasMore',jsonb_array_length(history)>25);
END $$;
CREATE OR REPLACE FUNCTION public.fn_admin_data_health(p_actor_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('checkedAt',now(),'checks',jsonb_build_array(
  jsonb_build_object('code','DUPLICATE_LIVE_TABLE','count',(SELECT count(*) FROM (
   SELECT table_id FROM public.table_sessions WHERE session_type='DINE_IN' AND status IN ('ACTIVE','REQUEST_BILL') AND table_id IS NOT NULL GROUP BY table_id HAVING count(*)>1) x)),
  jsonb_build_object('code','TABLE_POINTER_MISMATCH','count',(SELECT count(*) FROM public.tables t WHERE
   (t.current_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id=t.current_session_id AND s.table_id=t.id AND s.session_type='DINE_IN' AND s.status IN ('ACTIVE','REQUEST_BILL')))
   OR (t.status='AVAILABLE' AND t.current_session_id IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.table_id=t.id AND s.session_type='DINE_IN' AND s.status IN ('ACTIVE','REQUEST_BILL') AND (t.current_session_id IS DISTINCT FROM s.id OR t.status<>'OCCUPIED')))),
  jsonb_build_object('code','BILL_TOTAL_MISMATCH','count',(SELECT count(*) FROM public.table_sessions s WHERE s.total_amount IS DISTINCT FROM
   (SELECT coalesce(sum(o.quantity*o.unit_price),0) FROM public.order_items o WHERE o.session_id=s.id AND o.status<>'CANCELLED'))),
  jsonb_build_object('code','NEGATIVE_STOCK','count',(SELECT count(*) FROM public.ingredients WHERE stock_quantity<0)),
  jsonb_build_object('code','MISSING_KPI_TIMESTAMPS','count',(SELECT count(*) FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id
   WHERE s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') AND o.quantity>0 AND
    ((o.status='COOKING' AND o.cooking_started_at IS NULL)
    OR (o.status IN ('READY','SERVED') AND o.ready_at IS NULL)
    OR (o.status='SERVED' AND (o.served_at IS NULL OR o.served_by_staff_id IS NULL))
    OR (o.status IN ('READY','SERVED') AND o.station='KITCHEN' AND o.cooking_started_at IS NULL)
    OR o.ready_at<o.cooking_started_at OR o.served_at<o.ready_at))),
  jsonb_build_object('code','UNVERIFIED_TAKEAWAY_ACTIVATION','count',(SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND status IN ('ACTIVE','CLOSED') AND activated_at IS NULL)),
  jsonb_build_object('code','MISSING_EXPORT_PROVENANCE','count',(SELECT count(*) FROM public.order_items o JOIN public.menu_items m ON m.id=o.menu_item_id JOIN public.table_sessions s ON s.id=o.session_id
   WHERE s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') AND o.station='BAR_INSTANT' AND m.linked_ingredient_id IS NOT NULL AND o.quantity>0 AND NOT EXISTS(
    SELECT 1 FROM public.inventory_logs l WHERE l.id=o.stock_export_log_id AND l.type='EXPORT_SALE' AND l.quantity_change<0)))
 ));
END $$;

REVOKE ALL ON FUNCTION public.fn_confirm_manual_payment(text,uuid,jsonb),public.fn_get_manual_payment_operation(text,uuid),public.fn_manual_payment_status(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirm_manual_payment(text,uuid,jsonb),public.fn_get_manual_payment_operation(text,uuid),public.fn_manual_payment_status(text,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- PRD12.21: capability creation/recovery; no stock movement before manual receipt.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_takeaway_phone_pending ON public.table_sessions(customer_phone,opened_at) WHERE session_type='TAKEAWAY';
CREATE OR REPLACE FUNCTION public.fn_create_takeaway(p_token text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE scope text; claim jsonb; s public.table_sessions%ROWTYPE; line jsonb; menu public.menu_items%ROWTYPE;
 lines jsonb:='[]'; total numeric:=0; name text; phone text; result jsonb;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_operation_id IS NULL OR p_command IS NULL
  OR jsonb_typeof(p_command)<>'object' OR NOT(p_command?&ARRAY['customerName','customerPhone','lines'])
  OR p_command-ARRAY['customerName','customerPhone','lines']<>'{}'::jsonb OR octet_length(p_command::text)>32768
  OR jsonb_typeof(p_command->'customerName')<>'string' OR jsonb_typeof(p_command->'customerPhone')<>'string'
  OR jsonb_typeof(p_command->'lines')<>'array' THEN RAISE EXCEPTION 'Invalid takeaway' USING ERRCODE='22023'; END IF;
 name:=btrim(p_command->>'customerName');phone:=p_command->>'customerPhone';
 IF length(name) NOT BETWEEN 2 AND 80 OR phone!~'^0[35789][0-9]{8}$' OR jsonb_array_length(p_command->'lines') NOT BETWEEN 1 AND 30 THEN
  RAISE EXCEPTION 'Invalid recipient or lines' USING ERRCODE='22023'; END IF;
 scope:='takeaway-create:'||encode(sha256(convert_to(p_token,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('takeaway-create-quota',0));
 claim:=private.begin_operation(scope,p_operation_id,'takeaway.create',p_command,NULL,NULL);
 IF (claim->>'replay')::boolean THEN RETURN claim->'result'; END IF;
 IF EXISTS(SELECT 1 FROM public.table_sessions WHERE session_token=p_token) THEN RAISE EXCEPTION 'Capability already used' USING ERRCODE='22000'; END IF;
 IF (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND status='PENDING_PAYMENT')>=100
  OR (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND status='PENDING_PAYMENT' AND customer_phone=phone)>=3
  OR (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND customer_phone=phone AND opened_at>clock_timestamp()-interval '10 minutes')>=2
  OR (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND customer_phone=phone AND opened_at>clock_timestamp()-interval '24 hours')>=10
  OR (SELECT count(*) FROM private.operation_requests WHERE action='takeaway.create' AND completed_at>clock_timestamp()-interval '24 hours')>=100 THEN
  RAISE EXCEPTION 'Takeaway quota reached' USING ERRCODE='P1504'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_command->'lines') LOOP
  IF jsonb_typeof(line)<>'object' OR NOT(line?&ARRAY['menu_item_id','quantity','note','expected_price'])
   OR line-ARRAY['menu_item_id','quantity','note','expected_price']<>'{}'::jsonb
   OR jsonb_typeof(line->'menu_item_id')<>'string' OR (line->>'menu_item_id')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR jsonb_typeof(line->'quantity')<>'number' OR jsonb_typeof(line->'expected_price')<>'number' OR jsonb_typeof(line->'note')<>'string'
   OR length(line->>'note')>500 THEN RAISE EXCEPTION 'Invalid takeaway line' USING ERRCODE='22023'; END IF;
  IF (line->>'quantity')::numeric NOT BETWEEN 1 AND 99 OR (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)
   OR (line->>'expected_price')::numeric NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Invalid line amount' USING ERRCODE='22023'; END IF;
  lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',(line->>'menu_item_id')::uuid,'quantity',(line->>'quantity')::int,'expected_price',(line->>'expected_price')::numeric,'note',btrim(line->>'note')));
 END LOOP;
 PERFORM id FROM public.menu_items WHERE id IN(SELECT (value->>'menu_item_id')::uuid FROM jsonb_array_elements(lines)) ORDER BY id FOR SHARE;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  SELECT * INTO menu FROM public.menu_items WHERE id=(line->>'menu_item_id')::uuid;
  IF NOT FOUND OR NOT menu.is_available THEN RAISE EXCEPTION 'Menu unavailable' USING ERRCODE='P1002'; END IF;
  IF menu.price<>(line->>'expected_price')::numeric THEN RAISE EXCEPTION 'Price changed' USING ERRCODE='P1003'; END IF;
  IF menu.linked_ingredient_id IS NOT NULL AND (menu.category='FOOD' OR menu.station<>'BAR_INSTANT') THEN RAISE EXCEPTION 'Invalid stock mapping' USING ERRCODE='P1005'; END IF;
  total:=total+menu.price*(line->>'quantity')::int;
 END LOOP;
 IF NOT(total>0 AND total<=1000000000000000) THEN RAISE EXCEPTION 'Invalid total' USING ERRCODE='22023'; END IF;
 INSERT INTO public.table_sessions(session_token,session_type,status,customer_name,customer_phone,payment_code,total_amount)
 VALUES(p_token,'TAKEAWAY','PENDING_PAYMENT',name,phone,'NU'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,18)),total) RETURNING * INTO s;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  SELECT * INTO STRICT menu FROM public.menu_items WHERE id=(line->>'menu_item_id')::uuid;
  INSERT INTO public.order_items(session_id,menu_item_id,quantity,note,station,status,unit_price,unit_cost_price)
  VALUES(s.id,menu.id,(line->>'quantity')::int,nullif(line->>'note',''),menu.station,
   CASE WHEN menu.station='BAR_INSTANT' THEN 'READY' ELSE 'QUEUED' END,menu.price,menu.cost_price);
 END LOOP;
 result:=jsonb_build_object('operationId',p_operation_id,'sessionId',s.id,'paymentCode',s.payment_code,'totalAmount',total,'openedAt',s.opened_at,'status','PENDING_PAYMENT');
 RETURN private.complete_operation(scope,p_operation_id,result);
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_takeaway_create(p_token text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_operation_id IS NULL THEN RAISE EXCEPTION 'Invalid capability' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('takeaway-create-quota',0));
 SELECT op.result INTO result FROM private.operation_requests op WHERE op.scope_key='takeaway-create:'||encode(sha256(convert_to(p_token,'UTF8')),'hex') AND op.operation_id=p_operation_id AND op.action='takeaway.create';
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_takeaway_snapshot(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.table_sessions%ROWTYPE;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid capability' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM public.table_sessions WHERE session_token=p_token AND session_type='TAKEAWAY';
 IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('sessionId',s.id,'status',s.status,'paymentCode',s.payment_code,'totalAmount',s.total_amount,'openedAt',s.opened_at,'activatedAt',s.activated_at,'closedAt',s.closed_at,
  'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'menuItemId',o.menu_item_id,'name',m.name,'quantity',o.quantity,'unitPrice',o.unit_price,'note',o.note,'station',o.station,'status',o.status) ORDER BY o.created_at,o.id),'[]'::jsonb) FROM public.order_items o JOIN public.menu_items m ON m.id=o.menu_item_id WHERE o.session_id=s.id));
END $$;

CREATE OR REPLACE FUNCTION public.fn_pickup_takeaway(p_actor_id text,p_operation_id uuid,p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE s public.table_sessions%ROWTYPE; claim jsonb; stamp timestamptz; scope text:='takeaway-pickup:'||p_actor_id; result jsonb;
BEGIN
 SELECT * INTO s FROM public.table_sessions WHERE id=p_session_id AND session_type='TAKEAWAY' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Takeaway missing' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope||':'||p_operation_id::text,0));
 claim:=private.begin_operation(scope,p_operation_id,'takeaway.pickup',jsonb_build_object('sessionId',p_session_id),s.id,p_actor_id);
 IF (claim->>'replay')::boolean THEN RETURN claim->'result'; END IF;
 IF s.status<>'ACTIVE' OR s.activated_at IS NULL OR NOT EXISTS(SELECT 1 FROM private.operation_requests WHERE session_id=s.id AND action='manual.payment.confirm' AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Not paid active order' USING ERRCODE='P1501'; END IF;
 PERFORM id FROM public.order_items WHERE session_id=s.id ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status IN ('READY','SERVED'))
  OR EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status NOT IN ('READY','SERVED','CANCELLED')) THEN RAISE EXCEPTION 'Order not ready' USING ERRCODE='P1305'; END IF;
 stamp:=clock_timestamp();
 UPDATE public.order_items SET status='SERVED',served_at=stamp,served_by_staff_id=p_actor_id WHERE session_id=s.id AND quantity>0 AND status='READY';
 UPDATE public.table_sessions SET status='CLOSED',closed_at=stamp WHERE id=s.id;
 result:=jsonb_build_object('operationId',p_operation_id,'sessionId',s.id,'closedAt',stamp,'handedOverBy',p_actor_id);
 RETURN private.complete_operation(scope,p_operation_id,result);
END $$;
CREATE OR REPLACE FUNCTION public.fn_get_takeaway_pickup(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 SELECT op.result INTO result FROM private.operation_requests op WHERE op.scope_key='takeaway-pickup:'||p_actor_id AND op.operation_id=p_operation_id AND op.action='takeaway.pickup';
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.fn_create_takeaway(text,uuid,jsonb),public.fn_get_takeaway_create(text,uuid),public.fn_get_takeaway_snapshot(text),public.fn_pickup_takeaway(text,uuid,uuid),public.fn_get_takeaway_pickup(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_takeaway(text,uuid,jsonb),public.fn_get_takeaway_create(text,uuid),public.fn_get_takeaway_snapshot(text),public.fn_pickup_takeaway(text,uuid,uuid),public.fn_get_takeaway_pickup(text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.fn_takeaway_pickup_list(p_actor_id text,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin')) THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO rows FROM (
  SELECT s.id AS "sessionId",s.payment_code AS "paymentCode",s.customer_name AS "customerName",s.total_amount AS "totalAmount"
  FROM public.table_sessions s WHERE s.session_type='TAKEAWAY' AND s.status='ACTIVE' AND s.activated_at IS NOT NULL
   AND EXISTS(SELECT 1 FROM private.operation_requests WHERE session_id=s.id AND action='manual.payment.confirm' AND completed_at IS NOT NULL)
   AND EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status IN ('READY','SERVED'))
   AND NOT EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status NOT IN ('READY','SERVED','CANCELLED'))
  ORDER BY s.activated_at,s.id LIMIT 26 OFFSET (p_page-1)*25
 ) row;
 RETURN jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(rows) WITH ORDINALITY a(value,n) WHERE n<=25),'hasMore',jsonb_array_length(rows)>25);
END $$;
REVOKE ALL ON FUNCTION public.fn_takeaway_pickup_list(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_takeaway_pickup_list(text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- M-05 request budgets (PRD 12.22). Expiring counters, never payment audit.
BEGIN;
CREATE TABLE IF NOT EXISTS private.request_limits (
 scope_key text NOT NULL CHECK(scope_key='global:takeaway' OR scope_key ~ '^[a-f0-9]{64}$'),
 window_seconds integer NOT NULL CHECK(window_seconds IN (60,3600)),
 window_start timestamptz NOT NULL,
 hits integer NOT NULL CHECK(hits BETWEEN 1 AND 100001),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(scope_key,window_seconds,window_start),
 CHECK(expires_at=window_start+make_interval(secs=>window_seconds))
);
CREATE INDEX IF NOT EXISTS idx_request_limits_expiry ON private.request_limits(expires_at);
ALTER TABLE private.request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.request_limits FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_takeaway_request_gate(
 p_fingerprint text,p_network_minute integer DEFAULT 10,p_network_hour integer DEFAULT 120,
 p_global_minute integer DEFAULT 60,p_global_hour integer DEFAULT 600
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE
 v_now timestamptz;v_start timestamptz;v_end timestamptz;v_hits integer;i integer;
 v_scopes text[];v_seconds integer[]:=ARRAY[60,3600,60,3600];v_limits integer[];
BEGIN
 IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
  OR p_network_minute IS NULL OR p_network_minute NOT BETWEEN 1 AND 100000
  OR p_network_hour IS NULL OR p_network_hour NOT BETWEEN 1 AND 100000
  OR p_global_minute IS NULL OR p_global_minute NOT BETWEEN 1 AND 100000
  OR p_global_hour IS NULL OR p_global_hour NOT BETWEEN 1 AND 100000 THEN
  RAISE EXCEPTION 'Invalid request limit configuration' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('123dzo:takeaway-request-budget',0));
 v_now:=clock_timestamp();
 WITH expired AS (SELECT ctid FROM private.request_limits WHERE expires_at<=v_now ORDER BY expires_at LIMIT 200)
 DELETE FROM private.request_limits WHERE ctid IN (SELECT ctid FROM expired);
 v_scopes:=ARRAY['global:takeaway','global:takeaway',p_fingerprint,p_fingerprint];
 v_limits:=ARRAY[p_global_minute,p_global_hour,p_network_minute,p_network_hour];
 FOR i IN 1..4 LOOP
  v_start:=date_bin(make_interval(secs=>v_seconds[i]),v_now,'1970-01-01 00:00:00+00'::timestamptz);
  v_end:=v_start+make_interval(secs=>v_seconds[i]);
  INSERT INTO private.request_limits AS budget(scope_key,window_seconds,window_start,hits,expires_at)
   VALUES(v_scopes[i],v_seconds[i],v_start,1,v_end)
   ON CONFLICT(scope_key,window_seconds,window_start) DO UPDATE SET hits=least(budget.hits+1,100001)
   RETURNING hits INTO v_hits;
  IF v_hits>v_limits[i] THEN
   RETURN jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch FROM v_end-v_now))::integer));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('allowed',true,'retryAfter',0);
END $$;
REVOKE ALL ON FUNCTION public.fn_takeaway_request_gate(text,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_takeaway_request_gate(text,integer,integer,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
