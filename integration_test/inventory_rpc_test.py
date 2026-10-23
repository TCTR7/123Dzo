"""Manual inventory transactions against disposable local PostgreSQL, never the app DB."""
import concurrent.futures
import json
import time
import unittest
import uuid
import staff_rpc_test as dbtest
from dine_in_rpc_test import INGREDIENT, BEER, SESSION, TOKEN, line, order

OP = '40000000-0000-4000-8000-000000000001'


def movement(kind='IMPORT', quantity=1, cost=12, note='', ingredient=INGREDIENT, op=OP, actor='user_admin'):
    body = dict(ingredientId=ingredient, type=kind, quantity=quantity,
                unitCost=cost if kind == 'IMPORT' else None, note=note)
    return f"SELECT public.fn_admin_record_inventory({dbtest.literal(actor)},'{op}',{dbtest.literal(json.dumps(body))}::jsonb);"


def lookup(op=OP, actor='user_admin'):
    return f"SELECT public.fn_admin_get_inventory_operation({dbtest.literal(actor)},'{op}');"


class InventoryRpcTest(dbtest.PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.staff_profiles,public.ingredients,public.menu_items CASCADE;')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_admin','Admin','admin'),"
                 "('user_second','Second admin','admin'),('user_staff','Staff','staff'),('user_kitchen','Kitchen','kitchen');")
        self.sql(f"INSERT INTO public.ingredients(id,name,unit,stock_quantity,unit_cost) VALUES ('{INGREDIENT}','Beer','can',10,12);")

    def record(self, **kwargs):
        return json.loads(self.sql('SET ROLE service_role;' + movement(**kwargs)).splitlines()[-1])

    def raw(self, statement):
        return self.cli('psql', '-X', '-w', '-h', '127.0.0.1', '-p', self.port, '-U', 'postgres',
                        '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At',
                        '-f', '-', check=False, input_text='SET ROLE service_role;' + statement)

    def assert_conservation(self):
        self.assertEqual(self.sql('SELECT stock_quantity = 10 + COALESCE((SELECT SUM(quantity_change) FROM public.inventory_logs),0) FROM public.ingredients'), 't')

    def test_bootstrap_matches_upgrade(self):
        for function in ('fn_admin_record_inventory(text,uuid,jsonb)', 'fn_admin_get_inventory_operation(text,uuid)'):
            query = f"SELECT pg_get_functiondef('public.{function}'::regprocedure);"
            self.assertEqual(self.sql(query), self.sql(query, db='bootstrap_check'))

    def test_import_and_wastage_stock_cost_and_actor_are_atomic(self):
        imported = self.record(quantity=2.125, cost=13.75, note=' delivery ')
        self.assertEqual(imported['quantityChange'], 2.125)
        self.assertEqual(imported['totalCost'], 29.22)
        wasted = self.record(kind='WASTAGE', quantity=0.125, note='broken', op=str(uuid.uuid4()))
        self.assertEqual(wasted['totalCost'], 1.72)
        self.assertEqual(self.sql('SELECT stock_quantity||\':\'||unit_cost FROM public.ingredients'), '12.000:13.75')
        self.assertEqual(self.sql("SELECT count(*) FROM public.inventory_logs WHERE created_by='user_admin'"), '2')
        self.assertEqual(self.sql("SELECT note FROM public.inventory_logs WHERE type='IMPORT'"), 'delivery')
        self.assert_conservation()

    def test_zero_cost_import_updates_cost_and_wastage_uses_current_db_cost(self):
        self.record(cost=0)
        self.assertEqual(self.sql('SELECT unit_cost FROM public.ingredients'), '0')
        self.sql('UPDATE public.ingredients SET unit_cost=17')
        result = self.record(kind='WASTAGE', quantity=2, note='damaged', op=str(uuid.uuid4()))
        self.assertEqual(result['totalCost'], 34)
        self.assertEqual(self.sql("SELECT total_cost FROM public.inventory_logs WHERE type='IMPORT'"), '0.00')
        self.assert_conservation()

    def test_replay_after_price_change_does_not_apply_stock_or_log_twice(self):
        first = self.record()
        self.sql('UPDATE public.ingredients SET unit_cost=99')
        self.assertEqual(self.record(), first)
        self.assertEqual(self.sql('SELECT stock_quantity||\':\'||unit_cost FROM public.ingredients'), '11:99')
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'), '1')
        self.assertEqual(json.loads(self.sql(lookup())), first)

    def test_equivalent_numeric_scales_replay_the_same_request(self):
        first = self.record()
        scaled = movement().replace('"quantity": 1', '"quantity": 1.000').replace('"unitCost": 12', '"unitCost": 12.00')
        self.assertEqual(json.loads(self.sql(scaled)), first)

    def test_key_conflict_is_rejected_and_scope_does_not_leak_other_admin(self):
        first = self.record()
        self.sql(movement(quantity=2), error='22000')
        self.assertEqual(self.sql(lookup(actor='user_second')), '')
        second = self.record(actor='user_second')
        self.assertNotEqual(first['logId'], second['logId'])
        self.assert_conservation()

    def test_permission_is_checked_inside_db_for_write_and_lookup(self):
        for actor in ('user_staff', 'user_kitchen', 'missing'):
            self.sql(movement(actor=actor), error='42501')
            self.sql(lookup(actor=actor), error='42501')
        self.record()
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_admin'")
        self.sql(movement(), error='42501')
        self.sql(lookup(), error='42501')

    def test_public_roles_cannot_execute_rpcs(self):
        for role in ('anon', 'authenticated'):
            self.sql('SET ROLE ' + role + ';' + movement(), error='42501')
            self.sql('SET ROLE ' + role + ';' + lookup(), error='42501')

    def test_validation_and_short_stock_leave_no_claim_log_or_stock_change(self):
        for kwargs in (dict(quantity=0), dict(quantity=-1), dict(quantity=0.0001), dict(cost=-1),
                       dict(cost=0.001), dict(quantity=1000001), dict(kind='WASTAGE', note=' '),
                       dict(kind='EXPORT_SALE'), dict(kind='RETURN_BEER')):
            self.sql(movement(**kwargs), error='22023')
        self.sql(movement(kind='WASTAGE', quantity=11, note='broken'), error='P1004')
        self.sql(movement(ingredient=str(uuid.uuid4())), error='P0002')
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'), '10')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'), '0')

    def test_legacy_nonfinite_or_negative_values_are_rejected(self):
        for column in ('stock_quantity', 'unit_cost'):
            values = ('NaN', 'Infinity', '-Infinity', '-1') + (('1000000001',) if column == 'unit_cost' else ())
            for value in values:
                if value == '1000000001':
                    self.sql(f"UPDATE public.ingredients SET {column}='{value}'::numeric")
                    self.sql(movement(), error='P1102')
                else:
                    self.sql(f"UPDATE public.ingredients SET {column}='{value}'::numeric", error='23514')
                self.sql(f'UPDATE public.ingredients SET {column}=10')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')

    def test_log_failure_rolls_back_stock_cost_and_ledger(self):
        self.sql("CREATE FUNCTION public.test_inventory_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fault'; END; $$;"
                 'CREATE TRIGGER test_inventory_fail BEFORE INSERT ON public.inventory_logs FOR EACH ROW EXECUTE FUNCTION public.test_inventory_fail();')
        try:
            self.sql(movement(quantity=2, cost=30), error='P0001')
            self.assertEqual(self.sql('SELECT stock_quantity||\':\'||unit_cost FROM public.ingredients'), '10:12')
            self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')
        finally:
            self.sql('DROP TRIGGER test_inventory_fail ON public.inventory_logs; DROP FUNCTION public.test_inventory_fail();')

    def test_concurrent_same_key_creates_only_one_log(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.raw, [movement(quantity=3), movement(quantity=3)]))
        self.assertTrue(all(r.returncode == 0 for r in results), [r.stderr for r in results])
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'), '13')
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'), '1')
        self.assert_conservation()

    def test_concurrent_wastage_cannot_overdraw_or_lose_update(self):
        commands = [movement(kind='WASTAGE', quantity=7, note='broken', op=str(uuid.uuid4())) for _ in range(2)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.raw, commands))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertTrue(any('P1004:' in r.stderr for r in results))
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'), '3')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '1')
        self.assert_conservation()

    def test_inventory_and_order_share_ingredient_lock_and_conserve_stock(self):
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price,linked_ingredient_id) VALUES ('{BEER}','Beer','BEER','BAR_INSTANT',20,13,'{INGREDIENT}');")
        self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status) VALUES ('{SESSION}','{TOKEN}','DINE_IN','ACTIVE');")
        commands = [movement(kind='WASTAGE', quantity=6, note='broken'), order([line(BEER,6,20)], op=str(uuid.uuid4()))]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.raw, commands))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'), '4')
        self.assert_conservation()

    def test_wastage_after_export_only_deducts_the_damaged_remaining_units(self):
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price,linked_ingredient_id) VALUES ('{BEER}','Beer','BEER','BAR_INSTANT',20,13,'{INGREDIENT}');")
        self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status) VALUES ('{SESSION}','{TOKEN}','DINE_IN','ACTIVE');")
        self.sql(order([line(BEER,3,20)]))
        self.record(kind='WASTAGE', quantity=2, note='broken remaining cans')
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'), '5')
        self.assertEqual(self.sql("SELECT type||':'||quantity_change||':'||total_cost FROM public.inventory_logs ORDER BY type"),
                         'EXPORT_SALE:-3:36\nWASTAGE:-2:24.00')
        self.assert_conservation()

    def test_lookup_waits_for_an_in_flight_operation_and_returns_committed_result(self):
        # Observe server state before GET; do not rely on a scheduler delay to start the writer.
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            writer = pool.submit(self.raw, "SET application_name='inventory-inflight'; BEGIN;" + movement() + 'SELECT pg_sleep(2); COMMIT;')
            deadline = time.monotonic() + 5
            while self.sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='inventory-inflight' AND wait_event='PgSleep'") != '1':
                if time.monotonic() > deadline:
                    self.fail('Writer did not reach the controlled commit boundary')
                time.sleep(0.01)
            result = json.loads(self.sql('SET ROLE service_role;' + lookup()).splitlines()[-1])
            self.assertEqual(writer.result().returncode, 0)
        self.assertEqual(result['quantityChange'], 1)
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'), '1')


if __name__ == '__main__':
    unittest.main(verbosity=2)
