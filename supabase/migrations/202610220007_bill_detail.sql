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
