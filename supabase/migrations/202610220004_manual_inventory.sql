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
