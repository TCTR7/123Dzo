"""Real order RPC tests against a disposable PostgreSQL cluster only."""
import concurrent.futures
import json
import uuid
import unittest
import staff_rpc_test as dbtest

SESSION='10000000-0000-4000-8000-000000000001'
SECOND='10000000-0000-4000-8000-000000000002'
FOOD='20000000-0000-4000-8000-000000000001'
BEER='20000000-0000-4000-8000-000000000002'
INGREDIENT='30000000-0000-4000-8000-000000000001'
TOKEN='test-only-capability-one'
OP='40000000-0000-4000-8000-000000000001'


def line(menu=FOOD, qty=1, price=100, note=''):
    return dict(menu_item_id=menu,quantity=qty,note=note,expected_price=price)


def order(lines=None, op=OP, session=SESSION, token=TOKEN, actor=None):
    token_sql='NULL' if token is None else dbtest.literal(token)
    actor_sql='NULL' if actor is None else dbtest.literal(actor)
    body=dbtest.literal(json.dumps(lines if lines is not None else [line()]))
    return f"SELECT public.fn_submit_dine_in_order('{session}',{token_sql},{actor_sql},'{op}',{body}::jsonb);"


def lookup(op=OP,session=SESSION,token=TOKEN,actor=None):
    token_sql='NULL' if token is None else dbtest.literal(token)
    actor_sql='NULL' if actor is None else dbtest.literal(actor)
    return f"SELECT public.fn_get_dine_in_operation('{session}',{token_sql},{actor_sql},'{op}');"


class DineInRpcTest(dbtest.PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.staff_profiles, public.menu_items, public.ingredients CASCADE;')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_staff','Staff','staff'),('user_admin','Admin','admin'),('user_kitchen','Kitchen','kitchen');")
        self.sql(f"INSERT INTO public.ingredients(id,name,unit,stock_quantity,unit_cost) VALUES ('{INGREDIENT}','Beer stock','can',10,12);")
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES ('{FOOD}','Food','FOOD','KITCHEN',100,40);")
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price,linked_ingredient_id) VALUES ('{BEER}','Beer','BEER','BAR_INSTANT',20,13,'{INGREDIENT}');")
        self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status) VALUES ('{SESSION}','{TOKEN}','DINE_IN','ACTIVE'),('{SECOND}','token-two','DINE_IN','ACTIVE');")

    def submit(self,*args,**kwargs):
        return json.loads(self.sql('SET ROLE service_role;'+order(*args,**kwargs)).splitlines()[-1])

    def test_order_snapshots_stations_stock_total_and_outbox_commit_together(self):
        result=self.submit([line(),line(BEER,3,20,' cold ')])
        self.assertEqual(result['totalAmount'],160)
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'), '7')
        self.assertEqual(self.sql('SELECT quantity_change||\':\'||total_cost FROM public.inventory_logs'),'-3:36')
        self.assertEqual(self.sql("SELECT string_agg(station||':'||status,',' ORDER BY station) FROM public.order_items"),'BAR_INSTANT:READY,KITCHEN:QUEUED')
        self.assertEqual(self.sql("SELECT count(*) FROM public.order_items WHERE station='BAR_INSTANT' AND ready_at IS NOT NULL"),'1')
        self.assertEqual(self.sql('SELECT count(*) FROM private.notification_outbox'),'2')
        self.assertEqual(self.sql("SELECT unit_cost_price FROM public.order_items WHERE menu_item_id='"+BEER+"'"),'13')
        self.assertNotIn('unit_cost_price',json.dumps(result))
        self.assertNotIn('served_by_staff_id',json.dumps(result))

    def test_same_key_replay_after_menu_change_and_cooking_does_not_reapply(self):
        result=self.submit()
        self.sql(f"UPDATE public.menu_items SET price=120,cost_price=60 WHERE id='{FOOD}'; UPDATE public.order_items SET status='COOKING',cooking_started_at=clock_timestamp();")
        self.assertEqual(self.submit(),result)
        self.assertEqual(self.sql('SELECT status||\':\'||unit_price||\':\'||unit_cost_price FROM public.order_items'),'COOKING:100:40')
        self.assertEqual(self.sql('SELECT count(*) FROM private.notification_outbox'),'1')

    def test_different_payload_same_key_rejected(self):
        self.submit()
        self.sql(order([line(qty=2)]),error='22000')
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'),'1')

    def test_rate_limit_is_shared_by_customer_and_staff_replay_does_not_count(self):
        self.submit()
        self.submit()
        self.submit(op=str(uuid.uuid4()),token=None,actor='user_staff')
        self.sql(order(op=str(uuid.uuid4())),error='P1006')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'),'2')

    def test_rate_window_expires_without_client_clock(self):
        self.submit()
        self.submit(op=str(uuid.uuid4()))
        self.sql("UPDATE private.operation_requests SET created_at=clock_timestamp()-interval '12 seconds',completed_at=clock_timestamp()-interval '11 seconds';")
        self.submit(op=str(uuid.uuid4()))
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'),'3')

    def test_session_state_changes_block_new_order_and_closed_replay(self):
        self.submit()
        self.sql(f"UPDATE public.table_sessions SET status='REQUEST_BILL' WHERE id='{SESSION}'")
        self.submit()  # recovery only; no new items
        self.sql(order(op=str(uuid.uuid4())),error='P1001')
        for status in ['CLOSED','PENDING_PAYMENT']:
            self.sql(f"UPDATE public.table_sessions SET status='{status}' WHERE id='{SESSION}'")
            self.sql(order(),error='P1001')
            self.sql(lookup(),error='P1001')

    def test_capability_role_and_actor_revocation_are_checked_before_replay(self):
        self.sql(order(token='wrong'),error='42501')
        self.sql(order(token=None,actor='user_kitchen'),error='42501')
        self.sql(order(actor='user_admin'),error='42501')
        self.submit(token=None,actor='user_staff')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff'")
        self.sql(order(token=None,actor='user_staff'),error='42501')
        self.sql(lookup(token=None,actor='user_staff'),error='42501')

    def test_recovery_is_scoped_and_missing_operation_returns_null(self):
        self.assertEqual(self.sql(lookup()),'')
        result=self.submit()
        self.assertEqual(json.loads(self.sql(lookup())),result)
        self.assertEqual(self.sql(lookup(session=SECOND,token='token-two')),'')

    def test_price_soldout_and_bad_mapping_roll_back_claim(self):
        self.sql(order([line(price=1)]),error='P1003')
        self.sql(f"UPDATE public.menu_items SET is_available=false WHERE id='{FOOD}'")
        self.sql(order(),error='P1002')
        self.sql(f"UPDATE public.menu_items SET is_available=true,linked_ingredient_id='{INGREDIENT}' WHERE id='{FOOD}'")
        self.sql(order(),error='P1005')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'),'0')
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'),'0')

    def test_same_ingredient_is_aggregated_across_lines(self):
        self.submit([line(BEER,2,20,'cold'),line(BEER,3,20,'room temp')])
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'5')
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'),'1')
        self.assertEqual(self.sql('SELECT quantity_change FROM public.inventory_logs'),'-5')

    def test_insufficient_stock_rolls_back_entire_cart(self):
        self.sql(order([line(),line(BEER,11,20)]),error='P1004')
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'10')
        for table in ['public.order_items','public.inventory_logs','private.notification_outbox','private.operation_requests']:
            self.assertEqual(self.sql('SELECT count(*) FROM '+table),'0')

    def test_failure_in_outbox_rolls_back_items_inventory_log_bill_and_operation(self):
        self.sql("CREATE FUNCTION public.test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$; CREATE TRIGGER test_fail BEFORE INSERT ON private.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.test_fail_outbox();")
        try:
            self.sql(order([line(BEER,2,20)]),error='P0001')
        finally:
            self.sql('DROP TRIGGER test_fail ON private.notification_outbox; DROP FUNCTION public.test_fail_outbox();')
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'10')
        self.assertEqual(self.sql(f"SELECT total_amount FROM public.table_sessions WHERE id='{SESSION}'"),'0')
        for table in ['public.order_items','public.inventory_logs','private.operation_requests']:
            self.assertEqual(self.sql('SELECT count(*) FROM '+table),'0')

    def raw_order(self,sql):
        return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres',
                        '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At','-f','-',check=False,input_text='SET ROLE service_role;'+sql)

    def test_two_simultaneous_same_key_create_one_order(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(self.raw_order,[order(),order()]))
        self.assertTrue(all(result.returncode==0 for result in results),[r.stderr for r in results])
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'),'1')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'),'1')

    def test_competing_sessions_cannot_oversell_last_beer(self):
        self.sql('UPDATE public.ingredients SET stock_quantity=1')
        calls=[order([line(BEER,1,20)]),order([line(BEER,1,20)],session=SECOND,token='token-two')]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(self.raw_order,calls))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertTrue(any('P1004:' in r.stderr for r in results))
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'0')
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'),'1')

    def test_total_uses_all_rows_not_truncated_or_stale_session_total(self):
        self.sql(f"INSERT INTO public.order_items(session_id,menu_item_id,quantity,station,status,unit_price,unit_cost_price) SELECT '{SESSION}','{FOOD}',1,'KITCHEN','SERVED',100,40 FROM generate_series(1,510); UPDATE public.table_sessions SET total_amount=1 WHERE id='{SESSION}';")
        self.assertEqual(self.submit()['totalAmount'],51100)

    def test_invalid_fields_or_quantity_never_mutate(self):
        for invalid in [[],[line(qty=0)],[line(qty=1.5)],[{**line(),'status':'READY'}],[{**line(),'unit_cost_price':0}], [line(note='x'*501)]]:
            self.sql(order(invalid),error='22023')
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'),'0')

    def test_large_valid_30_line_result_fits_bounded_ledger(self):
        result=self.submit([line(note='x'*500) for _ in range(30)])
        self.assertEqual(len(result['items']),30)
        self.assertEqual(result['totalAmount'],3000)

    def test_public_roles_cannot_execute_rpc_or_read_outbox(self):
        for role in ['anon','authenticated']:
            self.sql('SET ROLE '+role+';'+order(),error='42501')
            self.sql('SET ROLE '+role+';'+lookup(),error='42501')
            self.sql('SET ROLE '+role+'; SELECT * FROM private.notification_outbox;',error='42501')

    def test_nonfinite_cost_is_rejected_at_db_boundary_before_order_mutation(self):
        self.sql(f"UPDATE public.menu_items SET cost_price='NaN' WHERE id='{FOOD}'",error='23514')
        self.sql("UPDATE public.ingredients SET unit_cost='NaN';",error='23514')
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'),'0')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'),'0')

    def test_three_concurrent_fresh_requests_accept_only_two(self):
        calls=[order(op=str(uuid.uuid4())) for _ in range(3)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(self.raw_order,calls))
        self.assertEqual(sum(r.returncode==0 for r in results),2)
        self.assertTrue(any('P1006:' in r.stderr for r in results))
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'),'2')


if __name__=='__main__': unittest.main(verbosity=2)
