-- M-05 request budgets (PRD 12.22). Expiring counters, never payment audit.
BEGIN;
CREATE TABLE IF NOT EXISTS private.request_limits (
 scope_key text NOT NULL CHECK(scope_key='global:takeaway' OR scope_key ~ '^[a-f0-9]{64}$'),
 window_seconds integer NOT NULL CHECK(window_seconds IN (60,3600)),
 window_start timestamptz NOT NULL,
 hits integer NOT NULL CHECK(hits BETWEEN 1 AND 100001),
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(scope_key,window_seconds,window_start),
 CHECK(expires_at=window_start+make_interval(secs=>window_seconds))
);
CREATE INDEX IF NOT EXISTS idx_request_limits_expiry ON private.request_limits(expires_at);
ALTER TABLE private.request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.request_limits FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_takeaway_request_gate(
 p_fingerprint text,p_network_minute integer DEFAULT 10,p_network_hour integer DEFAULT 120,
 p_global_minute integer DEFAULT 60,p_global_hour integer DEFAULT 600
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE
 v_now timestamptz;v_start timestamptz;v_end timestamptz;v_hits integer;i integer;
 v_scopes text[];v_seconds integer[]:=ARRAY[60,3600,60,3600];v_limits integer[];
BEGIN
 IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$'
  OR p_network_minute IS NULL OR p_network_minute NOT BETWEEN 1 AND 100000
  OR p_network_hour IS NULL OR p_network_hour NOT BETWEEN 1 AND 100000
  OR p_global_minute IS NULL OR p_global_minute NOT BETWEEN 1 AND 100000
  OR p_global_hour IS NULL OR p_global_hour NOT BETWEEN 1 AND 100000 THEN
  RAISE EXCEPTION 'Invalid request limit configuration' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('123dzo:takeaway-request-budget',0));
 v_now:=clock_timestamp();
 WITH expired AS (SELECT ctid FROM private.request_limits WHERE expires_at<=v_now ORDER BY expires_at LIMIT 200)
 DELETE FROM private.request_limits WHERE ctid IN (SELECT ctid FROM expired);
 v_scopes:=ARRAY['global:takeaway','global:takeaway',p_fingerprint,p_fingerprint];
 v_limits:=ARRAY[p_global_minute,p_global_hour,p_network_minute,p_network_hour];
 FOR i IN 1..4 LOOP
  v_start:=date_bin(make_interval(secs=>v_seconds[i]),v_now,'1970-01-01 00:00:00+00'::timestamptz);
  v_end:=v_start+make_interval(secs=>v_seconds[i]);
  INSERT INTO private.request_limits AS budget(scope_key,window_seconds,window_start,hits,expires_at)
   VALUES(v_scopes[i],v_seconds[i],v_start,1,v_end)
   ON CONFLICT(scope_key,window_seconds,window_start) DO UPDATE SET hits=least(budget.hits+1,100001)
   RETURNING hits INTO v_hits;
  IF v_hits>v_limits[i] THEN
   RETURN jsonb_build_object('allowed',false,'retryAfter',greatest(1,ceil(extract(epoch FROM v_end-v_now))::integer));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('allowed',true,'retryAfter',0);
END $$;
REVOKE ALL ON FUNCTION public.fn_takeaway_request_gate(text,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_takeaway_request_gate(text,integer,integer,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
