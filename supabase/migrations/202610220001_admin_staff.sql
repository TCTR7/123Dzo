BEGIN;

CREATE OR REPLACE FUNCTION public.fn_admin_save_staff(
    p_actor_id text,
    p_profile jsonb,
    p_expected jsonb
)
RETURNS TABLE (id text, full_name text, role text, assigned_zone_id uuid, is_active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET lock_timeout = '5s'
AS $$
DECLARE
    v_target public.staff_profiles%ROWTYPE;
    v_id text;
    v_name text;
    v_role text;
    v_active boolean;
    v_zone uuid;
    v_before jsonb;
BEGIN
    IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
        RAISE EXCEPTION 'Invalid profile' USING ERRCODE = '22023';
    END IF;
    IF NOT (p_profile ?& ARRAY['id','full_name','role','assigned_zone_id','is_active'])
       OR p_profile - ARRAY['id','full_name','role','assigned_zone_id','is_active'] <> '{}'::jsonb
       OR jsonb_typeof(p_profile->'id') <> 'string'
       OR (p_profile->>'id') !~ '^user_[A-Za-z0-9_]{1,128}$'
       OR jsonb_typeof(p_profile->'full_name') <> 'string'
       OR length(btrim(p_profile->>'full_name')) NOT BETWEEN 1 AND 120
       OR jsonb_typeof(p_profile->'role') <> 'string'
       OR (p_profile->>'role') NOT IN ('admin','staff','kitchen')
       OR jsonb_typeof(p_profile->'is_active') <> 'boolean'
       OR jsonb_typeof(p_profile->'assigned_zone_id') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'Invalid profile' USING ERRCODE = '22023';
    END IF;
    v_id := p_profile->>'id';
    v_name := btrim(p_profile->>'full_name');
    v_role := p_profile->>'role';
    v_active := (p_profile->>'is_active')::boolean;
    BEGIN
        v_zone := (p_profile->>'assigned_zone_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid zone' USING ERRCODE = '22023';
    END;

    -- Staff administration is infrequent. Serialize all writes, including
    -- service-role subscription updates, to prevent last-admin write skew.
    LOCK TABLE public.staff_profiles IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS (
        SELECT 1 FROM public.staff_profiles AS actor
        WHERE actor.id = p_actor_id AND actor.role = 'admin' AND actor.is_active
    ) THEN
        RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
    END IF;

    SELECT sp.* INTO v_target FROM public.staff_profiles AS sp WHERE sp.id = v_id;
    IF p_expected IS NULL THEN
        IF FOUND THEN
            RAISE EXCEPTION 'Profile already exists' USING ERRCODE = '23505';
        END IF;
        INSERT INTO public.staff_profiles (id, full_name, role, assigned_zone_id, is_active)
        VALUES (v_id, v_name, v_role, v_zone, v_active);
    ELSE
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0002';
        END IF;
        v_before := jsonb_build_object(
            'id', v_target.id, 'full_name', v_target.full_name, 'role', v_target.role,
            'assigned_zone_id', v_target.assigned_zone_id, 'is_active', v_target.is_active
        );
        IF p_expected IS DISTINCT FROM v_before THEN
            RAISE EXCEPTION 'Profile changed' USING ERRCODE = '40001';
        END IF;
        IF v_target.role = 'admin' AND v_target.is_active AND (v_role <> 'admin' OR NOT v_active)
           AND (SELECT count(*) FROM public.staff_profiles AS sp WHERE sp.role = 'admin' AND sp.is_active) <= 1 THEN
            RAISE EXCEPTION 'Cannot remove the last active admin' USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.staff_profiles AS sp
        SET full_name = v_name, role = v_role, assigned_zone_id = v_zone, is_active = v_active
        WHERE sp.id = v_id;
    END IF;
    RETURN QUERY SELECT sp.id, sp.full_name, sp.role, sp.assigned_zone_id, sp.is_active
        FROM public.staff_profiles AS sp WHERE sp.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_save_staff(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_save_staff(text, jsonb, jsonb) TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.staff_profiles FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, full_name, role, assigned_zone_id, push_subscription, is_active),
       UPDATE (id, full_name, role, assigned_zone_id, push_subscription, is_active)
       ON public.staff_profiles FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
