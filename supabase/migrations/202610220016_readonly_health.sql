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
