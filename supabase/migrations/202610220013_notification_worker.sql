-- Durable push delivery; spec 12.14. No external network is performed in SQL.
BEGIN;
ALTER TABLE private.notification_outbox ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE private.notification_outbox ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE private.notification_outbox ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('SENT','SKIPPED','FAILED'));
CREATE TABLE IF NOT EXISTS private.notification_receipts (
  outbox_id uuid NOT NULL REFERENCES private.notification_outbox(id) ON DELETE RESTRICT,
  staff_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  subscription_hash text NOT NULL CHECK (subscription_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(outbox_id,staff_id,subscription_hash)
);
ALTER TABLE private.notification_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.notification_receipts,private.notification_outbox FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS notification_actionable_idx ON private.notification_outbox(available_at,id)
  WHERE delivered_at IS NULL AND failed_at IS NULL;

CREATE OR REPLACE FUNCTION private.enqueue_bill_notification()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF OLD.status='ACTIVE' AND NEW.status='REQUEST_BILL' THEN
    INSERT INTO private.notification_outbox(dedupe_key,session_id,kind,payload)
    VALUES('bill-request:'||NEW.id::text,NEW.id,'BILL_REQUESTED',jsonb_build_object('sessionId',NEW.id)) ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enqueue_bill_notification() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS enqueue_bill_notification ON public.table_sessions;
CREATE TRIGGER enqueue_bill_notification AFTER UPDATE OF status ON public.table_sessions FOR EACH ROW EXECUTE FUNCTION private.enqueue_bill_notification();

CREATE OR REPLACE FUNCTION private.notification_targets(p_job private.notification_outbox)
RETURNS TABLE(staff_id text,subscription jsonb,subscription_hash text)
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT p.id,p.push_subscription,encode(public.digest(p.push_subscription::text,'sha256'),'hex')
  FROM public.table_sessions s LEFT JOIN public.tables t ON t.id=s.table_id
  LEFT JOIN public.order_items i ON i.id=p_job.order_item_id AND i.session_id=s.id
  JOIN public.staff_profiles p ON p.is_active AND p.role IN ('staff','admin') AND p.push_subscription IS NOT NULL
  WHERE s.id=p_job.session_id AND s.status IN ('ACTIVE','REQUEST_BILL') AND (
    (p_job.kind IN ('ORDER_READY','ORDER_READY_FALLBACK') AND i.status='READY' AND i.quantity>0 AND i.served_at IS NULL
      AND i.ready_at IS NOT NULL AND isfinite(i.ready_at) AND i.ready_at<=now()
      AND (p_job.kind<>'ORDER_READY_FALLBACK' OR i.ready_at<=now()-interval '120 seconds'))
    OR (p_job.kind='BILL_REQUESTED' AND s.status='REQUEST_BILL')
  ) AND (
    (p_job.kind<>'ORDER_READY_FALLBACK' AND p.id=s.assigned_staff_id AND EXISTS(
      SELECT 1 FROM public.staff_profiles a WHERE a.id=s.assigned_staff_id AND a.is_active AND a.role IN ('staff','admin')))
    OR ((p_job.kind='ORDER_READY_FALLBACK' OR NOT EXISTS(
      SELECT 1 FROM public.staff_profiles a WHERE a.id=s.assigned_staff_id AND a.is_active AND a.role IN ('staff','admin')))
      AND t.zone_id IS NOT NULL AND p.assigned_zone_id=t.zone_id)
  ) AND NOT EXISTS(SELECT 1 FROM private.notification_receipts r WHERE r.outbox_id=p_job.id AND r.staff_id=p.id
    AND r.subscription_hash=encode(public.digest(p.push_subscription::text,'sha256'),'hex'))
  ORDER BY p.id;
$$;
REVOKE ALL ON FUNCTION private.notification_targets(private.notification_outbox) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_claim_notification_job()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE j private.notification_outbox; BEGIN
  WITH ignored AS (SELECT id FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL
    AND kind NOT IN ('ORDER_READY','ORDER_READY_FALLBACK','BILL_REQUESTED') AND (locked_until IS NULL OR locked_until<=clock_timestamp())
    ORDER BY available_at,id LIMIT 100 FOR UPDATE SKIP LOCKED)
  UPDATE private.notification_outbox o SET delivered_at=clock_timestamp(),outcome='SKIPPED',last_error='NOT_PUSH_EVENT',locked_until=NULL,lease_token=NULL
    FROM ignored x WHERE o.id=x.id;
  WITH exhausted AS (SELECT id FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL
    AND attempts>=8 AND (locked_until IS NULL OR locked_until<=clock_timestamp()) ORDER BY available_at,id LIMIT 50 FOR UPDATE SKIP LOCKED)
  UPDATE private.notification_outbox o SET failed_at=clock_timestamp(),outcome='FAILED',lease_token=NULL,locked_until=NULL,
    last_error=coalesce(last_error,'LEASE_EXHAUSTED') FROM exhausted e WHERE o.id=e.id;
  SELECT * INTO j FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL AND attempts<8
    AND available_at<=clock_timestamp() AND (locked_until IS NULL OR locked_until<=clock_timestamp())
    ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF j.kind='ORDER_READY' THEN
    INSERT INTO private.notification_outbox(dedupe_key,session_id,order_item_id,kind,payload,available_at)
    SELECT 'ready-fallback:'||i.id::text,i.session_id,i.id,'ORDER_READY_FALLBACK',jsonb_build_object('orderItemId',i.id),i.ready_at+interval '120 seconds'
    FROM public.order_items i JOIN public.table_sessions s ON s.id=i.session_id
    WHERE i.id=j.order_item_id AND i.session_id=j.session_id AND i.status='READY' AND i.quantity>0 AND i.ready_at IS NOT NULL
      AND isfinite(i.ready_at) AND s.status IN ('ACTIVE','REQUEST_BILL') ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  UPDATE private.notification_outbox SET attempts=attempts+1,lease_token=gen_random_uuid(),locked_until=clock_timestamp()+interval '45 seconds'
    WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('id',j.id,'leaseToken',j.lease_token,'kind',j.kind);
END $$;

CREATE OR REPLACE FUNCTION private.assert_notification_lease(p_id uuid,p_lease uuid)
RETURNS private.notification_outbox LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE j private.notification_outbox; BEGIN
  SELECT * INTO j FROM private.notification_outbox WHERE id=p_id AND lease_token=p_lease AND locked_until>clock_timestamp()
    AND delivered_at IS NULL AND failed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICATION_LEASE_LOST' USING ERRCODE='40001'; END IF;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION private.assert_notification_lease(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_prepare_notification_job(p_id uuid,p_lease uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE j private.notification_outbox; target jsonb; BEGIN
  j:=private.assert_notification_lease(p_id,p_lease);
  SELECT jsonb_build_object('staffId',t.staff_id,'subscription',t.subscription,'subscriptionHash',t.subscription_hash)
    INTO target FROM private.notification_targets(j) t LIMIT 1;
  RETURN jsonb_build_object('kind',j.kind,'tag','notification-'||j.id::text,'target',target);
END $$;

CREATE OR REPLACE FUNCTION public.fn_ack_notification_recipient(p_id uuid,p_lease uuid,p_staff_id text,p_hash text,p_expired boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
  PERFORM private.assert_notification_lease(p_id,p_lease);
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_staff_id IS NULL OR p_expired IS NULL THEN RAISE EXCEPTION 'INVALID_RECEIPT' USING ERRCODE='22023'; END IF;
  IF p_expired THEN
    UPDATE public.staff_profiles SET push_subscription=NULL WHERE id=p_staff_id
      AND encode(public.digest(push_subscription::text,'sha256'),'hex')=p_hash;
  ELSE
    INSERT INTO private.notification_receipts(outbox_id,staff_id,subscription_hash) VALUES(p_id,p_staff_id,p_hash) ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_finish_notification_job(p_id uuid,p_lease uuid,p_retry boolean,p_error text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE j private.notification_outbox; state text; BEGIN
  j:=private.assert_notification_lease(p_id,p_lease);
  IF p_retry IS NULL OR (p_error IS NOT NULL AND p_error NOT IN ('PUSH_TRANSIENT','PUSH_REJECTED','DELIVERY_UNCERTAIN','WORKER_ERROR','BUDGET_EXHAUSTED')) THEN RAISE EXCEPTION 'INVALID_JOB_RESULT' USING ERRCODE='22023'; END IF;
  IF NOT p_retry AND NOT EXISTS(SELECT 1 FROM private.notification_targets(j)) THEN
    state:=CASE WHEN EXISTS(SELECT 1 FROM private.notification_receipts WHERE outbox_id=j.id) THEN 'SENT' ELSE 'SKIPPED' END;
    UPDATE private.notification_outbox SET delivered_at=clock_timestamp(),outcome=state,lease_token=NULL,locked_until=NULL,
      last_error=CASE WHEN state='SKIPPED' THEN 'NO_ELIGIBLE_RECIPIENT' ELSE NULL END WHERE id=j.id;
    RETURN state;
  END IF;
  state:=CASE WHEN j.attempts>=8 THEN 'FAILED' ELSE 'RETRY' END;
  UPDATE private.notification_outbox SET lease_token=NULL,locked_until=NULL,last_error=coalesce(p_error,'BUDGET_EXHAUSTED'),
    available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,least(j.attempts,6))*5)::int),
    failed_at=CASE WHEN state='FAILED' THEN clock_timestamp() ELSE NULL END,
    outcome=CASE WHEN state='FAILED' THEN 'FAILED' ELSE NULL END WHERE id=j.id;
  RETURN state;
END $$;

CREATE OR REPLACE FUNCTION public.fn_set_push_subscription(p_actor_id text,p_subscription jsonb,p_expected_endpoint text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
  PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role IN ('staff','admin') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_subscription IS NULL THEN
    IF p_expected_endpoint IS NULL OR length(p_expected_endpoint)>2048 THEN RAISE EXCEPTION 'EXPECTED_ENDPOINT_REQUIRED' USING ERRCODE='22023'; END IF;
    UPDATE public.staff_profiles SET push_subscription=NULL WHERE id=p_actor_id AND push_subscription->>'endpoint'=p_expected_endpoint;
  ELSE
    IF jsonb_typeof(p_subscription)<>'object' OR octet_length(p_subscription::text)>4096 THEN RAISE EXCEPTION 'INVALID_SUBSCRIPTION' USING ERRCODE='22023'; END IF;
    UPDATE public.staff_profiles SET push_subscription=p_subscription WHERE id=p_actor_id;
  END IF;
END $$;
REVOKE UPDATE(push_subscription) ON public.staff_profiles FROM service_role;

CREATE OR REPLACE FUNCTION public.fn_admin_notification_jobs(p_actor_id text,p_retry_id uuid DEFAULT NULL,p_expected_attempts integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE result jsonb; BEGIN
  PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND is_active AND role='admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF p_retry_id IS NOT NULL THEN
    UPDATE private.notification_outbox SET attempts=0,failed_at=NULL,outcome=NULL,available_at=clock_timestamp(),last_error=NULL,
      locked_until=NULL,lease_token=NULL WHERE id=p_retry_id AND failed_at IS NOT NULL AND attempts=p_expected_attempts;
    IF NOT FOUND THEN RAISE EXCEPTION 'JOB_CHANGED' USING ERRCODE='40001'; END IF;
  END IF;
  SELECT jsonb_build_object('pending',(SELECT count(*) FROM private.notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL),
    'failed',(SELECT count(*) FROM private.notification_outbox WHERE failed_at IS NOT NULL),
    'jobs',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT id,kind,attempts,available_at,locked_until,failed_at,outcome,last_error FROM private.notification_outbox
      WHERE delivered_at IS NULL ORDER BY failed_at DESC NULLS LAST,available_at,id LIMIT 25) x),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.fn_claim_notification_job(),public.fn_prepare_notification_job(uuid,uuid),
  public.fn_ack_notification_recipient(uuid,uuid,text,text,boolean),public.fn_finish_notification_job(uuid,uuid,boolean,text),
  public.fn_set_push_subscription(text,jsonb,text),public.fn_admin_notification_jobs(text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_notification_job(),public.fn_prepare_notification_job(uuid,uuid),
  public.fn_ack_notification_recipient(uuid,uuid,text,text,boolean),public.fn_finish_notification_job(uuid,uuid,boolean,text),
  public.fn_set_push_subscription(text,jsonb,text),public.fn_admin_notification_jobs(text,uuid,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
