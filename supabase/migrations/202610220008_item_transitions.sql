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
