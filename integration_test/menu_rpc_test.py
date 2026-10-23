"""Menu mutation acceptance tests in a disposable PostgreSQL cluster only."""
import concurrent.futures
import json
import uuid
import unittest
import staff_rpc_test as db
import dine_in_rpc_test as orders


class MenuRpcTest(db.PostgresTestCase):
    def setUp(self):
        orders.DineInRpcTest.setUp(self)

    def snapshot(self, menu=orders.FOOD):
        return json.loads(self.sql(f"SELECT to_jsonb(m)-'id' FROM public.menu_items m WHERE id='{menu}'"))

    def command(self, action='AVAILABILITY', menu=orders.FOOD, item=None, expected=None, actor='user_kitchen', op=orders.OP):
        if action == 'AVAILABILITY':
            item = {'is_available': False} if item is None else item
            expected = {'is_available': True} if expected is None else expected
        body = dict(action=action, id=menu, item=item, expected=expected)
        return f"SELECT public.fn_menu_action({db.literal(actor)},'{op}',{db.literal(json.dumps(body))}::jsonb);"

    def execute(self, *args, **kwargs):
        return json.loads(self.sql('SET ROLE service_role;' + self.command(*args, **kwargs)).splitlines()[-1])

    def lookup(self, actor='user_kitchen', op=orders.OP):
        return f"SELECT public.fn_get_menu_action_operation('{actor}','{op}');"

    def raw(self, statement):
        return self.cli('psql', '-X', '-w', '-h', '127.0.0.1', '-p', self.port, '-U', 'postgres', '-d', 'postgres',
                        '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At', '-c', statement, check=False)

    def test_upgrade_bootstrap_and_repeatable_grants(self):
        for signature in ['fn_menu_action(text,uuid,jsonb)', 'fn_get_menu_action_operation(text,uuid)']:
            query = f"SELECT pg_get_functiondef('public.{signature}'::regprocedure)"
            self.assertEqual(self.sql(query), self.sql(query, db='bootstrap_check'))
        self.sql('GRANT ALL ON public.menu_items TO anon,authenticated; GRANT UPDATE(price,is_available),INSERT(id,name) ON public.menu_items TO authenticated;')
        self.sql((db.ROOT / 'supabase/migrations/202610220009_menu_actions.sql').read_text(encoding='utf-8'))
        for role in ['anon', 'authenticated']:
            for statement in [self.command(), self.lookup(), 'UPDATE public.menu_items SET is_available=false', 'DELETE FROM public.menu_items',
                              'TRUNCATE public.menu_items CASCADE', "INSERT INTO public.menu_items(name,category,station,price) VALUES ('X','FOOD','KITCHEN',1)"]:
                self.sql(f'SET ROLE {role};' + statement, error='42501')
        self.sql("SET ROLE service_role; SELECT private.assert_menu_fields('{}')", error='42501')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='menu_items'"), '1')

    def test_create_update_delete_commit_and_replay_without_reapplying(self):
        menu = str(uuid.uuid4()); item = {**self.snapshot(), 'name': 'New menu'}
        result = self.execute('CREATE', menu=menu, item=item, actor='user_admin')
        self.assertEqual(set(result), {'operationId', 'action', 'menuItemId'})
        self.assertEqual(self.execute('CREATE', menu=menu, item=item, actor='user_admin'), result)
        updated = {**item, 'price': 120.25}
        self.execute('UPDATE', menu=menu, item=updated, expected=item, actor='user_admin', op=str(uuid.uuid4()))
        self.assertEqual(self.snapshot(menu), updated)
        delete_op = str(uuid.uuid4())
        deleted = self.execute('DELETE', menu=menu, expected=updated, actor='user_admin', op=delete_op)
        self.assertEqual(self.execute('DELETE', menu=menu, expected=updated, actor='user_admin', op=delete_op), deleted)
        self.assertEqual(self.execute('CREATE', menu=menu, item=item, actor='user_admin'), result)
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.menu_items WHERE id='{menu}'"), '0')

    def test_kitchen_only_availability_no_stock_price_or_snapshot_changes(self):
        self.sql(orders.order([orders.line(orders.BEER, 2, 20)]))
        before = self.snapshot(orders.BEER)
        logs = self.sql('SELECT count(*) FROM public.inventory_logs')
        result = self.execute(menu=orders.BEER)
        self.assertEqual(self.snapshot(orders.BEER), {**before, 'is_available': False})
        self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'), '8')
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'), logs)
        self.assertEqual(self.sql('SELECT unit_price||\':\'||unit_cost_price FROM public.order_items'), '20:13')
        self.assertEqual(json.loads(self.sql(self.lookup())), result)
        for action in ['CREATE', 'UPDATE', 'DELETE']:
            self.sql(self.command(action, item=before if action != 'DELETE' else None, expected=None if action == 'CREATE' else before), error='42501')

    def test_staff_missing_disabled_and_demoted_roles_cannot_bypass_rpc_or_replay(self):
        for actor in ['user_staff', 'user_missing']:
            self.sql(self.command(actor=actor), error='42501')
            self.sql(self.lookup(actor), error='42501')
        self.execute(actor='user_admin')
        before = self.snapshot()
        self.execute('UPDATE', actor='user_admin', item={**before, 'price': 150}, expected=before, op=str(uuid.uuid4()))
        self.sql("UPDATE public.staff_profiles SET role='kitchen' WHERE id='user_admin'")
        # An admin's saved metadata action cannot be retrieved after demotion.
        op = self.sql("SELECT operation_id FROM private.operation_requests WHERE result->>'action'='UPDATE'")
        self.sql(self.lookup('user_admin', op), error='42501')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_admin'")
        self.sql(self.command(actor='user_admin'), error='42501')
        self.sql(self.lookup('user_admin'), error='42501')

    def test_stale_expected_and_duplicate_key_do_not_overwrite(self):
        before = self.snapshot()
        self.execute()
        self.sql(self.command('UPDATE', actor='user_admin', item={**before, 'price': 200}, expected=before), error='P1502')
        self.sql(self.command(item={'is_available': True}), error='22000')
        self.assertEqual(self.snapshot()['price'], 100)
        self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE scope_key='menu-action:user_admin'"), '0')
        self.assertEqual(self.sql(self.lookup('user_admin')), '')

    def test_history_protects_delete_and_routing_but_allows_price_changes(self):
        self.sql(orders.order())
        before = self.snapshot()
        self.sql(self.command('DELETE', actor='user_admin', expected=before), error='P1503')
        for change in [{'category': 'OTHER'}, {'station': 'BAR_INSTANT'}]:
            self.sql(self.command('UPDATE', actor='user_admin', item={**before, **change}, expected=before), error='P1503')
        self.execute('UPDATE', actor='user_admin', item={**before, 'price': 500, 'cost_price': 200, 'name': 'Updated name'}, expected=before)
        self.assertEqual(self.sql('SELECT unit_price||\':\'||unit_cost_price FROM public.order_items'), '100:40')
        self.assertEqual(self.sql(f"SELECT total_amount FROM public.table_sessions WHERE id='{orders.SESSION}'"), '100')
        self.sql(orders.order([orders.line(orders.BEER, 1, 20)], op=str(uuid.uuid4())))
        before = self.snapshot(orders.BEER)
        self.sql(self.command('UPDATE', menu=orders.BEER, actor='user_admin', item={**before, 'linked_ingredient_id': None}, expected=before, op=str(uuid.uuid4())), error='P1503')

    def test_whitelist_nulls_malformed_numeric_and_food_mapping(self):
        before = self.snapshot()
        for change in [{'price': -1}, {'price': 1.001}, {'price': 1e13}, {'cost_price': 'NaN'}, {'prep_time_minutes': 1.5},
                       {'prep_time_minutes': 1441}, {'name': ' '}, {'station': 'BAR'}, {'image_url': 'javascript:alert(1)'},
                       {'linked_ingredient_id': orders.INGREDIENT}, {'served_at': 'fake'}, {'is_available': None}]:
            self.sql(self.command('CREATE', menu=str(uuid.uuid4()), item={**before, **change}, actor='user_admin'), error='22023')
        self.sql(self.command(item={'is_available': False, 'price': 0}), error='22023')
        self.sql(self.command(expected={}), error='22023')
        self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='menu.action'"), '0')

    def test_missing_id_duplicate_id_and_bad_link_rollback(self):
        before = self.snapshot()
        self.sql(self.command(menu=str(uuid.uuid4())), error='P1501')
        self.sql(self.command('CREATE', item=before, actor='user_admin'), error='23505')
        bad = {**self.snapshot(orders.BEER), 'linked_ingredient_id': str(uuid.uuid4())}
        self.sql(self.command('CREATE', menu=str(uuid.uuid4()), item=bad, actor='user_admin'), error='23503')
        self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='menu.action'"), '0')

    def test_concurrent_toggle_and_metadata_update_one_expected_snapshot_wins(self):
        before = self.snapshot()
        commands = [self.command(), self.command('UPDATE', actor='user_admin', item={**before, 'price': 200}, expected=before)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(self.raw, commands))
        # UPDATE first permits the narrow availability CAS; availability first makes the full editor stale.
        self.assertTrue(results[0].returncode == 0)
        self.assertTrue(results[1].returncode == 0 or 'P1502:' in results[1].stderr)
        self.assertFalse(self.snapshot()['is_available'])
        commands = [self.command(item={'is_available': True}, expected={'is_available': False}, actor=actor, op=str(uuid.uuid4())) for actor in ['user_admin', 'user_kitchen']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(self.raw, commands))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertTrue(any('P1502:' in r.stderr for r in results))

    def test_order_racing_unavailability_is_atomic_and_future_orders_blocked(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(self.raw, [self.command(), orders.order()]))
        self.assertEqual(results[0].returncode, 0)
        if results[1].returncode:
            self.assertIn('P1002:', results[1].stderr)
            self.assertEqual(self.sql('SELECT count(*) FROM public.order_items'), '0')
        else:
            self.assertEqual(self.sql('SELECT unit_price FROM public.order_items'), '100')
        self.sql(orders.order(op=str(uuid.uuid4())), error='P1002')

    def test_ledger_failure_rolls_back_menu_mutation(self):
        self.sql("CREATE FUNCTION public.test_menu_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fault'; END; $$; CREATE TRIGGER test_menu_fail BEFORE UPDATE ON private.operation_requests FOR EACH ROW EXECUTE FUNCTION public.test_menu_fail();")
        try:
            self.sql(self.command(), error='P0001')
            self.assertTrue(self.snapshot()['is_available'])
            self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='menu.action'"), '0')
        finally: self.sql('DROP TRIGGER test_menu_fail ON private.operation_requests; DROP FUNCTION public.test_menu_fail();')


if __name__ == '__main__':
    unittest.main(verbosity=2)
