"""Full manual takeaway lifecycle in a new loopback-only test cluster."""
import concurrent.futures
import json
import unittest
import uuid
import staff_rpc_test as db
import manual_payment_test as manual
from dine_in_rpc_test import FOOD,BEER,INGREDIENT,line
TOKEN='a'*64
OP='b0000000-0000-4000-8000-000000000001'

class TakeawayRpcTest(db.PostgresTestCase):
 def setUp(self):
  manual.ManualPaymentTest.setUp(self)
  self.sql('TRUNCATE public.table_sessions CASCADE;')

 # Shared fixture setup only; these methods call shipped RPCs, not copied rules.
 pending=manual.ManualPaymentTest.pending
 def create_sql(self,token=TOKEN,op=OP,phone='0912345678',lines=None,**extra):
  command=dict(customerName='Test customer',customerPhone=phone,lines=lines if lines is not None else [line(),line(BEER,3,20)]);command.update(extra)
  return f"SELECT public.fn_create_takeaway('{token}','{op}',{db.literal(json.dumps(command))}::jsonb);"
 def create(self,**kwargs):return json.loads(self.sql('SET ROLE service_role;'+self.create_sql(**kwargs)).splitlines()[-1])
 def pay(self,session):
  return json.loads(self.sql('SET ROLE service_role;'+manual.ManualPaymentTest.command(self,session=session,op=str(uuid.uuid4()))).splitlines()[-1])
 def pickup(self,session,op=None,actor='user_staff',error=None):
  return self.sql(f"SET ROLE service_role; SELECT public.fn_pickup_takeaway('{actor}','{op or uuid.uuid4()}','{session}');",error=error)

 def test_create_is_atomic_pending_and_does_not_touch_stock_queue_or_outbox(self):
  result=self.create();self.assertEqual(result['totalAmount'],160);self.assertEqual(result['status'],'PENDING_PAYMENT')
  self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients;'),'10')
  self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs;'),'0');self.assertEqual(self.sql('SELECT count(*) FROM private.notification_outbox;'),'0')
  self.assertEqual(self.sql("SELECT count(*) FROM public.order_items WHERE station='BAR_INSTANT' AND status='READY' AND ready_at IS NULL;"),'1')
  self.assertEqual(self.sql("SELECT unit_price||':'||unit_cost_price FROM public.order_items WHERE station='BAR_INSTANT';"),'20:13')
  self.assertNotIn(TOKEN,self.sql('SELECT result::text||request_hash||scope_key FROM private.operation_requests;'))
  self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests WHERE session_id IS NOT NULL;'),'0')

 def test_replay_and_capability_lookup_do_not_create_another_order(self):
  first=self.create();self.sql(f"UPDATE public.menu_items SET price=999 WHERE id='{FOOD}';")
  self.assertEqual(self.create(),first)
  found=json.loads(self.sql(f"SELECT public.fn_get_takeaway_create('{TOKEN}','{OP}');"));self.assertEqual(found,first)
  self.assertEqual(self.sql(f"SELECT public.fn_get_takeaway_create('{'b'*64}','{OP}');"),'')
  self.sql(self.create_sql(customerName='changed'),error='22000')
  self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions;'),'1')

 def test_snapshot_only_returns_own_display_data_including_closed_history(self):
  first=self.create();snapshot=json.loads(self.sql(f"SELECT public.fn_get_takeaway_snapshot('{TOKEN}');"))
  self.assertEqual(snapshot['sessionId'],first['sessionId']);self.assertEqual(len(snapshot['items']),2)
  for secret in ['customerPhone','customerName','unit_cost_price','confirmedBy',TOKEN,'user_staff','stock_export_log_id']:
   self.assertNotIn(secret,json.dumps(snapshot))
  self.sql(f"SELECT public.fn_get_takeaway_snapshot('{'b'*64}');",error='P0002')
  self.sql(f"UPDATE public.table_sessions SET status='CLOSED',closed_at=clock_timestamp() WHERE id='{first['sessionId']}';")
  self.assertEqual(json.loads(self.sql(f"SELECT public.fn_get_takeaway_snapshot('{TOKEN}');"))['status'],'CLOSED')

 def test_invalid_recipient_spoofed_fields_price_and_unavailable_menu_roll_back(self):
  for kwargs in [dict(phone='123'),dict(customerName='A'),dict(actor='user_admin'),dict(token='short'),dict(lines=[line(qty=0)])]:self.sql(self.create_sql(**kwargs),error='22023')
  self.sql(self.create_sql(lines=[line(price=1)]),error='P1003')
  self.sql(f"UPDATE public.menu_items SET is_available=false WHERE id='{FOOD}';")
  self.sql(self.create_sql(),error='P1002');self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests;'),'0');self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions;'),'0')

 def test_durable_phone_quota_and_global_pending_quota(self):
  self.create();self.create(token='b'*64,op=str(uuid.uuid4()))
  self.sql(self.create_sql(token='c'*64,op=str(uuid.uuid4())),error='P1504')
  self.sql("UPDATE public.table_sessions SET opened_at=clock_timestamp()-interval '11 minutes';")
  self.create(token='c'*64,op=str(uuid.uuid4()))
  self.sql("UPDATE public.table_sessions SET opened_at=clock_timestamp()-interval '11 minutes';")
  self.sql(self.create_sql(token='d'*64,op=str(uuid.uuid4())),error='P1504')
  self.sql("INSERT INTO public.table_sessions(session_token,session_type,status,total_amount) SELECT 'quota-fixture-'||i,'TAKEAWAY','PENDING_PAYMENT',100 FROM generate_series(1,97)i;")
  self.sql(self.create_sql(token='e'*64,op=str(uuid.uuid4()),phone='0987654321'),error='P1504')

 def test_same_operation_concurrent_retries_have_one_order(self):
  def run(_):return json.loads(self.sql(self.create_sql()))
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(run,range(4)))
  self.assertTrue(all(value==results[0] for value in results));self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions;'),'1')

 def test_pickup_requires_receipt_and_all_items_ready_then_closes_once(self):
  session=self.create()['sessionId'];self.pickup(session,error='P1501');self.pay(session);self.pickup(session,error='P1305')
  self.sql(f"UPDATE public.order_items SET status='READY',cooking_started_at=clock_timestamp(),ready_at=clock_timestamp() WHERE session_id='{session}' AND station='KITCHEN';")
  listed=json.loads(self.sql("SELECT public.fn_takeaway_pickup_list('user_staff');"));self.assertEqual(listed['rows'][0]['sessionId'],session)
  op=str(uuid.uuid4());first=self.pickup(session,op=op);self.assertEqual(self.pickup(session,op=op),first)
  self.assertEqual(self.sql('SELECT status FROM public.table_sessions;'),'CLOSED')
  self.assertEqual(self.sql("SELECT count(*) FROM public.order_items WHERE status='SERVED' AND served_at>=ready_at AND served_by_staff_id='user_staff';"),'2')
  self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs;'),'1');self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients;'),'7')
  self.pickup(session,error='P1501')
  self.assertEqual(json.loads(self.sql("SELECT public.fn_takeaway_pickup_list('user_staff');"))['rows'],[])

 def test_pickup_actor_and_public_function_grants_are_rechecked(self):
  session=self.create()['sessionId'];self.pickup(session,actor='user_kitchen',error='42501')
  for role in ['anon','authenticated']:
   self.sql(f'SET ROLE {role};'+self.create_sql(),error='42501')
   self.sql(f"SET ROLE {role}; SELECT public.fn_get_takeaway_snapshot('{TOKEN}');",error='42501')
   self.sql(f"SET ROLE {role}; SELECT public.fn_takeaway_pickup_list('user_staff');",error='42501')
  self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff';")
  self.pickup(session,error='42501')

 def test_bootstrap_matches_upgrade_and_snapshot_stays_read_only(self):
  for signature in ['fn_create_takeaway(text,uuid,jsonb)','fn_get_takeaway_snapshot(text)','fn_pickup_takeaway(text,uuid,uuid)']:
   query=f"SELECT pg_get_functiondef('public.{signature}'::regprocedure);";self.assertEqual(self.sql(query),self.sql(query,db='bootstrap_check'))

if __name__=='__main__':unittest.main(verbosity=2)
