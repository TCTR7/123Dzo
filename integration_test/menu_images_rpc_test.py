"""Image authorization/cleanup races and Storage policy fixture on disposable PostgreSQL."""
import concurrent.futures
import json
import uuid
import unittest
import staff_rpc_test as db
import dine_in_rpc_test as orders

HASH='a'*64
IMAGE='80000000-0000-4000-8000-000000000001'
def url(id=IMAGE):return f'https://project.test/storage/v1/object/public/menu-images/managed/{id}.webp'
def reserve(id=IMAGE,actor='user_admin',action='RESERVE',hash=HASH):return f"SELECT public.fn_menu_image_upload('{actor}','{id}','{hash}','{url(id)}','{action}');"

class MenuImagesRpcTest(db.PostgresTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sql("CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO anon,authenticated; GRANT ALL ON storage.objects TO anon,authenticated; CREATE POLICY legacy_open ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);")
        cls.sql((db.ROOT/'supabase/migrations/202610220011_menu_images.sql').read_text(encoding='utf-8'))

    def setUp(self):orders.DineInRpcTest.setUp(self);self.sql('TRUNCATE storage.objects;')
    def image(self,id=IMAGE):self.sql('SET ROLE service_role;'+reserve(id));self.sql('SET ROLE service_role;'+reserve(id,action='READY'))
    def claim_images(self):return json.loads(self.sql("SET ROLE service_role; SELECT public.fn_claim_menu_image_cleanup('user_admin');").splitlines()[-1])
    def age(self):self.sql("UPDATE private.menu_image_uploads SET created_at=clock_timestamp()-interval '25 hours'")
    def snapshot(self):return json.loads(self.sql(f"SELECT to_jsonb(m)-'id' FROM public.menu_items m WHERE id='{orders.FOOD}'"))
    def attach(self,asset=url()):
        before=self.snapshot();body=dict(action='UPDATE',id=orders.FOOD,item={**before,'image_url':asset},expected=before)
        return f"SELECT public.fn_menu_action('user_admin','{uuid.uuid4()}',{db.literal(json.dumps(body))}::jsonb);"
    def raw(self,sql):return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At','-c',sql,check=False)

    def test_bootstrap_parity_and_private_public_grants(self):
        for sig in ['fn_menu_image_upload(text,uuid,text,text,text)','fn_claim_menu_image_cleanup(text)','fn_finish_menu_image_cleanup(text,uuid)']:
            query=f"SELECT pg_get_functiondef('public.{sig}'::regprocedure)";self.assertEqual(self.sql(query),self.sql(query,db='bootstrap_check'))
        for role in ['anon','authenticated','service_role']:
            self.sql(f'SET ROLE {role}; SELECT * FROM private.menu_image_uploads',error='42501')
            if role!='service_role':self.sql(f'SET ROLE {role};'+reserve(),error='42501')

    def test_upload_reservation_replay_hash_scope_role_and_quota(self):
        self.sql(reserve());self.sql(reserve());self.assertEqual(self.sql('SELECT count(*) FROM private.menu_image_uploads'),'1')
        self.sql(reserve(hash='b'*64),error='22000')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES('user_second','Second','admin')")
        self.sql(reserve(actor='user_second'),error='22000')
        for actor in ['user_staff','user_kitchen','user_missing']:self.sql(reserve(actor=actor),error='42501')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_admin'");self.sql(reserve(),error='42501')
        self.sql("UPDATE public.staff_profiles SET is_active=true WHERE id='user_admin'")
        commands=[reserve(str(uuid.uuid4())) for _ in range(29)];self.sql(''.join(commands));self.sql(reserve(str(uuid.uuid4())),error='P1704')

    def test_only_ready_images_attach_and_save_failure_keeps_upload(self):
        self.sql(reserve());self.sql(self.attach(),error='P1703');self.assertEqual(self.sql("SELECT state FROM private.menu_image_uploads"),'UPLOADING')
        self.sql(reserve(action='READY'));before=self.snapshot();self.sql(self.attach())
        stale={**before,'image_url':url(),'name':'Stale'}
        self.sql(f"SELECT public.fn_menu_action('user_admin','{uuid.uuid4()}',{db.literal(json.dumps(dict(action='UPDATE',id=orders.FOOD,item=stale,expected=before)))}::jsonb)",error='P1502')
        self.assertEqual(self.sql('SELECT state FROM private.menu_image_uploads'),'READY')
        self.sql(self.attach('https://elsewhere.test/unchecked.webp'),error='P1703')

    def test_cleanup_grace_reference_check_tombstone_and_retry(self):
        self.image();self.assertEqual(self.claim_images(),[])
        self.sql(self.attach());self.age();self.assertEqual(self.claim_images(),[])
        self.sql(f"UPDATE public.menu_items SET image_url=NULL WHERE id='{orders.FOOD}'")
        claimed=self.claim_images();self.assertEqual(claimed,[dict(id=IMAGE,path=f'managed/{IMAGE}.webp')]);self.assertEqual(self.claim_images(),claimed)
        self.sql(self.attach(),error='P1703');self.sql(reserve(action='READY'),error='P1702')
        self.sql(f"SET ROLE service_role; SELECT public.fn_finish_menu_image_cleanup('user_admin','{IMAGE}')")
        self.assertEqual(self.sql('SELECT state FROM private.menu_image_uploads'),'DELETED');self.assertEqual(self.claim_images(),[])

    def test_cleanup_does_not_starve_behind_twenty_referenced_images(self):
        commands=[]
        for i in range(21):
            id=str(uuid.uuid4());commands.extend([reserve(id),reserve(id,action='READY')])
            if i<20:commands.append(f"INSERT INTO public.menu_items(name,category,station,price,image_url) VALUES('Referenced','FOOD','KITCHEN',1,'{url(id)}');")
            else:orphan=id
        self.sql(''.join(commands));self.age();self.assertEqual(self.claim_images(),[dict(id=orphan,path=f'managed/{orphan}.webp')])

    def test_concurrent_attach_and_cleanup_never_leave_referenced_image_deleting(self):
        self.image();self.age()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(self.raw,[self.attach(),"SELECT public.fn_claim_menu_image_cleanup('user_admin');"]))
        image=self.sql(f"SELECT image_url FROM public.menu_items WHERE id='{orders.FOOD}'");state=self.sql('SELECT state FROM private.menu_image_uploads')
        if image:self.assertEqual(state,'READY');self.assertEqual(results[0].returncode,0)
        else:self.assertEqual(state,'DELETING');self.assertIn('P1703:',results[0].stderr)

    def test_legacy_unchanged_url_remains_editable_but_new_arbitrary_url_is_blocked(self):
        self.sql("ALTER TABLE public.menu_items DISABLE TRIGGER check_menu_image_reference;")
        self.sql(f"UPDATE public.menu_items SET image_url='https://legacy.test/menu.webp' WHERE id='{orders.FOOD}'")
        self.sql("ALTER TABLE public.menu_items ENABLE TRIGGER check_menu_image_reference;")
        self.sql(self.attach('https://legacy.test/menu.webp'));self.sql(self.attach('https://legacy.test/new.webp'),error='P1703')

    def test_storage_policies_override_legacy_permissive_writes_only_for_menu_bucket(self):
        self.assertEqual(self.sql("SELECT file_size_limit||':'||allowed_mime_types[1] FROM storage.buckets WHERE id='menu-images'"),'81919:image/webp')
        self.sql("INSERT INTO storage.objects(bucket_id,name) VALUES('menu-images','kept.webp'),('other','allowed.webp')")
        for role in ['anon','authenticated']:
            self.sql(f"SET ROLE {role}; INSERT INTO storage.objects(bucket_id,name) VALUES('menu-images','forbidden.webp')",error='42501')
            self.sql(f"SET ROLE {role}; UPDATE storage.objects SET name='bad' WHERE bucket_id='menu-images'; DELETE FROM storage.objects WHERE bucket_id='menu-images';")
            self.sql(f"SET ROLE {role}; INSERT INTO storage.objects(bucket_id,name) VALUES('other','allowed.webp')")
        self.assertEqual(self.sql("SELECT name FROM storage.objects WHERE bucket_id='menu-images'"),'kept.webp')


if __name__=='__main__':unittest.main(verbosity=2)
