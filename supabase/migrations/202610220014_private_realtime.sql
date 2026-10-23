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
