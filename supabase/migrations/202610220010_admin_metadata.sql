BEGIN;
-- Preserve references instead of cascading away tables or clearing bill/staff routing.
ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_zone_id_fkey;
ALTER TABLE public.tables ADD CONSTRAINT tables_zone_id_fkey FOREIGN KEY(zone_id) REFERENCES public.zones(id) ON DELETE RESTRICT;
ALTER TABLE public.staff_profiles DROP CONSTRAINT IF EXISTS staff_profiles_assigned_zone_id_fkey;
ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_profiles_assigned_zone_id_fkey FOREIGN KEY(assigned_zone_id) REFERENCES public.zones(id) ON DELETE RESTRICT;
ALTER TABLE public.table_sessions DROP CONSTRAINT IF EXISTS table_sessions_table_id_fkey;
ALTER TABLE public.table_sessions ADD CONSTRAINT table_sessions_table_id_fkey FOREIGN KEY(table_id) REFERENCES public.tables(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.assert_metadata_fields(p_resource text,p_item jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_keys text[]; v_number numeric;
BEGIN
    IF p_item IS NULL OR jsonb_typeof(p_item)<>'object' THEN RAISE EXCEPTION 'Invalid metadata' USING ERRCODE='22023'; END IF;
    v_keys:=CASE p_resource WHEN 'INGREDIENT' THEN ARRAY['min_threshold','name','unit'] WHEN 'ZONE' THEN ARRAY['name'] WHEN 'TABLE' THEN ARRAY['table_number','zone_id'] END;
    IF v_keys IS NULL OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_item) AS k) IS DISTINCT FROM v_keys THEN
        RAISE EXCEPTION 'Invalid metadata fields' USING ERRCODE='22023';
    END IF;
    IF p_resource='TABLE' THEN
        IF jsonb_typeof(p_item->'table_number')<>'string' OR length(p_item->>'table_number') NOT BETWEEN 1 AND 120 OR btrim(p_item->>'table_number')=''
           OR jsonb_typeof(p_item->'zone_id')<>'string' OR p_item->>'zone_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
            RAISE EXCEPTION 'Invalid table' USING ERRCODE='22023';
        END IF;
    ELSE
        IF jsonb_typeof(p_item->'name')<>'string' OR length(p_item->>'name') NOT BETWEEN 1 AND 120 OR btrim(p_item->>'name')='' THEN
            RAISE EXCEPTION 'Invalid name' USING ERRCODE='22023';
        END IF;
        IF p_resource='INGREDIENT' THEN
            IF jsonb_typeof(p_item->'unit')<>'string' OR length(p_item->>'unit') NOT BETWEEN 1 AND 30 OR btrim(p_item->>'unit')=''
               OR jsonb_typeof(p_item->'min_threshold')<>'number' THEN RAISE EXCEPTION 'Invalid ingredient' USING ERRCODE='22023'; END IF;
            v_number:=(p_item->>'min_threshold')::numeric;
            IF NOT(v_number>=0 AND v_number<=1e12 AND v_number=round(v_number,3)) THEN RAISE EXCEPTION 'Invalid threshold' USING ERRCODE='22023'; END IF;
        END IF;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_metadata_action(p_actor_id text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_resource text; v_action text; v_id uuid; v_item jsonb; v_expected jsonb; v_before jsonb;
    v_scope text:='metadata:'||p_actor_id; v_claim jsonb; v_exists boolean;
    v_ingredient public.ingredients%ROWTYPE; v_zone public.zones%ROWTYPE; v_table public.tables%ROWTYPE;
BEGIN
    IF p_operation_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>8192 THEN
        RAISE EXCEPTION 'Invalid metadata command' USING ERRCODE='22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_command) AS k) IS DISTINCT FROM ARRAY['action','expected','id','item','resource']::text[]
       OR jsonb_typeof(p_command->'resource')<>'string' OR p_command->>'resource' NOT IN ('INGREDIENT','ZONE','TABLE')
       OR jsonb_typeof(p_command->'action')<>'string' OR p_command->>'action' NOT IN ('CREATE','UPDATE','DELETE')
       OR jsonb_typeof(p_command->'id')<>'string' OR p_command->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
        RAISE EXCEPTION 'Invalid metadata command fields' USING ERRCODE='22023';
    END IF;
    v_resource:=p_command->>'resource'; v_action:=p_command->>'action'; v_id:=(p_command->>'id')::uuid;
    v_item:=p_command->'item'; v_expected:=p_command->'expected';
    IF v_resource='INGREDIENT' AND v_action='DELETE' THEN RAISE EXCEPTION 'Ingredient deletion unsupported' USING ERRCODE='22023'; END IF;
    IF v_action='CREATE' THEN
        IF v_expected IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Invalid create expectation' USING ERRCODE='22023'; END IF;
    ELSE PERFORM private.assert_metadata_fields(v_resource,v_expected); END IF;
    IF v_action='DELETE' THEN
        IF v_item IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Invalid delete fields' USING ERRCODE='22023'; END IF;
    ELSE PERFORM private.assert_metadata_fields(v_resource,v_item); END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    v_claim:=private.begin_operation(v_scope,p_operation_id,'metadata.action',p_command,NULL,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    IF v_resource='INGREDIENT' THEN
        SELECT * INTO v_ingredient FROM public.ingredients WHERE id=v_id FOR UPDATE; v_exists:=FOUND;
        v_before:=jsonb_build_object('name',v_ingredient.name,'unit',v_ingredient.unit,'min_threshold',v_ingredient.min_threshold);
    ELSIF v_resource='ZONE' THEN
        SELECT * INTO v_zone FROM public.zones WHERE id=v_id FOR UPDATE; v_exists:=FOUND;
        v_before:=jsonb_build_object('name',v_zone.name);
    ELSE
        SELECT * INTO v_table FROM public.tables WHERE id=v_id FOR UPDATE; v_exists:=FOUND;
        v_before:=jsonb_build_object('table_number',v_table.table_number,'zone_id',v_table.zone_id);
    END IF;
    IF v_action='CREATE' THEN
        IF v_exists THEN RAISE EXCEPTION 'Entity already exists' USING ERRCODE='23505'; END IF;
    ELSE
        IF NOT v_exists THEN RAISE EXCEPTION 'Entity missing' USING ERRCODE='P1601'; END IF;
        IF v_before IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Metadata changed' USING ERRCODE='P1602'; END IF;
    END IF;
    IF v_resource='INGREDIENT' THEN
        IF v_action='CREATE' THEN
            INSERT INTO public.ingredients(id,name,unit,min_threshold,stock_quantity,unit_cost)
            VALUES(v_id,v_item->>'name',v_item->>'unit',(v_item->>'min_threshold')::numeric,0,0);
        ELSE
            IF v_ingredient.unit IS DISTINCT FROM v_item->>'unit' AND (v_ingredient.stock_quantity<>0 OR
               EXISTS(SELECT 1 FROM public.inventory_logs WHERE ingredient_id=v_id) OR EXISTS(SELECT 1 FROM public.menu_items WHERE linked_ingredient_id=v_id)) THEN
                RAISE EXCEPTION 'Unit has stock/history/mapping' USING ERRCODE='P1603';
            END IF;
            UPDATE public.ingredients SET name=v_item->>'name',unit=v_item->>'unit',min_threshold=(v_item->>'min_threshold')::numeric WHERE id=v_id;
        END IF;
    ELSIF v_resource='ZONE' THEN
        IF v_action='CREATE' THEN INSERT INTO public.zones(id,name) VALUES(v_id,v_item->>'name');
        ELSIF v_action='UPDATE' THEN UPDATE public.zones SET name=v_item->>'name' WHERE id=v_id;
        ELSE DELETE FROM public.zones WHERE id=v_id; END IF;
    ELSE
        IF v_action<>'CREATE' AND (v_table.status<>'AVAILABLE' OR v_table.current_session_id IS NOT NULL OR
           EXISTS(SELECT 1 FROM public.table_sessions WHERE table_id=v_id AND status<>'CLOSED')) THEN
            RAISE EXCEPTION 'Table is in use' USING ERRCODE='P1604';
        END IF;
        IF v_action='CREATE' THEN
            INSERT INTO public.tables(id,table_number,zone_id,status,current_session_id) VALUES(v_id,v_item->>'table_number',(v_item->>'zone_id')::uuid,'AVAILABLE',NULL);
        ELSIF v_action='UPDATE' THEN
            UPDATE public.tables SET table_number=v_item->>'table_number',zone_id=(v_item->>'zone_id')::uuid WHERE id=v_id;
        ELSE DELETE FROM public.tables WHERE id=v_id; END IF;
    END IF;
    RETURN private.complete_operation(v_scope,p_operation_id,jsonb_build_object('operationId',p_operation_id,'resource',v_resource,'action',v_action,'entityId',v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_admin_metadata_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_scope text:='metadata:'||p_actor_id; v_result jsonb;
BEGIN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    SELECT result INTO v_result FROM private.operation_requests WHERE scope_key=v_scope AND operation_id=p_operation_id AND action='metadata.action';
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_metadata_fields(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_admin_metadata_action(text,uuid,jsonb),public.fn_get_admin_metadata_operation(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_metadata_action(text,uuid,jsonb),public.fn_get_admin_metadata_operation(text,uuid) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.ingredients,public.zones,public.tables FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,name,unit,stock_quantity,min_threshold,unit_cost),UPDATE(id,name,unit,stock_quantity,min_threshold,unit_cost) ON public.ingredients FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,name,created_at),UPDATE(id,name,created_at) ON public.zones FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,table_number,zone_id,status,current_session_id),UPDATE(id,table_number,zone_id,status,current_session_id) ON public.tables FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
