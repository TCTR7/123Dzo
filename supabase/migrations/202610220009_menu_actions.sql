BEGIN;
CREATE OR REPLACE FUNCTION private.assert_menu_fields(p_item jsonb)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v_field text; v_price numeric;
BEGIN
    IF p_item IS NULL OR jsonb_typeof(p_item)<>'object' THEN RAISE EXCEPTION 'Invalid menu fields' USING ERRCODE='22023'; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_item) AS k) IS DISTINCT FROM
       ARRAY['category','cost_price','image_url','is_available','linked_ingredient_id','name','prep_time_minutes','price','station']::text[]
       OR jsonb_typeof(p_item->'name')<>'string' OR length(p_item->>'name')>120 OR btrim(p_item->>'name')=''
       OR jsonb_typeof(p_item->'category')<>'string' OR p_item->>'category' NOT IN ('FOOD','BEER','DRINK','OTHER')
       OR jsonb_typeof(p_item->'station')<>'string' OR p_item->>'station' NOT IN ('KITCHEN','BAR_INSTANT')
       OR jsonb_typeof(p_item->'is_available')<>'boolean'
       OR jsonb_typeof(p_item->'prep_time_minutes')<>'number'
       OR jsonb_typeof(p_item->'image_url') NOT IN ('string','null')
       OR jsonb_typeof(p_item->'linked_ingredient_id') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'Invalid menu fields' USING ERRCODE='22023';
    END IF;
    FOREACH v_field IN ARRAY ARRAY['price','cost_price'] LOOP
        IF jsonb_typeof(p_item->v_field)<>'number' THEN RAISE EXCEPTION 'Invalid money' USING ERRCODE='22023'; END IF;
        v_price:=(p_item->>v_field)::numeric;
        IF NOT(v_price>=0 AND v_price<=1e12 AND v_price=round(v_price,2)) THEN RAISE EXCEPTION 'Invalid money' USING ERRCODE='22023'; END IF;
    END LOOP;
    v_price:=(p_item->>'prep_time_minutes')::numeric;
    IF v_price NOT BETWEEN 0 AND 1440 OR v_price<>trunc(v_price)
       OR (p_item->>'image_url' IS NOT NULL AND (length(p_item->>'image_url')>2048 OR p_item->>'image_url' !~* '^https://[^[:space:]]+$')) THEN
        RAISE EXCEPTION 'Invalid menu fields' USING ERRCODE='22023';
    END IF;
    IF p_item->>'linked_ingredient_id' IS NOT NULL THEN
        IF p_item->>'linked_ingredient_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
           OR p_item->>'category'='FOOD' OR p_item->>'station'<>'BAR_INSTANT' THEN
            RAISE EXCEPTION 'Invalid stock mapping' USING ERRCODE='22023';
        END IF;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_menu_action(p_actor_id text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
    v_action text; v_id uuid; v_role text; v_item jsonb; v_expected jsonb; v_before jsonb;
    v_scope text:='menu-action:'||p_actor_id; v_claim jsonb; v_row public.menu_items%ROWTYPE;
BEGIN
    IF p_operation_id IS NULL OR p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>16384 THEN
        RAISE EXCEPTION 'Invalid menu command' USING ERRCODE='22023';
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_command) AS k) IS DISTINCT FROM ARRAY['action','expected','id','item']::text[]
       OR jsonb_typeof(p_command->'action')<>'string' OR p_command->>'action' NOT IN ('CREATE','UPDATE','DELETE','AVAILABILITY')
       OR jsonb_typeof(p_command->'id')<>'string' OR p_command->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
        RAISE EXCEPTION 'Invalid menu command' USING ERRCODE='22023';
    END IF;
    v_action:=p_command->>'action'; v_id:=(p_command->>'id')::uuid; v_item:=p_command->'item'; v_expected:=p_command->'expected';
    IF v_action='AVAILABILITY' THEN
        IF jsonb_typeof(v_item)<>'object' OR jsonb_typeof(v_expected)<>'object' THEN RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023'; END IF;
        IF v_item - 'is_available'<>'{}'::jsonb OR jsonb_typeof(v_item->'is_available') IS DISTINCT FROM 'boolean'
           OR v_expected - 'is_available'<>'{}'::jsonb OR jsonb_typeof(v_expected->'is_available') IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'Invalid availability' USING ERRCODE='22023';
        END IF;
    ELSE
        IF v_action='CREATE' THEN
            IF v_expected<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid create' USING ERRCODE='22023'; END IF;
        ELSE PERFORM private.assert_menu_fields(v_expected); END IF;
        IF v_action='DELETE' THEN
            IF v_item<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid delete' USING ERRCODE='22023'; END IF;
        ELSE PERFORM private.assert_menu_fields(v_item); END IF;
    END IF;
    SELECT role INTO v_role FROM public.staff_profiles WHERE id=p_actor_id AND is_active FOR SHARE;
    IF NOT FOUND OR v_role NOT IN ('admin','kitchen') OR (v_action<>'AVAILABILITY' AND v_role<>'admin') THEN
        RAISE EXCEPTION 'Menu action forbidden' USING ERRCODE='42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    v_claim:=private.begin_operation(v_scope,p_operation_id,'menu.action',p_command||jsonb_build_object('id',v_id),NULL,p_actor_id);
    IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
    SELECT * INTO v_row FROM public.menu_items WHERE id=v_id FOR UPDATE;
    IF v_action='CREATE' THEN
        IF FOUND THEN RAISE EXCEPTION 'Menu ID exists' USING ERRCODE='23505'; END IF;
        INSERT INTO public.menu_items(id,name,category,station,price,cost_price,prep_time_minutes,image_url,is_available,linked_ingredient_id)
        VALUES(v_id,v_item->>'name',v_item->>'category',v_item->>'station',(v_item->>'price')::numeric,(v_item->>'cost_price')::numeric,
            (v_item->>'prep_time_minutes')::numeric::int,v_item->>'image_url',(v_item->>'is_available')::boolean,(v_item->>'linked_ingredient_id')::uuid);
    ELSE
        IF NOT FOUND THEN RAISE EXCEPTION 'Menu missing' USING ERRCODE='P1501'; END IF;
        v_before:=to_jsonb(v_row)-'id';
        IF (CASE WHEN v_action='AVAILABILITY' THEN jsonb_build_object('is_available',v_row.is_available) ELSE v_before END) IS DISTINCT FROM v_expected THEN
            RAISE EXCEPTION 'Menu changed' USING ERRCODE='P1502';
        END IF;
        IF v_action='AVAILABILITY' THEN
            UPDATE public.menu_items SET is_available=(v_item->>'is_available')::boolean WHERE id=v_id;
        ELSE
            IF EXISTS(SELECT 1 FROM public.order_items WHERE menu_item_id=v_id) AND
               (v_action='DELETE' OR v_before->'category' IS DISTINCT FROM v_item->'category'
                OR v_before->'station' IS DISTINCT FROM v_item->'station' OR v_before->'linked_ingredient_id' IS DISTINCT FROM v_item->'linked_ingredient_id') THEN
                RAISE EXCEPTION 'Menu history must be preserved' USING ERRCODE='P1503';
            END IF;
            IF v_action='DELETE' THEN DELETE FROM public.menu_items WHERE id=v_id;
            ELSE
                UPDATE public.menu_items SET name=v_item->>'name',category=v_item->>'category',station=v_item->>'station',
                    price=(v_item->>'price')::numeric,cost_price=(v_item->>'cost_price')::numeric,
                    prep_time_minutes=(v_item->>'prep_time_minutes')::numeric::int,image_url=v_item->>'image_url',
                    is_available=(v_item->>'is_available')::boolean,linked_ingredient_id=(v_item->>'linked_ingredient_id')::uuid WHERE id=v_id;
            END IF;
        END IF;
    END IF;
    RETURN private.complete_operation(v_scope,p_operation_id,jsonb_build_object('operationId',p_operation_id,'action',v_action,'menuItemId',v_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_menu_action_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_result jsonb; v_role text; v_scope text:='menu-action:'||p_actor_id;
BEGIN
    IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
    SELECT role INTO v_role FROM public.staff_profiles WHERE id=p_actor_id AND is_active FOR SHARE;
    IF NOT FOUND OR v_role NOT IN ('admin','kitchen') THEN RAISE EXCEPTION 'Menu access required' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_operation_id::text,0));
    SELECT result INTO v_result FROM private.operation_requests WHERE scope_key=v_scope AND operation_id=p_operation_id AND action='menu.action';
    IF v_result IS NOT NULL AND v_result->>'action'<>'AVAILABILITY' AND v_role<>'admin' THEN
        RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_menu_fields(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_menu_action(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_get_menu_action_operation(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_menu_action(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_get_menu_action_operation(text,uuid) TO service_role;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.menu_items FROM PUBLIC,anon,authenticated;
REVOKE INSERT(id,name,category,station,price,cost_price,prep_time_minutes,image_url,is_available,linked_ingredient_id),
    UPDATE(id,name,category,station,price,cost_price,prep_time_minutes,image_url,is_available,linked_ingredient_id) ON public.menu_items FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='menu_items') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
    END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
