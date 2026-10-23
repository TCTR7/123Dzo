"""Manual receipt/actor audit on a disposable cluster; never banking or app DB."""
import concurrent.futures
import json
import unittest
import uuid
import staff_rpc_test as db
from dine_in_rpc_test import SESSION,SECOND,FOOD,BEER,INGREDIENT

OP='90000000-0000-4000-8000-000000000001'

class ManualPaymentTest(db.PostgresTestCase):
 def setUp(self):
  self.sql('TRUNCATE public.staff_profiles,public.menu_items,public.ingredients,public.tables CASCADE;')
  self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_staff','Original staff','staff'),('user_admin','Admin','admin'),('user_kitchen','Kitchen','kitchen');")
  self.sql(f"INSERT INTO public.ingredients(id,name,unit,stock_quantity,unit_cost) VALUES ('{INGREDIENT}','Beer','can',10,12);")
  self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES ('{FOOD}','Food','FOOD','KITCHEN',100,40);")
  self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price,linked_ingredient_id) VALUES ('{BEER}','Beer','BEER','BAR_INSTANT',20,13,'{INGREDIENT}');")
  self.pending(SESSION)

 def pending(self,session):
  self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status,total_amount) VALUES ('{session}','fixture-{session}','TAKEAWAY','PENDING_PAYMENT',160);")
  self.sql(f"INSERT INTO public.order_items(session_id,menu_item_id,quantity,station,status,unit_price,unit_cost_price) VALUES ('{session}','{FOOD}',1,'KITCHEN','QUEUED',100,40),('{session}','{BEER}',3,'BAR_INSTANT','READY',20,13);")

 def command(self,actor='user_staff',op=OP,session=SESSION,**changes):
  body=dict(sessionId=session,expectedTotal=160,paymentMethod='VIETQR',reference='tcb-123',confirmedReceived=True);body.update(changes)
  return f"SELECT public.fn_confirm_manual_payment({db.literal(actor)},'{op}',{db.literal(json.dumps(body))}::jsonb);"

 def confirm(self,**kwargs):return json.loads(self.sql('SET ROLE service_role;'+self.command(**kwargs)).splitlines()[-1])
 def status(self,actor='user_admin',pending=1,history=1):return json.loads(self.sql(f"SET ROLE service_role; SELECT public.fn_manual_payment_status('{actor}',{pending},{history});").splitlines()[-1])

 def test_atomic_activation_snapshot_stock_timestamps_and_audit(self):
  before=self.sql('SELECT string_agg(created_at::text,\',\' ORDER BY id) FROM public.order_items;')
  result=self.confirm()
  self.assertEqual(result['confirmedBy'],'user_staff');self.assertEqual(result['confirmedByName'],'Original staff');self.assertEqual(result['reference'],'TCB-123')
  self.assertEqual(result['statusAfter'],'ACTIVE');self.assertEqual(result['amount'],160)
  self.assertEqual(self.sql('SELECT assigned_staff_id FROM public.table_sessions;'),'user_staff')
  self.assertEqual(self.sql('SELECT status||\':\'||(activated_at IS NOT NULL)||\':\'||payment_method FROM public.table_sessions;'),'ACTIVE:true:VIETQR')
  self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients;'),'7')
  self.assertEqual(self.sql('SELECT quantity_change||\':\'||total_cost FROM public.inventory_logs;'),'-3:36')
  self.assertEqual(self.sql("SELECT count(*) FROM public.order_items WHERE station='BAR_INSTANT' AND status='READY' AND ready_at IS NOT NULL AND stock_export_log_id IS NOT NULL;"),'1')
  self.assertEqual(self.sql("SELECT unit_price||':'||unit_cost_price FROM public.order_items WHERE station='BAR_INSTANT';"),'20:13')
  self.assertEqual(self.sql('SELECT count(*) FROM private.notification_outbox;'),'2')
  self.assertEqual(self.sql('SELECT string_agg(created_at::text,\',\' ORDER BY id) FROM public.order_items;'),before)
  history=self.status()['history'];self.assertEqual(len(history),1);self.assertEqual(history[0]['confirmedBy'],'user_staff')
  self.assertNotIn('session_token',json.dumps(history));self.assertNotIn('unit_cost_price',json.dumps(history))

 def test_replay_preserves_original_actor_name_time_and_does_not_reexport(self):
  first=self.confirm();self.sql("UPDATE public.staff_profiles SET full_name='Renamed' WHERE id='user_staff';")
  self.assertEqual(self.confirm(),first)
  self.assertEqual(self.status()['history'][0]['confirmedByName'],'Original staff')
  self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs;'),'1')
  self.sql(self.command(reference='other'),error='22000')

 def test_unpaid_draft_is_not_ready_work_or_missing_export_error(self):
  self.assertEqual(self.sql("SELECT count(*) FROM public.order_items oi JOIN public.table_sessions s ON s.id=oi.session_id WHERE s.status IN ('ACTIVE','REQUEST_BILL');"),'0')
  checks=json.loads(self.sql("SELECT public.fn_admin_data_health('user_admin');"))['checks']
  self.assertTrue(all(row['count']==0 for row in checks))
  self.confirm()
  checks=json.loads(self.sql("SELECT public.fn_admin_data_health('user_admin');"))['checks']
  self.assertTrue(all(row['count']==0 for row in checks))

 def test_public_kitchen_and_inactive_cannot_confirm_or_read_audit(self):
  for role in ['anon','authenticated']:
   self.sql(f'SET ROLE {role};'+self.command(),error='42501')
   self.sql(f"SET ROLE {role}; SELECT public.fn_manual_payment_status('user_admin');",error='42501')
  self.sql(self.command(actor='user_kitchen'),error='42501')
  self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff';")
  self.sql(self.command(),error='42501')
  self.sql("SELECT public.fn_manual_payment_status('user_staff');",error='42501')

 def test_wrong_amount_or_missing_evidence_rolls_back_all(self):
  for changes in [dict(expectedTotal=159),dict(expectedTotal=161)]:self.sql(self.command(**changes),error='P1306')
  for changes in [dict(confirmedReceived=False),dict(reference=' '),dict(expectedTotal=0),dict(paymentMethod='CASH',reference='not-empty'),dict(actorId='user_admin')]:self.sql(self.command(**changes),error='22023')
  self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests;'),'0')
  self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients;'),'10')
  self.assertEqual(self.sql('SELECT count(*) FROM private.notification_outbox;'),'0')

 def test_no_stock_keeps_pending_without_false_receipt(self):
  self.sql('UPDATE public.ingredients SET stock_quantity=2;');self.sql(self.command(),error='P1004')
  self.assertEqual(self.sql('SELECT status FROM public.table_sessions;'),'PENDING_PAYMENT')
  self.assertEqual(len(self.status()['history']),0)
  self.sql('UPDATE public.ingredients SET stock_quantity=5;');self.confirm()
  self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients;'),'2')

 def test_bank_reference_cannot_pay_two_orders_even_with_case_or_whitespace_changes(self):
  self.confirm();self.pending(SECOND)
  self.sql(self.command(session=SECOND,op=str(uuid.uuid4()),reference=' TCB- 123 '),error='23505')
  self.assertEqual(self.sql(f"SELECT status FROM public.table_sessions WHERE id='{SECOND}';"),'PENDING_PAYMENT')
  self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients;'),'7')
  self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs;'),'1')

 def test_two_operators_confirming_same_order_have_one_winner(self):
  def run(actor):
   return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At','-f','-',input_text='SET ROLE service_role;'+self.command(actor=actor,op=str(uuid.uuid4())),check=False)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(run,['user_staff','user_admin']))
  self.assertEqual(sum(row.returncode==0 for row in results),1)
  self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs;'),'1')
  self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests;'),'1')

 def test_cash_confirmation_and_cross_actor_recovery_are_scoped(self):
  self.confirm(paymentMethod='CASH',reference='')
  self.assertEqual(self.sql(f"SELECT public.fn_get_manual_payment_operation('user_admin','{OP}');"),'')
  result=json.loads(self.sql(f"SELECT public.fn_get_manual_payment_operation('user_staff','{OP}');"));self.assertEqual(result['paymentMethod'],'CASH')
  self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff';")
  self.sql(f"SELECT public.fn_get_manual_payment_operation('user_staff','{OP}');",error='42501')

 def test_invalid_pending_items_and_mappings_are_not_silently_repaired(self):
  self.sql("UPDATE public.order_items SET ready_at=clock_timestamp() WHERE station='BAR_INSTANT';")
  self.sql(self.command(),error='P1503');self.sql('UPDATE public.order_items SET ready_at=NULL;')
  self.sql(f"UPDATE public.menu_items SET is_available=false WHERE id='{FOOD}';")
  self.sql(self.command(),error='P1503');self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests;'),'0')

 def test_fault_after_stock_before_audit_rolls_back_every_effect(self):
  self.sql("CREATE FUNCTION public.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture fault'; END $$; CREATE TRIGGER fail_receipt BEFORE UPDATE OF activated_at ON public.table_sessions FOR EACH ROW EXECUTE FUNCTION public.fail_receipt();")
  try:self.sql(self.command(),error='P0001')
  finally:self.sql('DROP TRIGGER fail_receipt ON public.table_sessions; DROP FUNCTION public.fail_receipt();')
  self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs;'),'0');self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients;'),'10')
  self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests;'),'0');self.assertEqual(self.sql('SELECT count(*) FROM private.notification_outbox;'),'0')
  self.confirm()

 def test_pending_history_pagination_and_closed_never_reopens(self):
  self.confirm();self.sql(f"UPDATE public.table_sessions SET status='CLOSED',closed_at=clock_timestamp() WHERE id='{SESSION}';")
  self.assertEqual(self.confirm()['statusAfter'],'ACTIVE') # immutable replay, not current state
  self.assertEqual(self.sql('SELECT status FROM public.table_sessions;'),'CLOSED')
  self.sql(self.command(op=str(uuid.uuid4()),reference='TCB-SECOND'),error='23505')
  self.sql("INSERT INTO public.table_sessions(session_token,session_type,status,total_amount) SELECT 'fixture-'||i,'TAKEAWAY','PENDING_PAYMENT',100 FROM generate_series(1,30) i;")
  first=self.status();self.assertEqual(len(first['pending']),25);self.assertTrue(first['pendingHasMore'])
  second=self.status(pending=2);self.assertEqual(len(second['pending']),5);self.assertFalse(second['pendingHasMore'])
  self.sql("SELECT public.fn_manual_payment_status('user_admin',0,1);",error='22023')

if __name__=='__main__':unittest.main(verbosity=2)
