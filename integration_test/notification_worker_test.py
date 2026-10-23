"""Durable notification jobs on disposable PostgreSQL; no network or app credentials."""
import concurrent.futures
import json
import unittest
import staff_rpc_test as db
from dine_in_rpc_test import SESSION, FOOD, TOKEN, order

ZONE='60000000-0000-4000-8000-000000000001'
TABLE='70000000-0000-4000-8000-000000000001'


class NotificationWorkerTest(db.PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.zones,public.staff_profiles,public.ingredients,public.menu_items,public.table_sessions CASCADE;')
        self.sql(f"INSERT INTO public.zones(id,name) VALUES ('{ZONE}','Zone'); INSERT INTO public.tables(id,table_number,zone_id) VALUES ('{TABLE}','A1','{ZONE}');")
        sub=db.literal(json.dumps({'endpoint':'https://fcm.googleapis.com/fcm/send/test','keys':{'auth':'fixture','p256dh':'fixture'}}))
        self.sql(f"INSERT INTO public.staff_profiles(id,full_name,role,assigned_zone_id,push_subscription) VALUES ('user_admin','Admin','admin',NULL,NULL),('user_assigned','Assigned','staff','{ZONE}',{sub}::jsonb),('user_zone','Zone','staff','{ZONE}',{sub}::jsonb),('user_outside','Outside','staff',NULL,{sub}::jsonb);")
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES ('{FOOD}','Drink','DRINK','BAR_INSTANT',100,40); INSERT INTO public.table_sessions(id,session_token,session_type,status,table_id,assigned_staff_id) VALUES ('{SESSION}','{TOKEN}','DINE_IN','ACTIVE','{TABLE}','user_assigned');")
        self.sql(order())
        self.item=self.sql('SELECT id FROM public.order_items')

    def call(self,name,args=''):
        result=self.sql(f'SET ROLE service_role; SELECT public.{name}({args});').splitlines()
        return json.loads(result[-1]) if result and result[-1] and result[-1]!='SET' else None

    def claim(self): return self.call('fn_claim_notification_job')
    def lease(self,job): return db.literal(job['id'])+'::uuid,'+db.literal(job['leaseToken'])+'::uuid'
    def prepare(self,job): return self.call('fn_prepare_notification_job',self.lease(job))
    def ack(self,job,target,expired=False):
        self.sql('SET ROLE service_role; SELECT public.fn_ack_notification_recipient('+self.lease(job)+','+db.literal(target['staffId'])+','+db.literal(target['subscriptionHash'])+','+str(expired).lower()+');')
    def finish(self,job,retry=False):
        return self.sql('SET ROLE service_role; SELECT public.fn_finish_notification_job('+self.lease(job)+','+str(retry).lower()+",'PUSH_TRANSIENT');").splitlines()[-1]

    def test_bootstrap_repeatable_parity_and_service_public_boundaries(self):
        q="SELECT pg_get_functiondef('public.fn_claim_notification_job()'::regprocedure)"
        self.assertEqual(self.sql(q),self.sql(q,db='bootstrap_check'))
        for role in ['anon','authenticated','service_role']:
            self.sql(f'SET ROLE {role}; SELECT * FROM private.notification_outbox;',error='42501')
            self.sql(f'SET ROLE {role}; SELECT * FROM private.notification_receipts;',error='42501')
            self.sql(f'SET ROLE {role}; SELECT private.notification_targets(NULL);',error='42501')
        for role in ['anon','authenticated']:
            self.sql(f'SET ROLE {role}; SELECT public.fn_claim_notification_job();',error='42501')
            self.sql(f"SET ROLE {role}; SELECT public.fn_set_push_subscription('user_assigned',NULL,'endpoint');",error='42501')
        self.sql("SET ROLE service_role; UPDATE public.staff_profiles SET push_subscription=NULL;",error='42501')

    def test_primary_targets_current_assignment_and_ack_prevents_duplicate_send(self):
        job=self.claim(); target=self.prepare(job)['target']; self.assertEqual(target['staffId'],'user_assigned')
        self.ack(job,target); self.ack(job,target)
        self.assertIsNone(self.prepare(job)['target']); self.assertEqual(self.finish(job),'SENT')
        self.assertEqual(self.sql('SELECT count(*) FROM private.notification_receipts'),'1')
        self.assertEqual(self.sql("SELECT count(*) FROM private.notification_outbox WHERE kind='ORDER_READY_FALLBACK'"),'1')
        self.assertEqual(self.sql("SELECT available_at=ready_at+interval '120 seconds' FROM private.notification_outbox o JOIN public.order_items i ON i.id=o.order_item_id WHERE o.kind='ORDER_READY_FALLBACK'"),'t')
        self.assertIsNone(self.claim())

    def test_claim_is_exclusive_and_expired_lease_can_be_recovered(self):
        def claim_raw(_):
            return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres','-At','-c','SET ROLE service_role; SELECT public.fn_claim_notification_job();').stdout.strip().splitlines()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(claim_raw,range(2)))
        jobs=[json.loads(rows[-1]) for rows in results if rows and rows[-1].startswith('{')]
        self.assertEqual(len(jobs),1); old=jobs[0]
        self.sql(f"UPDATE private.notification_outbox SET locked_until=now()-interval '1 second' WHERE id='{old['id']}';")
        recovered=self.claim(); self.assertEqual(recovered['id'],old['id']); self.assertNotEqual(recovered['leaseToken'],old['leaseToken'])
        self.sql('SET ROLE service_role; SELECT public.fn_prepare_notification_job('+self.lease(old)+');',error='40001')

    def test_assignment_revocation_unpaid_and_served_are_rechecked_before_each_recipient(self):
        job=self.claim()
        self.sql(f"UPDATE public.table_sessions SET assigned_staff_id='user_zone' WHERE id='{SESSION}'")
        self.assertEqual(self.prepare(job)['target']['staffId'],'user_zone')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_zone'")
        self.assertEqual(self.prepare(job)['target']['staffId'],'user_assigned')
        for status in ['PENDING_PAYMENT','CLOSED']:
            self.sql(f"UPDATE public.table_sessions SET status='{status}' WHERE id='{SESSION}'")
            self.assertIsNone(self.prepare(job)['target'])
        self.sql(f"UPDATE public.table_sessions SET status='ACTIVE' WHERE id='{SESSION}'; UPDATE public.order_items SET status='SERVED',served_at=now();")
        self.assertIsNone(self.prepare(job)['target']); self.assertEqual(self.finish(job),'SKIPPED')

    def test_fallback_uses_current_zone_only_and_never_shop_wide(self):
        primary=self.claim(); self.ack(primary,self.prepare(primary)['target']); self.finish(primary)
        self.sql("UPDATE public.order_items SET ready_at=now()-interval '121 seconds'; UPDATE private.notification_outbox SET available_at=now()-interval '1 second' WHERE kind='ORDER_READY_FALLBACK';")
        job=self.claim(); self.assertEqual(job['kind'],'ORDER_READY_FALLBACK')
        targets=[]
        for _ in range(2):
            target=self.prepare(job)['target']; targets.append(target['staffId']); self.ack(job,target)
        self.assertEqual(set(targets),{'user_assigned','user_zone'}); self.assertIsNone(self.prepare(job)['target'])
        self.assertEqual(self.finish(job),'SENT')

    def test_served_before_fallback_and_missing_table_do_not_notify(self):
        primary=self.claim(); self.ack(primary,self.prepare(primary)['target']); self.finish(primary)
        self.sql("UPDATE public.order_items SET ready_at=now()-interval '121 seconds',status='SERVED',served_at=now(); UPDATE private.notification_outbox SET available_at=now()-interval '1 second' WHERE kind='ORDER_READY_FALLBACK';")
        fallback=self.claim(); self.assertIsNone(self.prepare(fallback)['target'])
        self.sql(f"UPDATE public.order_items SET status='READY',served_at=NULL; UPDATE public.table_sessions SET table_id=NULL WHERE id='{SESSION}';")
        self.assertIsNone(self.prepare(fallback)['target']); self.assertEqual(self.finish(fallback),'SKIPPED')

    def test_partial_delivery_retry_keeps_receipts_and_only_sends_remaining(self):
        self.sql(f"UPDATE public.table_sessions SET assigned_staff_id=NULL WHERE id='{SESSION}'")
        job=self.claim(); target=self.prepare(job)['target']; self.ack(job,target)
        self.assertEqual(self.finish(job,True),'RETRY')
        self.assertEqual(self.sql(f"SELECT available_at>now()+interval '8 seconds' FROM private.notification_outbox WHERE id='{job['id']}'"),'t')
        self.sql(f"UPDATE private.notification_outbox SET available_at=now()-interval '1 second' WHERE id='{job['id']}';")
        second=self.claim(); self.assertNotEqual(self.prepare(second)['target']['staffId'],target['staffId'])
        self.ack(second,self.prepare(second)['target']); self.assertEqual(self.finish(second),'SENT')

    def test_expired_subscription_cleanup_is_compare_and_swap(self):
        job=self.claim(); target=self.prepare(job)['target']
        self.sql("UPDATE public.staff_profiles SET push_subscription=jsonb_set(push_subscription,'{endpoint}','\"https://fcm.googleapis.com/new-device\"') WHERE id='user_assigned'")
        self.ack(job,target,True)
        self.assertIn('new-device',self.sql("SELECT push_subscription FROM public.staff_profiles WHERE id='user_assigned'"))
        self.ack(job,self.prepare(job)['target'],True)
        self.assertEqual(self.sql("SELECT push_subscription IS NULL FROM public.staff_profiles WHERE id='user_assigned'"),'t')

    def test_dead_letter_admin_visibility_cas_retry_and_role_recheck(self):
        job=self.claim(); self.sql(f"UPDATE private.notification_outbox SET attempts=8 WHERE id='{job['id']}';")
        self.assertEqual(self.finish(job,True),'FAILED')
        status=self.call('fn_admin_notification_jobs',"'user_admin'"); self.assertEqual(status['failed'],1)
        self.assertNotIn('subscription',json.dumps(status)); self.assertNotIn('payload',json.dumps(status))
        self.sql("SET ROLE service_role; SELECT public.fn_admin_notification_jobs('user_assigned');",error='42501')
        self.sql(f"SET ROLE service_role; SELECT public.fn_admin_notification_jobs('user_admin','{job['id']}',7);",error='40001')
        self.call('fn_admin_notification_jobs',f"'user_admin','{job['id']}',8")
        self.assertEqual(self.sql(f"SELECT attempts||':'||(failed_at IS NULL) FROM private.notification_outbox WHERE id='{job['id']}'"),'0:true')

    def test_bill_request_is_durable_unique_and_skips_after_close(self):
        self.sql(f"UPDATE public.table_sessions SET status='REQUEST_BILL' WHERE id='{SESSION}'; UPDATE public.table_sessions SET status='REQUEST_BILL' WHERE id='{SESSION}';")
        self.assertEqual(self.sql("SELECT count(*) FROM private.notification_outbox WHERE kind='BILL_REQUESTED'"),'1')
        primary=self.claim(); self.finish(primary,True)
        job=self.claim(); self.assertEqual(job['kind'],'BILL_REQUESTED'); self.assertEqual(self.prepare(job)['target']['staffId'],'user_assigned')
        self.sql(f"UPDATE public.table_sessions SET status='CLOSED' WHERE id='{SESSION}'")
        self.assertIsNone(self.prepare(job)['target'])

    def test_subscription_rpc_rechecks_role_and_stale_unsubscribe_does_not_clear_new_device(self):
        self.sql("SET ROLE service_role; SELECT public.fn_set_push_subscription('user_assigned',NULL,'old-endpoint');")
        self.assertEqual(self.sql("SELECT push_subscription IS NOT NULL FROM public.staff_profiles WHERE id='user_assigned'"),'t')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_assigned'")
        self.sql("SET ROLE service_role; SELECT public.fn_set_push_subscription('user_assigned',NULL,'old-endpoint');",error='42501')

    def test_expired_eighth_crash_becomes_visible_and_non_push_events_do_not_block(self):
        self.sql(f"INSERT INTO private.notification_outbox(dedupe_key,session_id,kind,payload) VALUES ('ignore','{SESSION}','SESSION_UPDATED','{{}}');")
        job=self.claim(); self.sql(f"UPDATE private.notification_outbox SET attempts=8,locked_until=now()-interval '1 second' WHERE id='{job['id']}';")
        self.assertIsNone(self.claim()); status=self.call('fn_admin_notification_jobs',"'user_admin'")
        self.assertEqual(status['failed'],1)
        self.assertEqual(self.sql("SELECT outcome FROM private.notification_outbox WHERE dedupe_key='ignore'"),'SKIPPED')

    def test_bill_notification_enqueue_failure_rolls_back_status(self):
        self.sql("CREATE FUNCTION public.test_bill_enqueue_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='BILL_REQUESTED' THEN RAISE EXCEPTION 'fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_bill_enqueue_fault BEFORE INSERT ON private.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.test_bill_enqueue_fault();")
        try:
            self.sql(f"UPDATE public.table_sessions SET status='REQUEST_BILL' WHERE id='{SESSION}';",error='P0001')
            self.assertEqual(self.sql(f"SELECT status FROM public.table_sessions WHERE id='{SESSION}'"),'ACTIVE')
            self.assertEqual(self.sql("SELECT count(*) FROM private.notification_outbox WHERE kind='BILL_REQUESTED'"),'0')
        finally:
            self.sql('DROP TRIGGER test_bill_enqueue_fault ON private.notification_outbox; DROP FUNCTION public.test_bill_enqueue_fault();')


if __name__=='__main__': unittest.main(verbosity=2)
