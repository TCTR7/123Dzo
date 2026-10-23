-- Manual receipts: PRD 12.20. Audit remains in the private immutable operation ledger.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_receipt_session ON private.operation_requests(session_id)
 WHERE action='manual.payment.confirm';
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_receipt_reference ON private.operation_requests((result->>'reference'))
 WHERE action='manual.payment.confirm' AND result->>'paymentMethod'='VIETQR';
CREATE INDEX IF NOT EXISTS idx_manual_receipt_history ON private.operation_requests(completed_at DESC,id DESC)
 WHERE action IN ('manual.payment.confirm','session.action');

CREATE OR REPLACE FUNCTION public.fn_confirm_manual_payment(p_actor_id text,p_operation_id uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE
 s public.table_sessions%ROWTYPE; actor public.staff_profiles%ROWTYPE;
 scope text:='manual-payment:staff:'||p_actor_id; claim jsonb; total numeric;
 ref text; method text; stamp timestamptz; stock record; export_id uuid; result jsonb;
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>4096
  OR NOT(p_command ?& ARRAY['sessionId','expectedTotal','paymentMethod','reference','confirmedReceived'])
  OR p_command-ARRAY['sessionId','expectedTotal','paymentMethod','reference','confirmedReceived']<>'{}'::jsonb
  OR jsonb_typeof(p_command->'sessionId')<>'string' OR jsonb_typeof(p_command->'expectedTotal')<>'number'
  OR jsonb_typeof(p_command->'paymentMethod')<>'string' OR jsonb_typeof(p_command->'reference')<>'string'
  OR p_command->'confirmedReceived'<>'true'::jsonb OR p_operation_id IS NULL THEN
  RAISE EXCEPTION 'Invalid payment confirmation' USING ERRCODE='22023';
 END IF;
 method:=p_command->>'paymentMethod';
 ref:=upper(regexp_replace(btrim(p_command->>'reference'),'\s+','','g'));
 IF method NOT IN ('CASH','VIETQR') OR length(p_command->>'reference')>120
  OR (method='VIETQR' AND length(ref) NOT BETWEEN 1 AND 120) OR (method='CASH' AND ref<>'')
  OR NOT((p_command->>'expectedTotal')::numeric>0 AND (p_command->>'expectedTotal')::numeric<=1000000000000000) THEN
  RAISE EXCEPTION 'Invalid amount or reference' USING ERRCODE='22023';
 END IF;
 SELECT * INTO s FROM public.table_sessions WHERE id=(p_command->>'sessionId')::uuid FOR UPDATE;
 IF NOT FOUND OR s.session_type<>'TAKEAWAY' THEN RAISE EXCEPTION 'Takeaway missing' USING ERRCODE='P0002'; END IF;
 SELECT * INTO actor FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Serving staff required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope||':'||p_operation_id::text,0));
 claim:=private.begin_operation(scope,p_operation_id,'manual.payment.confirm',p_command,s.id,p_actor_id);
 IF (claim->>'replay')::boolean THEN RETURN claim->'result'; END IF;
 IF s.status<>'PENDING_PAYMENT' OR s.activated_at IS NOT NULL THEN RAISE EXCEPTION 'Payment already handled' USING ERRCODE='P1501'; END IF;
 PERFORM id FROM public.order_items WHERE session_id=s.id ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.order_items WHERE session_id=s.id) NOT BETWEEN 1 AND 30
  OR EXISTS(SELECT 1 FROM public.order_items WHERE session_id=s.id AND (quantity NOT BETWEEN 1 AND 99
   OR cooking_started_at IS NOT NULL OR ready_at IS NOT NULL OR served_at IS NOT NULL
   OR cancelled_at IS NOT NULL OR stock_export_log_id IS NOT NULL
   OR (station='KITCHEN' AND status<>'QUEUED') OR (station='BAR_INSTANT' AND status<>'READY'))) THEN
  RAISE EXCEPTION 'Pending items need reconciliation' USING ERRCODE='P1503';
 END IF;
 SELECT sum(quantity*unit_price) INTO total FROM public.order_items WHERE session_id=s.id;
 IF total IS DISTINCT FROM s.total_amount OR total IS DISTINCT FROM (p_command->>'expectedTotal')::numeric
  OR NOT(total>0 AND total<'Infinity'::numeric) THEN RAISE EXCEPTION 'Bill changed' USING ERRCODE='P1306'; END IF;
 PERFORM m.id FROM public.menu_items m JOIN public.order_items oi ON oi.menu_item_id=m.id
  WHERE oi.session_id=s.id ORDER BY m.id FOR SHARE OF m;
 IF EXISTS(SELECT 1 FROM public.order_items oi JOIN public.menu_items m ON m.id=oi.menu_item_id
  WHERE oi.session_id=s.id AND (NOT m.is_available OR m.station<>oi.station
   OR (m.linked_ingredient_id IS NOT NULL AND (m.category='FOOD' OR m.station<>'BAR_INSTANT')))) THEN
  RAISE EXCEPTION 'Menu needs reconciliation before receipt' USING ERRCODE='P1503';
 END IF;
 FOR stock IN SELECT ing.id,ing.stock_quantity,ing.unit_cost,need.quantity FROM public.ingredients ing
  JOIN (SELECT m.linked_ingredient_id id,sum(oi.quantity) quantity FROM public.order_items oi
   JOIN public.menu_items m ON m.id=oi.menu_item_id WHERE oi.session_id=s.id AND m.linked_ingredient_id IS NOT NULL
   GROUP BY m.linked_ingredient_id) need ON need.id=ing.id ORDER BY ing.id FOR UPDATE OF ing
 LOOP
  IF stock.stock_quantity<stock.quantity THEN RAISE EXCEPTION 'Insufficient stock' USING ERRCODE='P1004'; END IF;
  UPDATE public.ingredients SET stock_quantity=stock_quantity-stock.quantity WHERE id=stock.id;
  INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost,note,created_by)
   VALUES(stock.id,'EXPORT_SALE',-stock.quantity,stock.quantity*stock.unit_cost,'Manual receipt '||p_operation_id,p_actor_id)
   RETURNING id INTO export_id;
  UPDATE public.order_items oi SET stock_export_log_id=export_id FROM public.menu_items m
   WHERE oi.session_id=s.id AND oi.menu_item_id=m.id AND m.linked_ingredient_id=stock.id;
 END LOOP;
 stamp:=clock_timestamp();
 UPDATE public.table_sessions SET status='ACTIVE',activated_at=stamp,payment_method=method,total_amount=total,assigned_staff_id=p_actor_id WHERE id=s.id;
 UPDATE public.order_items SET ready_at=stamp WHERE session_id=s.id AND station='BAR_INSTANT';
 INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload)
  SELECT 'new-item:'||id::text,s.id,id,CASE WHEN station='BAR_INSTANT' THEN 'ORDER_READY' ELSE 'KITCHEN_ORDER_CREATED' END,
   jsonb_build_object('sessionId',s.id,'orderItemId',id) FROM public.order_items WHERE session_id=s.id;
 result:=jsonb_build_object('operationId',p_operation_id,'sessionId',s.id,'amount',total,'paymentMethod',method,
  'reference',ref,'confirmedAt',stamp,'confirmedBy',actor.id,'confirmedByName',actor.full_name,'confirmedByRole',actor.role,
  'statusBefore','PENDING_PAYMENT','statusAfter','ACTIVE');
 RETURN private.complete_operation(scope,p_operation_id,result);
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid confirmation values' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION public.fn_get_manual_payment_operation(p_actor_id text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE result jsonb; scope text:='manual-payment:staff:'||p_actor_id;
BEGIN
 PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Serving staff required' USING ERRCODE='42501'; END IF;
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(scope||':'||p_operation_id::text,0));
 SELECT op.result INTO result FROM private.operation_requests op
  WHERE op.scope_key=scope AND op.operation_id=p_operation_id AND op.action='manual.payment.confirm';
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.fn_manual_payment_status(p_actor_id text,p_pending_page integer DEFAULT 1,p_history_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pending jsonb; history jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin')) THEN
  RAISE EXCEPTION 'Serving staff required' USING ERRCODE='42501'; END IF;
 IF p_pending_page IS NULL OR p_history_page IS NULL OR p_pending_page NOT BETWEEN 1 AND 10000 OR p_history_page NOT BETWEEN 1 AND 10000 THEN
  RAISE EXCEPTION 'Invalid payment page' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO pending FROM (
  SELECT id AS "sessionId",payment_code AS "paymentCode",customer_name AS "customerName",customer_phone AS "customerPhone",
   total_amount AS amount,opened_at AS "openedAt" FROM public.table_sessions
   WHERE session_type='TAKEAWAY' AND status='PENDING_PAYMENT' ORDER BY opened_at,id LIMIT 26 OFFSET (p_pending_page-1)*25
 ) row;
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO history FROM (
  SELECT op.id AS "recordId",op.operation_id AS "operationId",op.session_id AS "sessionId",
   CASE WHEN op.action='manual.payment.confirm' THEN 'CONFIRM_PAYMENT' ELSE 'CLOSE_BILL' END AS action,
   coalesce(op.result->'amount',op.result->'totalAmount') AS amount,
   coalesce(op.result->>'paymentMethod',s.payment_method) AS "paymentMethod",
   coalesce(op.result->>'reference','') AS reference,op.actor_id AS "confirmedBy",
   coalesce(op.result->>'confirmedByName',sp.full_name) AS "confirmedByName",
   coalesce(op.result->>'confirmedAt',op.completed_at::text) AS "confirmedAt"
  FROM private.operation_requests op JOIN public.staff_profiles sp ON sp.id=op.actor_id
  JOIN public.table_sessions s ON s.id=op.session_id
  WHERE op.completed_at IS NOT NULL AND (op.action='manual.payment.confirm' OR (op.action='session.action' AND op.result->>'action'='CLOSE'))
  ORDER BY op.completed_at DESC,op.id DESC LIMIT 26 OFFSET (p_history_page-1)*25
 ) row;
 RETURN jsonb_build_object('pending',(SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(pending) WITH ORDINALITY a(value,n) WHERE n<=25),
  'history',(SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(history) WITH ORDINALITY a(value,n) WHERE n<=25),
  'pendingHasMore',jsonb_array_length(pending)>25,'historyHasMore',jsonb_array_length(history)>25);
END $$;
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
  jsonb_build_object('code','MISSING_EXPORT_PROVENANCE','count',(SELECT count(*) FROM public.order_items o JOIN public.menu_items m ON m.id=o.menu_item_id JOIN public.table_sessions s ON s.id=o.session_id
   WHERE s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') AND o.station='BAR_INSTANT' AND m.linked_ingredient_id IS NOT NULL AND o.quantity>0 AND NOT EXISTS(
    SELECT 1 FROM public.inventory_logs l WHERE l.id=o.stock_export_log_id AND l.type='EXPORT_SALE' AND l.quantity_change<0)))
 ));
END $$;

REVOKE ALL ON FUNCTION public.fn_confirm_manual_payment(text,uuid,jsonb),public.fn_get_manual_payment_operation(text,uuid),public.fn_manual_payment_status(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_confirm_manual_payment(text,uuid,jsonb),public.fn_get_manual_payment_operation(text,uuid),public.fn_manual_payment_status(text,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
