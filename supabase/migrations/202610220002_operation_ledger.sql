BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.operation_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_key text NOT NULL CHECK (length(btrim(scope_key)) BETWEEN 1 AND 256),
    operation_id uuid NOT NULL,
    action text NOT NULL CHECK (length(btrim(action)) BETWEEN 1 AND 80),
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    session_id uuid REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
    actor_id text REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
    result jsonb CHECK (result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 16384)),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    UNIQUE (scope_key, operation_id),
    CHECK ((result IS NULL) = (completed_at IS NULL)),
    CHECK (completed_at IS NULL OR completed_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_operation_requests_created ON private.operation_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_operation_requests_session ON private.operation_requests(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operation_requests_actor ON private.operation_requests(actor_id);
ALTER TABLE private.operation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.operation_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.assert_operation_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM private.operation_requests AS op WHERE op.id = NEW.id AND op.completed_at IS NULL) THEN
        RAISE EXCEPTION 'Operation must complete in its business transaction' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS operation_must_complete ON private.operation_requests;
CREATE CONSTRAINT TRIGGER operation_must_complete
    AFTER INSERT OR UPDATE ON private.operation_requests
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.assert_operation_completed();

CREATE OR REPLACE FUNCTION private.begin_operation(
    p_scope_key text, p_operation_id uuid, p_action text, p_request jsonb,
    p_session_id uuid, p_actor_id text
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    v_hash text;
    v_inserted uuid;
    v_op private.operation_requests%ROWTYPE;
BEGIN
    IF p_scope_key IS NULL OR length(btrim(p_scope_key)) NOT BETWEEN 1 AND 256
       OR p_operation_id IS NULL OR p_action IS NULL OR length(btrim(p_action)) NOT BETWEEN 1 AND 80
       OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
       OR octet_length(p_request::text) > 32768 THEN
        RAISE EXCEPTION 'Invalid operation request' USING ERRCODE = '22023';
    END IF;
    v_hash := encode(sha256(convert_to(p_request::text, 'UTF8')), 'hex');
    INSERT INTO private.operation_requests(scope_key, operation_id, action, request_hash, session_id, actor_id)
    VALUES (p_scope_key, p_operation_id, p_action, v_hash, p_session_id, p_actor_id)
    ON CONFLICT (scope_key, operation_id) DO NOTHING
    RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN
        RETURN jsonb_build_object('replay', false);
    END IF;

    SELECT op.* INTO STRICT v_op FROM private.operation_requests AS op
    WHERE op.scope_key = p_scope_key AND op.operation_id = p_operation_id FOR UPDATE;
    IF v_op.request_hash <> v_hash OR v_op.action <> p_action
       OR v_op.session_id IS DISTINCT FROM p_session_id OR v_op.actor_id IS DISTINCT FROM p_actor_id THEN
        RAISE EXCEPTION 'Operation key reused with different input' USING ERRCODE = '22000';
    END IF;
    IF v_op.completed_at IS NULL THEN
        RAISE EXCEPTION 'Operation is already in progress in this transaction' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object('replay', true, 'result', v_op.result);
END;
$$;

CREATE OR REPLACE FUNCTION private.complete_operation(p_scope_key text, p_operation_id uuid, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    v_op private.operation_requests%ROWTYPE;
BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 16384 THEN
        RAISE EXCEPTION 'Invalid operation result' USING ERRCODE = '22023';
    END IF;
    SELECT op.* INTO v_op FROM private.operation_requests AS op
    WHERE op.scope_key = p_scope_key AND op.operation_id = p_operation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Operation not claimed' USING ERRCODE = 'P0002';
    END IF;
    IF v_op.completed_at IS NOT NULL THEN
        IF v_op.result IS DISTINCT FROM p_result THEN
            RAISE EXCEPTION 'Operation result is immutable' USING ERRCODE = '22000';
        END IF;
        RETURN v_op.result;
    END IF;
    UPDATE private.operation_requests AS op SET result = p_result, completed_at = clock_timestamp()
    WHERE op.id = v_op.id;
    RETURN p_result;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_operation_completed() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.begin_operation(text, uuid, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.complete_operation(text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
