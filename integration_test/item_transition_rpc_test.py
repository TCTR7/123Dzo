"""M-11 production transitions on disposable PostgreSQL only."""
import concurrent.futures
import json
import unittest
import uuid
import staff_rpc_test as dbtest
import dine_in_rpc_test as orders

OP='a0000000-0000-4000-8000-000000000001'


class ItemTransitionTest(dbtest.PostgresTestCase):
    def setUp(self):
        orders.DineInRpcTest.setUp(self)
        first=json.loads(self.sql(orders.order([orders.line(note='no chili'),orders.line(orders.BEER,3,20)])))
        second=json.loads(self.sql(orders.order([orders.line(note='extra chili')],session=orders.SECOND,token='token-two',op=str(uuid.uuid4()))))
        self.food=next(item['id'] for item in first['items'] if item['station']=='KITCHEN')
        self.beer=next(item['id'] for item in first['items'] if item['station']=='BAR_INSTANT')
        self.second=second['items'][0]['id']

    def expect(self,item):
        return json.loads(self.sql(f"SELECT jsonb_build_object('id',id,'sessionId',session_id,'expectedStatus',status,'expectedQuantity',quantity) FROM public.order_items WHERE id='{item}'"))

    def command(self,action,items=None,actor='user_kitchen',reason='',op=OP):
        body=dict(action=action,items=items if items is not None else [self.expect(self.food)],reason=reason)
        return f"SELECT public.fn_transition_order_items({dbtest.literal(actor)},'{op}',{dbtest.literal(json.dumps(body))}::jsonb);"

    def execute(self,*args,**kwargs):
        return json.loads(self.sql('SET ROLE service_role;'+self.command(*args,**kwargs)).splitlines()[-1])

    def raw(self,statement):
        return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At','-f','-',check=False,input_text='SET ROLE service_role;'+statement)

    def test_bootstrap_upgrade_parity(self):
        for function in ('fn_transition_order_items(text,uuid,jsonb)','fn_get_item_action_operation(text,uuid)'):
            query=f"SELECT pg_get_functiondef('public.{function}'::regprocedure)"
            self.assertEqual(self.sql(query),self.sql(query,db='bootstrap_check'))

    def test_full_lifecycle_timestamps_actor_and_snapshot_are_database_authoritative(self):
        before=self.sql(f"SELECT created_at||':'||unit_price||':'||unit_cost_price FROM public.order_items WHERE id='{self.food}'")
        self.execute('START'); self.execute('READY',op=str(uuid.uuid4())); self.execute('SERVE',actor='user_staff',op=str(uuid.uuid4()))
        self.assertEqual(self.sql(f"SELECT status||':'||served_by_staff_id FROM public.order_items WHERE id='{self.food}'"),'SERVED:user_staff')
        self.assertEqual(self.sql(f"SELECT created_at<=cooking_started_at AND cooking_started_at<=ready_at AND ready_at<=served_at FROM public.order_items WHERE id='{self.food}'"),'t')
        self.assertEqual(self.sql(f"SELECT created_at||':'||unit_price||':'||unit_cost_price FROM public.order_items WHERE id='{self.food}'"),before)
        self.assertEqual(self.sql(f"SELECT count(*) FROM private.notification_outbox WHERE kind='ORDER_READY' AND order_item_id='{self.food}'"),'1')

    def test_batch_uses_one_generated_id_and_preserves_each_note(self):
        expected=[self.expect(self.food),self.expect(self.second)]
        first=self.execute('START',items=expected)
        self.assertIsNotNone(first['batchId'])
        self.assertEqual(self.sql("SELECT count(DISTINCT batch_id) FROM public.order_items WHERE station='KITCHEN'"),'1')
        self.assertEqual(self.sql("SELECT string_agg(note,',' ORDER BY note) FROM public.order_items WHERE station='KITCHEN'"),'extra chili,no chili')
        self.assertEqual(self.execute('START',items=list(reversed(expected))),first)

    def test_staff_cannot_cancel_cooking_ready_or_served_and_kitchen_cannot_cancel(self):
        for status in ('COOKING','READY','SERVED'):
            self.sql(f"UPDATE public.order_items SET status='{status}' WHERE id='{self.food}'")
            self.sql(self.command('CANCEL',actor='user_staff',reason='test'),error='42501')
        self.sql(self.command('CANCEL',actor='user_kitchen',reason='test'),error='42501')
        self.sql(self.command('START',actor='user_staff'),error='42501')
        self.sql(self.command('SERVE',items=[self.expect(self.beer)],actor='user_kitchen'),error='42501')

    def test_admin_cancel_recomputes_all_510_lines_and_does_not_refund_or_double_waste_stock(self):
        self.sql(f"INSERT INTO public.order_items(session_id,menu_item_id,quantity,station,status,unit_price,unit_cost_price) SELECT '{orders.SESSION}','{orders.FOOD}',1,'KITCHEN','SERVED',100,40 FROM generate_series(1,510)")
        stock=self.sql('SELECT stock_quantity FROM public.ingredients'); logs=self.sql('SELECT count(*) FROM public.inventory_logs')
        self.execute('CANCEL',items=[self.expect(self.beer)],actor='user_admin',reason='  damaged after serving  ')
        self.assertEqual(self.sql(f"SELECT total_amount FROM public.table_sessions WHERE id='{orders.SESSION}'"),'51100')
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),stock)
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'),logs)
        self.assertEqual(self.sql(f"SELECT cancel_reason||':'||cancelled_by||':'||(cancelled_at IS NOT NULL) FROM public.order_items WHERE id='{self.beer}'"),'damaged after serving:user_admin:true')

    def test_batch_conflict_wrong_station_or_unpaid_rolls_back_every_item_and_ledger(self):
        queued=[self.expect(self.food),self.expect(self.second)]
        self.sql(f"UPDATE public.order_items SET status='COOKING' WHERE id='{self.second}'")
        self.sql(self.command('START',items=queued),error='P1401')
        self.assertEqual(self.sql(f"SELECT status FROM public.order_items WHERE id='{self.food}'"),'QUEUED')
        self.sql(self.command('START',items=[self.expect(self.food),self.expect(self.beer)]),error='P1402')
        self.sql(f"UPDATE public.table_sessions SET status='PENDING_PAYMENT' WHERE id='{orders.SECOND}'")
        self.sql(self.command('START',items=queued),error='P1001')
        self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='item.transition'"),'0')

    def test_ready_replay_keeps_timestamp_and_outbox_but_new_stale_completion_fails(self):
        self.execute('START'); expected=[self.expect(self.food)]; op=str(uuid.uuid4())
        result=self.execute('READY',items=expected,op=op)
        ready=self.sql(f"SELECT ready_at FROM public.order_items WHERE id='{self.food}'")
        self.assertEqual(self.execute('READY',items=expected,op=op),result)
        self.assertEqual(self.sql(f"SELECT ready_at FROM public.order_items WHERE id='{self.food}'"),ready)
        self.sql(self.command('READY',items=expected,op=str(uuid.uuid4())),error='P1401')

    def test_two_staff_serving_same_item_only_one_gets_credit(self):
        expected=[self.expect(self.beer)]
        commands=[self.command('SERVE',items=expected,actor=actor,op=str(uuid.uuid4())) for actor in ('user_staff','user_admin')]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(self.raw,commands))
        self.assertEqual(sum(r.returncode==0 for r in results),1); self.assertTrue(any('P1401:' in r.stderr for r in results))
        self.assertEqual(self.sql(f"SELECT status FROM public.order_items WHERE id='{self.beer}'"),'SERVED')

    def test_cancel_competes_with_start_and_complete_without_partial_success(self):
        for before,action,canceller in [('QUEUED','START','user_staff'),('COOKING','READY','user_admin')]:
            self.sql(f"UPDATE public.order_items SET status='{before}',cooking_started_at=CASE WHEN '{before}'='COOKING' THEN clock_timestamp() END,ready_at=NULL,cancelled_at=NULL,cancelled_by=NULL,cancel_reason=NULL WHERE id='{self.food}'")
            expected=[self.expect(self.food)]
            commands=[self.command(action,items=expected,op=str(uuid.uuid4())),self.command('CANCEL',items=expected,actor=canceller,reason='test',op=str(uuid.uuid4()))]
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(self.raw,commands))
            self.assertEqual(sum(r.returncode==0 for r in results),1); self.assertTrue(any('P1401:' in r.stderr for r in results))

    def test_outbox_fault_rolls_back_entire_batch_and_claim(self):
        self.sql("CREATE FUNCTION public.test_transition_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fault'; END; $$; CREATE TRIGGER test_transition_fail BEFORE INSERT ON private.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.test_transition_fail();")
        try:
            self.sql(self.command('START',items=[self.expect(self.food),self.expect(self.second)]),error='P0001')
            self.assertEqual(self.sql("SELECT count(*) FROM public.order_items WHERE status='COOKING'"),'0')
            self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='item.transition'"),'0')
        finally: self.sql('DROP TRIGGER test_transition_fail ON private.notification_outbox; DROP FUNCTION public.test_transition_fail();')

    def test_missing_ready_time_future_timestamps_and_zero_quantity_are_rejected(self):
        self.sql(f"UPDATE public.order_items SET ready_at=NULL WHERE id='{self.beer}'")
        self.sql(self.command('SERVE',items=[self.expect(self.beer)],actor='user_staff'),error='P1402')
        self.sql(f"UPDATE public.order_items SET created_at=clock_timestamp()+interval '1 hour' WHERE id='{self.food}'")
        self.sql(self.command('START'),error='P1403')
        self.sql(f"UPDATE public.order_items SET quantity=0 WHERE id='{self.food}'")
        self.sql(self.command('START'),error='22023')

    def test_validation_duplicate_missing_and_spoofed_actor_time(self):
        row=self.expect(self.food)
        self.sql(self.command('START',items=[row,row]),error='22023')
        self.sql(self.command('CANCEL',actor='user_admin',reason='  '),error='22023')
        self.sql(self.command('START',items=[{**row,'served_at':'fake'}]),error='22023')
        self.sql(self.command('START',items=[{**row,'id':str(uuid.uuid4())}]),error='P1401')
        self.sql(self.command('START',items=[{**row,'sessionId':orders.SECOND}]),error='P1401')

    def test_lookup_scope_changed_key_disabled_actor_and_public_execution(self):
        expected=[self.expect(self.food)]; result=self.execute('START',items=expected)
        query=f"SELECT public.fn_get_item_action_operation('user_kitchen','{OP}');"
        self.assertEqual(json.loads(self.sql(query)),result)
        self.assertEqual(self.sql(query.replace('user_kitchen','user_admin')),'')
        self.sql(self.command('START',items=[self.expect(self.second)]),error='22000')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_kitchen'")
        self.sql(query,error='42501')
        for role in ('anon','authenticated'):
            self.sql('SET ROLE '+role+';'+query,error='42501')
            self.sql('SET ROLE '+role+';'+self.command('START',items=expected),error='42501')

    def test_admin_demotion_cannot_replay_or_read_prepared_cancel_result(self):
        row=self.expect(self.beer); self.execute('CANCEL',items=[row],actor='user_admin',reason='damaged')
        self.sql("UPDATE public.staff_profiles SET role='staff' WHERE id='user_admin'")
        self.sql(self.command('CANCEL',items=[row],actor='user_admin',reason='damaged'),error='42501')
        self.sql(f"SELECT public.fn_get_item_action_operation('user_admin','{OP}');",error='42501')

    def test_closed_and_cancelled_items_cannot_resurrect(self):
        self.execute('CANCEL',actor='user_staff',reason='changed mind')
        self.sql(self.command('START',items=[{'id':self.food,'sessionId':orders.SESSION,'expectedStatus':'QUEUED','expectedQuantity':1}],op=str(uuid.uuid4())),error='P1401')
        self.sql(f"UPDATE public.table_sessions SET status='CLOSED' WHERE id='{orders.SECOND}'")
        self.sql(self.command('START',items=[self.expect(self.second)],op=str(uuid.uuid4())),error='P1001')


if __name__=='__main__': unittest.main(verbosity=2)
