BEGIN;
CREATE TABLE IF NOT EXISTS private.menu_image_uploads(
    id uuid PRIMARY KEY,
    actor_id text NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
    content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
    object_path text NOT NULL UNIQUE,
    public_url text NOT NULL UNIQUE,
    state text NOT NULL CHECK(state IN ('UPLOADING','READY','DELETING','DELETED')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.menu_image_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.menu_image_uploads FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX IF NOT EXISTS menu_image_cleanup_idx ON private.menu_image_uploads(state,created_at);

CREATE OR REPLACE FUNCTION public.fn_menu_image_upload(p_actor_id text,p_id uuid,p_hash text,p_url text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_image private.menu_image_uploads%ROWTYPE; v_path text:='managed/'||p_id::text||'.webp';
BEGIN
    IF p_id IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_url IS NULL OR length(p_url)>2048
       OR p_url !~ '^https://[^[:space:]]+/storage/v1/object/public/menu-images/managed/[a-f0-9-]{36}\.webp$'
       OR right(p_url,length(v_path))<>v_path OR p_action IS NULL OR p_action NOT IN ('RESERVE','READY') THEN
        RAISE EXCEPTION 'Invalid image reservation' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
    -- Serialize reservations per actor to make the hourly quota exact.
    PERFORM pg_advisory_xact_lock(hashtextextended('menu-images:'||p_actor_id,0));
    SELECT * INTO v_image FROM private.menu_image_uploads WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN
        IF p_action<>'RESERVE' THEN RAISE EXCEPTION 'Image reservation missing' USING ERRCODE='P1701'; END IF;
        IF (SELECT count(*) FROM private.menu_image_uploads WHERE actor_id=p_actor_id AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN
            RAISE EXCEPTION 'Image upload limit' USING ERRCODE='P1704';
        END IF;
        INSERT INTO private.menu_image_uploads(id,actor_id,content_hash,object_path,public_url,state)
        VALUES(p_id,p_actor_id,p_hash,v_path,p_url,'UPLOADING') RETURNING * INTO v_image;
    ELSE
        IF v_image.actor_id<>p_actor_id OR v_image.content_hash<>p_hash OR v_image.public_url<>p_url THEN
            RAISE EXCEPTION 'Upload identity conflict' USING ERRCODE='22000';
        END IF;
        IF v_image.state IN ('DELETING','DELETED') THEN RAISE EXCEPTION 'Image retired' USING ERRCODE='P1702'; END IF;
        IF p_action='READY' THEN
            UPDATE private.menu_image_uploads SET state='READY',updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO v_image;
        END IF;
    END IF;
    RETURN jsonb_build_object('id',v_image.id,'path',v_image.object_path,'url',v_image.public_url,'state',v_image.state);
END;
$$;

CREATE OR REPLACE FUNCTION private.check_menu_image_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
    IF NEW.image_url IS NULL THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url THEN RETURN NEW; END IF;
    PERFORM 1 FROM private.menu_image_uploads WHERE public_url=NEW.image_url AND state='READY' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Image is not ready or managed' USING ERRCODE='P1703'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS check_menu_image_reference ON public.menu_items;
CREATE TRIGGER check_menu_image_reference BEFORE INSERT OR UPDATE OF image_url ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION private.check_menu_image_reference();

CREATE OR REPLACE FUNCTION public.fn_claim_menu_image_cleanup(p_actor_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE v_image private.menu_image_uploads%ROWTYPE; v_result jsonb:='[]'::jsonb;
BEGIN
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
    FOR v_image IN SELECT * FROM private.menu_image_uploads
      WHERE (state='DELETING' OR (state IN ('UPLOADING','READY') AND created_at<clock_timestamp()-interval '24 hours'))
        AND NOT EXISTS(SELECT 1 FROM public.menu_items WHERE image_url=menu_image_uploads.public_url)
      ORDER BY updated_at,id LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
        IF EXISTS(SELECT 1 FROM public.menu_items WHERE image_url=v_image.public_url) THEN CONTINUE; END IF;
        UPDATE private.menu_image_uploads SET state='DELETING',updated_at=clock_timestamp() WHERE id=v_image.id;
        v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_image.id,'path',v_image.object_path));
    END LOOP;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_finish_menu_image_cleanup(p_actor_id text,p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
BEGIN
    PERFORM 1 FROM public.staff_profiles WHERE id=p_actor_id AND role='admin' AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
    UPDATE private.menu_image_uploads SET state='DELETED',updated_at=clock_timestamp() WHERE id=p_id AND state='DELETING';
END;
$$;
REVOKE ALL ON FUNCTION private.check_menu_image_reference() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_menu_image_upload(text,uuid,text,text,text),public.fn_claim_menu_image_cleanup(text),public.fn_finish_menu_image_cleanup(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_menu_image_upload(text,uuid,text,text,text),public.fn_claim_menu_image_cleanup(text),public.fn_finish_menu_image_cleanup(text,uuid) TO service_role;

DO $$ BEGIN
    IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
        INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
        VALUES('menu-images','menu-images',true,81919,ARRAY['image/webp'])
        ON CONFLICT(id) DO UPDATE SET public=true,file_size_limit=81919,allowed_mime_types=ARRAY['image/webp'];
        DROP POLICY IF EXISTS menu_images_no_browser_insert ON storage.objects;
        DROP POLICY IF EXISTS menu_images_no_browser_update ON storage.objects;
        DROP POLICY IF EXISTS menu_images_no_browser_delete ON storage.objects;
        CREATE POLICY menu_images_no_browser_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated WITH CHECK(bucket_id<>'menu-images');
        CREATE POLICY menu_images_no_browser_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated USING(bucket_id<>'menu-images') WITH CHECK(bucket_id<>'menu-images');
        CREATE POLICY menu_images_no_browser_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated USING(bucket_id<>'menu-images');
    END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
