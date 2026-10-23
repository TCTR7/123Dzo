"""Table lifecycle transactions on an isolated local PostgreSQL cluster."""
import concurrent.futures
import json
import unittest
import uuid
import staff_rpc_test as dbtest

TABLE='70000000-0000-4000-8000-000000000001'
TARGET='70000000-0000-4000-8000-000000000002'
MENU='20000000-0000-4000-8000-000000000001'


class SessionRpcTest(dbtest.PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.staff_profiles,public.tables,public.zones,public.menu_items CASCADE;')
        self.sql("INSERT INTO public.zones(id,name) VALUES('11111111-1111-4111-8111-111111111111','Test zone');"
                 "INSERT INTO public.staff_profiles(id,full_name,role) VALUES('user_staff','Staff','staff'),('user_admin','Admin','admin'),('user_kitchen','Kitchen','kitchen');")
        self.sql(f"INSERT INTO public.tables(id,table_number,zone_id) VALUES('{TABLE}','T1','11111111-1111-4111-8111-111111111111'),('{TARGET}','T2','11111111-1111-4111-8111-111111111111');")
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES('{MENU}','Food','FOOD','KITCHEN',100,40) ON CONFLICT DO NOTHING;")

    def command(self,action,body,op=None,actor='user_staff',token=None):
        actor_sql='NULL' if actor is None else dbtest.literal(actor)
        token_sql='NULL' if token is None else dbtest.literal(token)
        return f"SELECT public.fn_session_action({actor_sql},{token_sql},'{op or uuid.uuid4()}',{dbtest.literal(action)},{dbtest.literal(json.dumps(body))}::jsonb);"

    def execute(self,action,body,**kwargs):
        return json.loads(self.sql('SET ROLE service_role;'+self.command(action,body,**kwargs)).splitlines()[-1])

    def raw(self,statement):
        return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1',
                        '-v','VERBOSITY=verbose','-At','-f','-',check=False,input_text='SET ROLE service_role;'+statement)

    def open(self):
        return self.execute('OPEN',dict(tableId=TABLE))['sessionId']

    def add(self,session,status='SERVED',quantity=1,count=1):
        self.sql(f"INSERT INTO public.order_items(session_id,menu_item_id,quantity,station,status,unit_price,unit_cost_price) SELECT '{session}','{MENU}',{quantity},'KITCHEN','{status}',100,40 FROM generate_series(1,{count});")

    def test_bootstrap_parity(self):
        for function in ('fn_session_action(text,text,uuid,text,jsonb)','fn_get_session_action_operation(text,text,uuid,uuid)'):
            query=f"SELECT pg_get_functiondef('public.{function}'::regprocedure)"
            self.assertEqual(self.sql(query),self.sql(query,db='bootstrap_check'))

    def test_open_atomic_replay_and_strong_token_not_in_saved_result(self):
        op=str(uuid.uuid4()); body=dict(tableId=TABLE)
        first=self.execute('OPEN',body,op=op)
        self.assertEqual(self.execute('OPEN',body,op=op),first)
        self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions'),'1')
        self.assertEqual(self.sql(f"SELECT status||':'||(current_session_id='{first['sessionId']}') FROM public.tables WHERE id='{TABLE}'"),'OCCUPIED:true')
        self.assertEqual(self.sql('SELECT length(session_token) FROM public.table_sessions'),'64')
        self.assertNotIn('session_token',json.dumps(first))
        self.assertNotIn(self.sql('SELECT session_token FROM public.table_sessions'),self.sql('SELECT result FROM private.operation_requests'))

    def test_two_staff_opening_same_table_create_only_one_session(self):
        commands=[self.command('OPEN',dict(tableId=TABLE),actor=actor) for actor in ('user_staff','user_admin')]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(self.raw,commands))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertTrue(any('P1301:' in r.stderr for r in results))
        self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions'),'1')

    def test_transfer_keeps_token_assignment_and_releases_only_source(self):
        session=self.open(); before=self.sql('SELECT session_token||assigned_staff_id FROM public.table_sessions')
        result=self.execute('TRANSFER',dict(sessionId=session,expectedTableId=TABLE,targetTableId=TARGET))
        self.assertEqual(result['tableId'],TARGET)
        self.assertEqual(self.sql('SELECT session_token||assigned_staff_id FROM public.table_sessions'),before)
        self.assertEqual(self.sql(f"SELECT status||':'||(current_session_id IS NULL) FROM public.tables WHERE id='{TABLE}'"),'AVAILABLE:true')
        self.assertEqual(self.sql(f"SELECT current_session_id FROM public.tables WHERE id='{TARGET}'"),session)

    def test_transfer_occupied_and_stale_source_roll_back(self):
        session=self.open(); self.execute('OPEN',dict(tableId=TARGET),actor='user_admin')
        self.sql(self.command('TRANSFER',dict(sessionId=session,expectedTableId=TABLE,targetTableId=TARGET)),error='P1301')
        self.sql(self.command('TRANSFER',dict(sessionId=session,expectedTableId=TARGET,targetTableId=TABLE)),error='P1302')
        self.assertEqual(self.sql(f"SELECT table_id FROM public.table_sessions WHERE id='{session}'"),TABLE)

    def test_handover_checks_expected_and_active_role(self):
        session=self.open()
        self.sql(self.command('HANDOVER',dict(sessionId=session,expectedAssignedStaffId='user_staff',assignedStaffId='user_kitchen')),error='P1303')
        self.execute('HANDOVER',dict(sessionId=session,expectedAssignedStaffId='user_staff',assignedStaffId='user_admin'))
        self.sql(self.command('HANDOVER',dict(sessionId=session,expectedAssignedStaffId='user_staff',assignedStaffId='user_admin')),error='P1302')

    def test_customer_bill_validates_capability_and_computes_all_rows(self):
        session=self.open(); self.add(session,count=510)
        token=self.sql('SELECT session_token FROM public.table_sessions')
        body=dict(sessionId=session,paymentMethod='CASH')
        self.sql(self.command('REQUEST_BILL',body,actor=None,token='wrong'),error='42501')
        result=self.execute('REQUEST_BILL',body,actor=None,token=token)
        self.assertEqual(result['totalAmount'],51000); self.assertEqual(result['status'],'REQUEST_BILL')
        self.sql(self.command('REQUEST_BILL',body,actor=None,token=token),error='P1304')
        self.sql(self.command('CLOSE',dict(sessionId=session,paymentMethod='CASH',expectedTotal=51000,confirmedReceived=True),actor=None,token=token),error='42501')

    def test_close_ignores_truncated_cached_total_and_requires_confirmation(self):
        session=self.open(); self.add(session,count=510)
        body=dict(sessionId=session,paymentMethod='CASH',expectedTotal=30000,confirmedReceived=True)
        self.sql(self.command('CLOSE',body),error='P1306')
        self.sql(self.command('CLOSE',{**body,'expectedTotal':51000,'confirmedReceived':False}),error='22023')
        result=self.execute('CLOSE',{**body,'expectedTotal':51000})
        self.assertEqual(result['totalAmount'],51000); self.assertEqual(result['status'],'CLOSED')
        self.assertEqual(self.sql('SELECT closed_at IS NOT NULL FROM public.table_sessions'),'t')
        self.assertEqual(self.sql(f"SELECT status||':'||(current_session_id IS NULL) FROM public.tables WHERE id='{TABLE}'"),'AVAILABLE:true')

    def test_close_blocks_unserved_positive_items_but_not_zero_history(self):
        session=self.open(); self.add(session,status='READY')
        body=dict(sessionId=session,paymentMethod='CASH',expectedTotal=100,confirmedReceived=True)
        self.sql(self.command('CLOSE',body),error='P1305')
        self.sql('UPDATE public.order_items SET quantity=0')
        self.assertEqual(self.execute('CLOSE',{**body,'expectedTotal':0})['status'],'CLOSED')

    def test_close_does_not_free_a_table_pointing_to_another_session(self):
        session=self.open(); self.sql(f"UPDATE public.tables SET current_session_id=NULL WHERE id='{TABLE}'")
        self.sql(self.command('CLOSE',dict(sessionId=session,paymentMethod='CASH',expectedTotal=0,confirmedReceived=True)),error='P1302')
        self.assertEqual(self.sql('SELECT status FROM public.table_sessions'),'ACTIVE')

    def test_outbox_failure_rolls_back_open_and_operation_claim(self):
        self.sql("CREATE FUNCTION public.test_session_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fault'; END; $$; CREATE TRIGGER test_session_fail BEFORE INSERT ON private.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.test_session_fail();")
        try:
            self.sql(self.command('OPEN',dict(tableId=TABLE)),error='P0001')
            self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions'),'0')
            self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'),'0')
            self.assertEqual(self.sql(f"SELECT status FROM public.tables WHERE id='{TABLE}'"),'AVAILABLE')
        finally:
            self.sql('DROP TRIGGER test_session_fail ON private.notification_outbox; DROP FUNCTION public.test_session_fail();')

    def test_forbidden_role_disabled_actor_and_public_execution(self):
        for actor in ('user_kitchen','missing'):
            self.sql(self.command('OPEN',dict(tableId=TABLE),actor=actor),error='42501')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff'")
        self.sql(self.command('OPEN',dict(tableId=TABLE)),error='42501')
        for role in ('anon','authenticated'):
            self.sql(f'SET ROLE {role};'+self.command('OPEN',dict(tableId=TABLE)),error='42501')

    def test_full_bill_detail_has_all_510_rows_no_cost_actor_or_provenance(self):
        session=self.open(); self.add(session,count=510)
        query=f"SELECT public.fn_get_session_bill('user_staff','{session}');"
        bill=json.loads(self.sql('SET ROLE service_role;'+query).splitlines()[-1])
        self.assertEqual(len(bill['items']),510); self.assertEqual(bill['totalAmount'],51000)
        for private in ('unit_cost_price','served_by_staff_id','cancelled_by','stock_export_log_id','session_token'):
            self.assertNotIn(private,json.dumps(bill))
        self.assertEqual(self.sql('SELECT total_amount FROM public.table_sessions'),'0')  # read does not mutate
        for role in ('anon','authenticated'):
            self.sql('SET ROLE '+role+';'+query,error='42501')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff'")
        self.sql(query,error='42501')

    def test_closed_bill_mismatch_requires_reconciliation_without_rewriting_paid_total(self):
        session=self.open(); self.add(session)
        self.sql("UPDATE public.table_sessions SET status='CLOSED',total_amount=50")
        self.sql(f"SELECT public.fn_get_session_bill('user_staff','{session}');",error='P1102')
        self.assertEqual(self.sql('SELECT total_amount FROM public.table_sessions'),'50')

    def test_staff_lookup_is_scoped_and_survives_close_without_reopening(self):
        session=self.open(); op=str(uuid.uuid4())
        body=dict(sessionId=session,paymentMethod='CASH',expectedTotal=0,confirmedReceived=True)
        result=self.execute('CLOSE',body,op=op)
        query=f"SELECT public.fn_get_session_action_operation('user_staff',NULL,NULL,'{op}');"
        self.assertEqual(json.loads(self.sql(query)),result)
        self.assertEqual(self.execute('CLOSE',body,op=op),result)
        self.assertEqual(self.sql(query.replace('user_staff','user_admin')),'')
        self.assertEqual(self.sql('SELECT status FROM public.table_sessions'),'CLOSED')

    def test_customer_cannot_recover_bill_after_session_capability_revoked(self):
        session=self.open(); token=self.sql('SELECT session_token FROM public.table_sessions'); op=str(uuid.uuid4())
        self.execute('REQUEST_BILL',dict(sessionId=session,paymentMethod='CASH'),op=op,actor=None,token=token)
        self.execute('CLOSE',dict(sessionId=session,paymentMethod='CASH',expectedTotal=0,confirmedReceived=True))
        self.sql(f"SELECT public.fn_get_session_action_operation(NULL,'{token}','{session}','{op}');",error='42501')

    def test_bill_request_serializes_against_customer_order(self):
        from dine_in_rpc_test import order, line
        session=self.open(); token=self.sql('SELECT session_token FROM public.table_sessions')
        commands=[self.command('REQUEST_BILL',dict(sessionId=session,paymentMethod='CASH'),actor=None,token=token),
                  order([line()],session=session,token=token,op=str(uuid.uuid4()))]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(self.raw,commands))
        self.assertEqual(results[0].returncode,0)
        self.assertTrue(results[1].returncode==0 or 'P1001:' in results[1].stderr)
        self.assertEqual(self.sql('SELECT status FROM public.table_sessions'),'REQUEST_BILL')
        self.assertEqual(self.sql('SELECT total_amount=(SELECT coalesce(sum(quantity*unit_price),0) FROM public.order_items) FROM public.table_sessions'),'t')


if __name__=='__main__':
    unittest.main(verbosity=2)
