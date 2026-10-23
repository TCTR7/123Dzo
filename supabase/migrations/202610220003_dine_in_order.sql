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
