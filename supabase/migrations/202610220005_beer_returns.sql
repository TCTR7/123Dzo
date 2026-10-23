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
