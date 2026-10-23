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
    role text NOT NULL CHECK (role IN ('operator', 'admin', 'staff', 'kitchen')),
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

-- Browser access goes through authorized Next.js APIs and scoped SSE snapshots.
-- Apply this permission block to existing projects too; no tables/columns/RPCs change.
REVOKE ALL ON TABLE public.zones, public.staff_profiles, public.tables,
    public.ingredients, public.inventory_logs, public.menu_items,
    public.table_sessions, public.order_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zones, public.staff_profiles, public.tables,
    public.ingredients, public.inventory_logs, public.menu_items,
    public.table_sessions, public.order_items TO service_role;

REVOKE ALL ON TABLE public.vw_kpi_financial_summary, public.vw_kpi_peak_hours,
    public.vw_kpi_menu_analytics, public.vw_kpi_kitchen_performance,
    public.vw_kpi_waitstaff_performance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_kpi_financial_summary, public.vw_kpi_peak_hours,
    public.vw_kpi_menu_analytics, public.vw_kpi_kitchen_performance,
    public.vw_kpi_waitstaff_performance TO service_role;

REVOKE ALL ON FUNCTION public.fn_get_financial_kpi(timestamptz, timestamptz),
    public.fn_get_menu_kpi(timestamptz, timestamptz),
    public.fn_get_kitchen_kpi(timestamptz, timestamptz),
    public.fn_get_waitstaff_kpi(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_financial_kpi(timestamptz, timestamptz),
    public.fn_get_menu_kpi(timestamptz, timestamptz),
    public.fn_get_kitchen_kpi(timestamptz, timestamptz),
    public.fn_get_waitstaff_kpi(timestamptz, timestamptz) TO service_role;
