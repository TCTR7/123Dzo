"""Beer-return production RPC tests, disposable local PostgreSQL only."""
import concurrent.futures
import json
import unittest
import uuid
import staff_rpc_test as dbtest
import dine_in_rpc_test as orders
from dine_in_rpc_test import INGREDIENT, BEER, FOOD, SESSION, SECOND, line, order

OP = '60000000-0000-4000-8000-000000000001'


class BeerReturnRpcTest(dbtest.PostgresTestCase):
    def setUp(self):
        orders.DineInRpcTest.setUp(self)
        result = json.loads(self.sql(order([line(BEER,3,20)])))
        self.item = result['items'][0]['id']

    def command(self, quantity=1, expected=3, actor='user_staff', op=OP, session=SESSION, item=None, unused=True):
        body = dict(orderItemId=item or self.item, quantity=quantity, expectedQuantity=expected, confirmedUnused=unused)
        return f"SELECT public.fn_return_beer({dbtest.literal(actor)},'{session}','{op}',{dbtest.literal(json.dumps(body))}::jsonb);"

    def record(self, **kwargs):
        return json.loads(self.sql('SET ROLE service_role;' + self.command(**kwargs)).splitlines()[-1])

    def lookup(self, actor='user_staff', session=SESSION, op=OP):
        return f"SELECT public.fn_get_beer_return_operation({dbtest.literal(actor)},'{session}','{op}');"

    def raw(self, statement):
        return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres',
                        '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At','-f','-',check=False,input_text='SET ROLE service_role;'+statement)

    def assert_conservation(self):
        self.assertEqual(self.sql('SELECT stock_quantity=10+(SELECT sum(quantity_change) FROM public.inventory_logs) FROM public.ingredients'), 't')

    def test_bootstrap_parity_and_private_provenance_projection(self):
        for name in ('fn_return_beer(text,uuid,uuid,jsonb)','fn_get_beer_return_operation(text,uuid,uuid)','fn_submit_dine_in_order(uuid,text,text,uuid,jsonb)'):
            query=f"SELECT pg_get_functiondef('public.{name}'::regprocedure)"
            self.assertEqual(self.sql(query),self.sql(query,db='bootstrap_check'))
        self.assertEqual(self.sql('SELECT count(*) FROM public.order_items oi JOIN public.inventory_logs l ON l.id=oi.stock_export_log_id'), '1')
        saved=self.sql("SELECT result FROM private.operation_requests WHERE action='dine_in.order'")
        self.assertNotIn('stock_export_log_id',saved)

    def test_partial_then_full_keeps_status_timestamps_and_history(self):
        self.sql("UPDATE public.order_items SET status='SERVED',served_at=clock_timestamp(),served_by_staff_id='user_staff'")
        before=self.sql('SELECT status||ready_at::text||served_at::text||served_by_staff_id FROM public.order_items')
        self.assertEqual(self.record(quantity=1)['remainingQuantity'],2)
        self.assertEqual(self.record(quantity=2,expected=2,op=str(uuid.uuid4()))['remainingQuantity'],0)
        self.assertEqual(self.sql('SELECT status||ready_at::text||served_at::text||served_by_staff_id FROM public.order_items'),before)
        self.assertEqual(self.sql('SELECT quantity||\':\'||(cancelled_at IS NULL) FROM public.order_items'),'0:true')
        self.assertEqual(self.sql('SELECT total_amount FROM public.table_sessions WHERE id=\''+SESSION+'\''),'0')
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'10')
        self.assertEqual(self.sql("SELECT sum(total_cost) FROM public.inventory_logs WHERE type='RETURN_BEER'"),'39')
        self.assert_conservation()

    def test_return_uses_original_export_ingredient_and_order_cost_after_mapping_and_cost_change(self):
        other=str(uuid.uuid4())
        self.sql(f"INSERT INTO public.ingredients(id,name,unit,stock_quantity,unit_cost) VALUES('{other}','Different stock','can',100,99);")
        self.sql(f"UPDATE public.menu_items SET linked_ingredient_id='{other}',cost_price=88 WHERE id='{BEER}'; UPDATE public.ingredients SET unit_cost=50 WHERE id='{INGREDIENT}';")
        self.record()
        self.assertEqual(self.sql(f"SELECT stock_quantity FROM public.ingredients WHERE id='{INGREDIENT}'"),'8')
        self.assertEqual(self.sql(f"SELECT stock_quantity FROM public.ingredients WHERE id='{other}'"),'100')
        self.assertEqual(self.sql("SELECT total_cost FROM public.inventory_logs WHERE type='RETURN_BEER'"),'13')
        self.assertEqual(self.sql(f"SELECT unit_cost FROM public.ingredients WHERE id='{INGREDIENT}'"),'50')

    def test_replay_after_subsequent_return_and_closed_session_is_unchanged(self):
        first=self.record()
        self.record(quantity=2,expected=2,op=str(uuid.uuid4()))
        self.sql(f"UPDATE public.table_sessions SET status='CLOSED' WHERE id='{SESSION}'")
        self.assertEqual(self.record(),first)
        self.assertEqual(json.loads(self.sql(self.lookup())),first)
        self.assertEqual(self.sql("SELECT count(*) FROM public.inventory_logs WHERE type='RETURN_BEER'"),'2')
        self.sql(self.command(quantity=1,expected=1,op=str(uuid.uuid4())),error='P1001')
        self.assert_conservation()

    def test_changed_payload_and_actor_scope_cannot_reuse_or_read_operation(self):
        self.record()
        self.sql(self.command(quantity=2),error='22000')
        self.assertEqual(self.sql(self.lookup(actor='user_admin')),'')
        self.assertEqual(self.sql(self.lookup(session=SECOND)),'')

    def test_return_requires_active_staff_or_admin_and_public_cannot_call(self):
        for actor in ('user_kitchen','missing'):
            self.sql(self.command(actor=actor),error='42501')
            self.sql(self.lookup(actor=actor),error='42501')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff'")
        self.sql(self.command(),error='42501')
        for role in ('anon','authenticated'):
            self.sql(f'SET ROLE {role};'+self.command(),error='42501')
            self.sql(f'SET ROLE {role};'+self.lookup(),error='42501')

    def test_bad_quantities_confirmation_and_cross_session_item_are_rejected(self):
        for args in (dict(quantity=0),dict(quantity=1.1),dict(quantity=4),dict(quantity=100,expected=100),dict(unused=False)):
            self.sql(self.command(**args),error='22023')
        self.sql(self.command(session=SECOND),error='P0002')
        self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='beer.return'"),'0')

    def test_legacy_missing_provenance_blocks_return_and_does_not_guess_name(self):
        self.sql('UPDATE public.order_items SET stock_export_log_id=NULL')
        self.sql(self.command(),error='P1203')
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'7')
        self.assertEqual(self.sql('SELECT quantity FROM public.order_items'),'3')

    def test_food_other_categories_or_cancelled_items_cannot_return(self):
        for column,value in (('status','CANCELLED'),('station','KITCHEN')):
            before=self.sql(f'SELECT {column} FROM public.order_items')
            self.sql(f"UPDATE public.order_items SET {column}='{value}'")
            self.sql(self.command(),error='P1202')
            self.sql(f"UPDATE public.order_items SET {column}='{before}'")
        self.sql("UPDATE public.menu_items SET category='OTHER' WHERE id='"+BEER+"'")
        self.sql(self.command(),error='P1202')

    def test_request_bill_allows_returns_but_pending_does_not(self):
        self.sql(f"UPDATE public.table_sessions SET status='PENDING_PAYMENT' WHERE id='{SESSION}'")
        self.sql(self.command(),error='P1001')
        self.sql(f"UPDATE public.table_sessions SET status='REQUEST_BILL' WHERE id='{SESSION}'")
        self.assertEqual(self.record()['totalAmount'],40)

    def test_two_staff_using_same_snapshot_only_one_return_applies(self):
        commands=[self.command(quantity=2),self.command(quantity=2,actor='user_admin',op=str(uuid.uuid4()))]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(self.raw,commands))
        self.assertEqual(sum(r.returncode==0 for r in results),1)
        self.assertTrue(any('P1201:' in r.stderr for r in results))
        self.assertEqual(self.sql('SELECT quantity FROM public.order_items'),'1')
        self.assert_conservation()

    def test_concurrent_same_key_returns_once(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(self.raw,[self.command(),self.command()]))
        self.assertTrue(all(r.returncode==0 for r in results))
        self.assertEqual(self.sql("SELECT count(*) FROM public.inventory_logs WHERE type='RETURN_BEER'"),'1')
        self.assert_conservation()

    def test_outbox_failure_rolls_back_item_stock_log_bill_and_ledger(self):
        self.sql("CREATE FUNCTION public.test_return_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fault'; END; $$; CREATE TRIGGER test_return_fail BEFORE INSERT ON private.notification_outbox FOR EACH ROW EXECUTE FUNCTION public.test_return_fail();")
        try:
            self.sql(self.command(),error='P0001')
            self.assertEqual(self.sql('SELECT quantity FROM public.order_items'),'3')
            self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'7')
            self.assertEqual(self.sql(f"SELECT total_amount FROM public.table_sessions WHERE id='{SESSION}'"),'60')
            self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='beer.return'"),'0')
            self.assertEqual(self.sql("SELECT count(*) FROM public.inventory_logs WHERE type='RETURN_BEER'"),'0')
        finally:
            self.sql('DROP TRIGGER test_return_fail ON private.notification_outbox; DROP FUNCTION public.test_return_fail();')

    def test_bill_total_uses_all_rows_and_zero_lines_do_not_contribute_to_kpi(self):
        self.sql(f"INSERT INTO public.order_items(session_id,menu_item_id,quantity,station,status,unit_price,unit_cost_price) SELECT '{SESSION}','{FOOD}',1,'KITCHEN','SERVED',100,40 FROM generate_series(1,510)")
        self.sql("UPDATE public.order_items SET status='SERVED',served_by_staff_id='user_staff',served_at=clock_timestamp() WHERE station='BAR_INSTANT'")
        self.assertEqual(self.record(quantity=3)['totalAmount'],51000)
        self.assertEqual(self.sql("SELECT active_serving_count FROM public.vw_kpi_waitstaff_performance WHERE staff_id='user_staff'"),'0')
        self.assertEqual(self.sql("SELECT active_serving_count FROM public.fn_get_waitstaff_kpi() WHERE staff_id='user_staff'"),'0')
        self.assertEqual(self.sql('SELECT sum(total_orders_count) FROM public.vw_kpi_peak_hours'),'510')
        self.assertEqual(self.sql(f"SELECT total_quantity_sold FROM public.vw_kpi_menu_analytics WHERE menu_item_id='{BEER}'"),'0')


if __name__=='__main__':
    unittest.main(verbosity=2)
