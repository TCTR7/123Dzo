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
