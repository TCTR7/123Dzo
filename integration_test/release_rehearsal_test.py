"""Read-only reconciliation and backup/restore of an isolated fixture only."""
import json
import concurrent.futures
import time
import unittest
import uuid
import staff_rpc_test as db
from dine_in_rpc_test import SESSION,FOOD,BEER,INGREDIENT,line,order

class ReleaseRehearsalTest(db.PostgresTestCase):
 def setUp(self):
  self.sql('TRUNCATE public.staff_profiles,public.menu_items,public.table_sessions CASCADE;')
  self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_admin','Admin','admin'),('user_staff','Staff','staff');")
  self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES ('{FOOD}','Food','FOOD','KITCHEN',100,40);")
  self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status) VALUES ('{SESSION}','test-only-capability-one','DINE_IN','ACTIVE');")

 def health(self):return json.loads(self.sql("SET ROLE service_role; SELECT public.fn_admin_data_health('user_admin');").splitlines()[-1])

 def test_health_reports_counts_without_rows_or_repairs(self):
  self.sql(order(token='test-only-capability-one'))
  self.sql(f"UPDATE public.table_sessions SET total_amount=999 WHERE id='{SESSION}'; UPDATE public.order_items SET status='SERVED';")
  before=self.sql('SELECT total_amount FROM public.table_sessions;')
  result=self.health();checks={row['code']:row['count'] for row in result['checks']}
  self.assertEqual(checks['BILL_TOTAL_MISMATCH'],1);self.assertEqual(checks['MISSING_KPI_TIMESTAMPS'],1)
  self.assertEqual(self.sql('SELECT total_amount FROM public.table_sessions;'),before)
  for secret in [SESSION,'test-only-capability-one','user_admin','unit_cost_price','session_token']:
   self.assertNotIn(secret,json.dumps(result))

 def test_health_requires_current_admin_at_both_db_and_grants(self):
  for role in ['anon','authenticated']:
   self.sql(f"SET ROLE {role}; SELECT public.fn_admin_data_health('user_admin');",error='42501')
  self.sql("SET ROLE service_role; SELECT public.fn_admin_data_health('user_staff');",error='42501')
  self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_admin';")
  self.sql("SET ROLE service_role; SELECT public.fn_admin_data_health('user_admin');",error='42501')

 def test_backup_restore_keeps_ledger_and_function_boundaries(self):
  self.sql(order(token='test-only-capability-one'))
  backup=self.workspace/'fixture.dump'
  self.cli('pg_dump','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-Fc','-f',backup,'postgres')
  self.sql('CREATE DATABASE rehearsal_restore;')
  self.cli('pg_restore','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','--exit-on-error','--no-owner','-d','rehearsal_restore',backup)
  for query in ['SELECT count(*) FROM public.order_items;', 'SELECT count(*) FROM private.operation_requests;',
    "SELECT has_function_privilege('anon','public.fn_submit_dine_in_order(uuid,text,text,uuid,jsonb)','EXECUTE');"]:
   self.assertEqual(self.sql(query),self.sql(query,db='rehearsal_restore'))
  self.assertEqual(self.sql('SELECT total_amount FROM public.table_sessions;',db='rehearsal_restore'),'100')
  self.sql('DROP DATABASE rehearsal_restore;')

 def test_concurrent_tables_retries_batch_returns_and_cash_reconcile(self):
  """Synthetic 12-table rehearsal, not a hosting/Free Tier performance promise."""
  self.sql('TRUNCATE public.table_sessions,public.tables,public.ingredients CASCADE;')
  self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES ('{FOOD}','Food','FOOD','KITCHEN',100,40);")
  self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_kitchen','Kitchen','kitchen');")
  self.sql(f"INSERT INTO public.ingredients(id,name,unit,stock_quantity,unit_cost) VALUES ('{INGREDIENT}','Beer','can',200,13);")
  self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price,linked_ingredient_id) VALUES ('{BEER}','Beer','BEER','BAR_INSTANT',20,13,'{INGREDIENT}');")
  tables=[str(uuid.uuid4()) for _ in range(12)]
  self.sql(f"INSERT INTO public.zones(id,name) VALUES ('{db.ZONE}','Rehearsal') ON CONFLICT DO NOTHING;")
  self.sql('INSERT INTO public.tables(id,table_number,zone_id) VALUES '+','.join(f"('{table}','T{i+1}','{db.ZONE}')" for i,table in enumerate(tables)))

  # Exercise the production fanout trigger against an isolated managed-service peer.
  # This records generic signals only, and does not assert Supabase delivery.
  self.sql('''CREATE SCHEMA realtime;
   CREATE TABLE realtime.messages(payload jsonb,event text,topic text,private boolean);
   CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages VALUES ($1,$2,$3,$4) $$;''')
  try:
   def action(name,body,actor='user_staff'):
    command=f"SELECT public.fn_session_action({db.literal(actor)},NULL,'{uuid.uuid4()}',{db.literal(name)},{db.literal(json.dumps(body))}::jsonb);"
    return json.loads(self.sql('SET ROLE service_role;'+command).splitlines()[-1])

   with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    sessions=list(pool.map(lambda table:action('OPEN',dict(tableId=table))['sessionId'],tables))
   tokens=json.loads(self.sql('SELECT jsonb_object_agg(id,session_token) FROM public.table_sessions;'))
   self.sql('TRUNCATE realtime.messages;')
   commands=[order([line(note=f'device-{device}'),line(BEER,1,20)],
     session=session,token=tokens[session],op=str(uuid.uuid4()))
     for session in sessions for device in range(2)]

   def measured(statement):
    start=time.perf_counter()
    result=json.loads(self.sql('SET ROLE service_role;'+statement).splitlines()[-1])
    return result,time.perf_counter()-start

   # Every logical order is retried concurrently with the exact same identity.
   with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    measurements=list(pool.map(measured,commands+commands))
   for i in range(24):self.assertEqual(measurements[i][0],measurements[i+24][0])
   self.assertEqual(self.sql('SELECT count(*) FROM public.order_items;'),'48')
   self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='dine_in.order';"),'24')
   self.assertEqual(self.sql(f"SELECT stock_quantity FROM public.ingredients WHERE id='{INGREDIENT}';"),'176')
   self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions WHERE total_amount=240;'),'12')
   self.assertEqual(self.sql("SELECT count(*) FROM public.order_items WHERE station='BAR_INSTANT' AND status='READY' AND ready_at IS NOT NULL;"),'24')
   self.assertEqual(self.sql("SELECT count(DISTINCT topic) FROM realtime.messages;"),'15')
   self.assertEqual(self.sql("SELECT bool_and(private AND event='invalidate' AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(payload) k)=ARRAY['id','v']) FROM realtime.messages;"),'t')

   def transition(name,condition,actor):
    items=json.loads(self.sql("SELECT jsonb_agg(jsonb_build_object('id',id,'sessionId',session_id,'expectedStatus',status,'expectedQuantity',quantity) ORDER BY id) FROM public.order_items WHERE "+condition))
    def submit(portions):
     body=dict(action=name,items=portions,reason='')
     return json.loads(self.sql(f"SET ROLE service_role; SELECT public.fn_transition_order_items({db.literal(actor)},'{uuid.uuid4()}',{db.literal(json.dumps(body))}::jsonb);").splitlines()[-1])
    if name=='SERVE':
     # Serving is one portion per action, matching the shipped Staff UI/RPC.
     with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
      return list(pool.map(lambda item:submit([item]),items))
    return submit(items)

   transition('START',"station='KITCHEN'",'user_kitchen')
   self.assertEqual(self.sql("SELECT count(DISTINCT batch_id) FROM public.order_items WHERE station='KITCHEN';"),'1')
   transition('READY',"station='KITCHEN'",'user_kitchen')
   # Staff handle individual portions concurrently, preserving each note.
   for station in ['KITCHEN','BAR_INSTANT']:transition('SERVE',f"station='{station}'",'user_staff')
   self.assertEqual(self.sql("SELECT count(*) FROM public.order_items WHERE served_by_staff_id='user_staff' AND ready_at<=served_at AND (station='BAR_INSTANT' OR cooking_started_at<=ready_at);"),'48')
   self.assertEqual(self.sql("SELECT count(DISTINCT note) FROM public.order_items WHERE station='KITCHEN';"),'2')

   # Return one unused beer per table. The original export/cost snapshot is used.
   beers=json.loads(self.sql(f"SELECT jsonb_agg(x) FROM (SELECT DISTINCT ON(session_id) id,session_id FROM public.order_items WHERE menu_item_id='{BEER}' ORDER BY session_id,id) x;"))
   for beer in beers:
    body=dict(orderItemId=beer['id'],quantity=1,expectedQuantity=1,confirmedUnused=True)
    self.sql(f"SET ROLE service_role; SELECT public.fn_return_beer('user_staff','{beer['session_id']}','{uuid.uuid4()}',{db.literal(json.dumps(body))}::jsonb);")
   with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(lambda session:action('REQUEST_BILL',dict(sessionId=session,paymentMethod='CASH')),sessions))
    list(pool.map(lambda session:action('CLOSE',dict(sessionId=session,paymentMethod='CASH',expectedTotal=220,confirmedReceived=True)),sessions))
   self.assertEqual(self.sql("SELECT count(*) FROM public.tables WHERE status='AVAILABLE' AND current_session_id IS NULL;"),'12')
   self.assertEqual(self.sql("SELECT count(*) FROM public.table_sessions WHERE status='CLOSED' AND total_amount=220;"),'12')
   self.assertEqual(self.sql(f"SELECT stock_quantity=200+(SELECT sum(quantity_change) FROM public.inventory_logs) FROM public.ingredients WHERE id='{INGREDIENT}';"),'t')
   self.assertEqual(self.sql("SELECT sum(total_cost) FROM public.inventory_logs WHERE type='RETURN_BEER';"),'156')
   self.assertEqual(self.sql('SELECT gross_revenue FROM public.vw_kpi_financial_summary;'),'2640')
   self.assertTrue(all(check['count']==0 for check in self.health()['checks']))
   durations=sorted(value[1]*1000 for value in measurements)
   print(f'Fixture rehearsal: 12 tables, 48 concurrent/replayed calls, p50={durations[len(durations)//2]:.0f}ms, p95={durations[int(len(durations)*.95)-1]:.0f}ms (includes local psql startup; fsync off; not staging latency).')
  finally:
   self.sql('DROP SCHEMA realtime CASCADE;')

if __name__=='__main__':unittest.main(verbosity=2)
