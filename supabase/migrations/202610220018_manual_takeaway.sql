-- PRD12.21: capability creation/recovery; no stock movement before manual receipt.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_takeaway_phone_pending ON public.table_sessions(customer_phone,opened_at) WHERE session_type='TAKEAWAY';
CREATE OR REPLACE FUNCTION public.fn_create_takeaway(p_token text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE scope text; claim jsonb; s public.table_sessions%ROWTYPE; line jsonb; menu public.menu_items%ROWTYPE;
 lines jsonb:='[]'; total numeric:=0; name text; phone text; result jsonb;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_operation_id IS NULL OR p_command IS NULL
  OR jsonb_typeof(p_command)<>'object' OR NOT(p_command?&ARRAY['customerName','customerPhone','lines'])
  OR p_command-ARRAY['customerName','customerPhone','lines']<>'{}'::jsonb OR octet_length(p_command::text)>32768
  OR jsonb_typeof(p_command->'customerName')<>'string' OR jsonb_typeof(p_command->'customerPhone')<>'string'
  OR jsonb_typeof(p_command->'lines')<>'array' THEN RAISE EXCEPTION 'Invalid takeaway' USING ERRCODE='22023'; END IF;
 name:=btrim(p_command->>'customerName');phone:=p_command->>'customerPhone';
 IF length(name) NOT BETWEEN 2 AND 80 OR phone!~'^0[35789][0-9]{8}$' OR jsonb_array_length(p_command->'lines') NOT BETWEEN 1 AND 30 THEN
  RAISE EXCEPTION 'Invalid recipient or lines' USING ERRCODE='22023'; END IF;
 scope:='takeaway-create:'||encode(sha256(convert_to(p_token,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('takeaway-create-quota',0));
 claim:=private.begin_operation(scope,p_operation_id,'takeaway.create',p_command,NULL,NULL);
 IF (claim->>'replay')::boolean THEN RETURN claim->'result'; END IF;
 IF EXISTS(SELECT 1 FROM public.table_sessions WHERE session_token=p_token) THEN RAISE EXCEPTION 'Capability already used' USING ERRCODE='22000'; END IF;
 IF (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND status='PENDING_PAYMENT')>=100
  OR (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND status='PENDING_PAYMENT' AND customer_phone=phone)>=3
  OR (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND customer_phone=phone AND opened_at>clock_timestamp()-interval '10 minutes')>=2
  OR (SELECT count(*) FROM public.table_sessions WHERE session_type='TAKEAWAY' AND customer_phone=phone AND opened_at>clock_timestamp()-interval '24 hours')>=10
  OR (SELECT count(*) FROM private.operation_requests WHERE action='takeaway.create' AND completed_at>clock_timestamp()-interval '24 hours')>=100 THEN
  RAISE EXCEPTION 'Takeaway quota reached' USING ERRCODE='P1504'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_command->'lines') LOOP
  IF jsonb_typeof(line)<>'object' OR NOT(line?&ARRAY['menu_item_id','quantity','note','expected_price'])
   OR line-ARRAY['menu_item_id','quantity','note','expected_price']<>'{}'::jsonb
   OR jsonb_typeof(line->'menu_item_id')<>'string' OR (line->>'menu_item_id')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR jsonb_typeof(line->'quantity')<>'number' OR jsonb_typeof(line->'expected_price')<>'number' OR jsonb_typeof(line->'note')<>'string'
   OR length(line->>'note')>500 THEN RAISE EXCEPTION 'Invalid takeaway line' USING ERRCODE='22023'; END IF;
  IF (line->>'quantity')::numeric NOT BETWEEN 1 AND 99 OR (line->>'quantity')::numeric<>trunc((line->>'quantity')::numeric)
   OR (line->>'expected_price')::numeric NOT BETWEEN 0 AND 1000000000 THEN RAISE EXCEPTION 'Invalid line amount' USING ERRCODE='22023'; END IF;
  lines:=lines||jsonb_build_array(jsonb_build_object('menu_item_id',(line->>'menu_item_id')::uuid,'quantity',(line->>'quantity')::int,'expected_price',(line->>'expected_price')::numeric,'note',btrim(line->>'note')));
 END LOOP;
 PERFORM id FROM public.menu_items WHERE id IN(SELECT (value->>'menu_item_id')::uuid FROM jsonb_array_elements(lines)) ORDER BY id FOR SHARE;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  SELECT * INTO menu FROM public.menu_items WHERE id=(line->>'menu_item_id')::uuid;
  IF NOT FOUND OR NOT menu.is_available THEN RAISE EXCEPTION 'Menu unavailable' USING ERRCODE='P1002'; END IF;
  IF menu.price<>(line->>'expected_price')::numeric THEN RAISE EXCEPTION 'Price changed' USING ERRCODE='P1003'; END IF;
  IF menu.linked_ingredient_id IS NOT NULL AND (menu.category='FOOD' OR menu.station<>'BAR_INSTANT') THEN RAISE EXCEPTION 'Invalid stock mapping' USING ERRCODE='P1005'; END IF;
  total:=total+menu.price*(line->>'quantity')::int;
 END LOOP;
 IF NOT(total>0 AND total<=1000000000000000) THEN RAISE EXCEPTION 'Invalid total' USING ERRCODE='22023'; END IF;
 INSERT INTO public.table_sessions(session_token,session_type,status,customer_name,customer_phone,payment_code,total_amount)
 VALUES(p_token,'TAKEAWAY','PENDING_PAYMENT',name,phone,'NU'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,18)),total) RETURNING * INTO s;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  SELECT * INTO STRICT menu FROM public.menu_items WHERE id=(line->>'menu_item_id')::uuid;
  INSERT INTO public.order_items(session_id,menu_item_id,quantity,note,station,status,unit_price,unit_cost_price)
  VALUES(s.id,menu.id,(line->>'quantity')::int,nullif(line->>'note',''),menu.station,
   CASE WHEN menu.station='BAR_INSTANT' THEN 'READY' ELSE 'QUEUED' END,menu.price,menu.cost_price);
 END LOOP;
 result:=jsonb_build_object('operationId',p_operation_id,'sessionId',s.id,'paymentCode',s.payment_code,'totalAmount',total,'openedAt',s.opened_at,'status','PENDING_PAYMENT');
 RETURN private.complete_operation(scope,p_operation_id,result);
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_takeaway_create(p_token text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE result jsonb;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' OR p_operation_id IS NULL THEN RAISE EXCEPTION 'Invalid capability' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('takeaway-create-quota',0));
 SELECT op.result INTO result FROM private.operation_requests op WHERE op.scope_key='takeaway-create:'||encode(sha256(convert_to(p_token,'UTF8')),'hex') AND op.operation_id=p_operation_id AND op.action='takeaway.create';
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_takeaway_snapshot(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public.table_sessions%ROWTYPE;
BEGIN
 IF p_token IS NULL OR p_token!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid capability' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM public.table_sessions WHERE session_token=p_token AND session_type='TAKEAWAY';
 IF NOT FOUND THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('sessionId',s.id,'status',s.status,'paymentCode',s.payment_code,'totalAmount',s.total_amount,'openedAt',s.opened_at,'activatedAt',s.activated_at,'closedAt',s.closed_at,
  'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'menuItemId',o.menu_item_id,'name',m.name,'quantity',o.quantity,'unitPrice',o.unit_price,'note',o.note,'station',o.station,'status',o.status) ORDER BY o.created_at,o.id),'[]'::jsonb) FROM public.order_items o JOIN public.menu_items m ON m.id=o.menu_item_id WHERE o.session_id=s.id));
END $$;

CREATE OR REPLACE FUNCTION public.fn_pickup_takeaway(p_actor_id text,p_operation_id uuid,p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE s public.table_sessions%ROWTYPE; claim jsonb; stamp timestamptz; scope text:='takeaway-pickup:'||p_actor_id; result jsonb;
BEGIN
 SELECT * INTO s FROM public.table_sessions WHERE id=p_session_id AND session_type='TAKEAWAY' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Takeaway missing' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope||':'||p_operation_id::text,0));
 claim:=private.begin_operation(scope,p_operation_id,'takeaway.pickup',jsonb_build_object('sessionId',p_session_id),s.id,p_actor_id);
 IF (claim->>'replay')::boolean THEN RETURN claim->'result'; END IF;
 IF s.status<>'ACTIVE' OR s.activated_at IS NULL OR NOT EXISTS(SELECT 1 FROM private.operation_requests WHERE session_id=s.id AND action='manual.payment.confirm' AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'Not paid active order' USING ERRCODE='P1501'; END IF;
 PERFORM id FROM public.order_items WHERE session_id=s.id ORDER BY id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status IN ('READY','SERVED'))
  OR EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status NOT IN ('READY','SERVED','CANCELLED')) THEN RAISE EXCEPTION 'Order not ready' USING ERRCODE='P1305'; END IF;
 stamp:=clock_timestamp();
 UPDATE public.order_items SET status='SERVED',served_at=stamp,served_by_staff_id=p_actor_id WHERE session_id=s.id AND quantity>0 AND status='READY';
 UPDATE public.table_sessions SET status='CLOSED',closed_at=stamp WHERE id=s.id;
 result:=jsonb_build_object('operationId',p_operation_id,'sessionId',s.id,'closedAt',stamp,'handedOverBy',p_actor_id);
 RETURN private.complete_operation(scope,p_operation_id,result);
END $$;
CREATE OR REPLACE FUNCTION public.fn_get_takeaway_pickup(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 SELECT op.result INTO result FROM private.operation_requests op WHERE op.scope_key='takeaway-pickup:'||p_actor_id AND op.operation_id=p_operation_id AND op.action='takeaway.pickup';
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.fn_create_takeaway(text,uuid,jsonb),public.fn_get_takeaway_create(text,uuid),public.fn_get_takeaway_snapshot(text),public.fn_pickup_takeaway(text,uuid,uuid),public.fn_get_takeaway_pickup(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_takeaway(text,uuid,jsonb),public.fn_get_takeaway_create(text,uuid),public.fn_get_takeaway_snapshot(text),public.fn_pickup_takeaway(text,uuid,uuid),public.fn_get_takeaway_pickup(text,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.fn_takeaway_pickup_list(p_actor_id text,p_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rows jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin')) THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO rows FROM (
  SELECT s.id AS "sessionId",s.payment_code AS "paymentCode",s.customer_name AS "customerName",s.total_amount AS "totalAmount"
  FROM public.table_sessions s WHERE s.session_type='TAKEAWAY' AND s.status='ACTIVE' AND s.activated_at IS NOT NULL
   AND EXISTS(SELECT 1 FROM private.operation_requests WHERE session_id=s.id AND action='manual.payment.confirm' AND completed_at IS NOT NULL)
   AND EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status IN ('READY','SERVED'))
   AND NOT EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND quantity>0 AND status NOT IN ('READY','SERVED','CANCELLED'))
  ORDER BY s.activated_at,s.id LIMIT 26 OFFSET (p_page-1)*25
 ) row;
 RETURN jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(rows) WITH ORDINALITY a(value,n) WHERE n<=25),'hasMore',jsonb_array_length(rows)>25);
END $$;
REVOKE ALL ON FUNCTION public.fn_takeaway_pickup_list(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_takeaway_pickup_list(text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
