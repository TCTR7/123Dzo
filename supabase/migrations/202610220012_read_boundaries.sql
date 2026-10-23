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
