"""Read authorization on disposable PostgreSQL only; never uses app env credentials."""
import json
import unittest
import staff_rpc_test as db
from dine_in_rpc_test import SESSION, SECOND, FOOD, TOKEN, order

TABLES = ['zones','staff_profiles','tables','ingredients','inventory_logs','menu_items','table_sessions','order_items']
VIEWS = ['vw_kpi_financial_summary','vw_kpi_peak_hours','vw_kpi_menu_analytics','vw_kpi_kitchen_performance','vw_kpi_waitstaff_performance']
MIGRATION = db.ROOT / 'supabase/migrations/202610220012_read_boundaries.sql'


class ReadBoundaryTest(db.PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.zones, public.staff_profiles, public.menu_items, public.table_sessions, public.ingredients CASCADE;')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role,push_subscription) VALUES ('user_admin','Admin','admin','{\"endpoint\":\"private-push\"}');")
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES ('{FOOD}','Food','FOOD','KITCHEN',100,40);")
        self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status,customer_phone) VALUES ('{SESSION}','{TOKEN}','DINE_IN','ACTIVE','private-phone'),('{SECOND}','other-secret','DINE_IN','ACTIVE','other-phone');")
        self.sql(order())

    def apply_read_migrations(self):
        self.sql(MIGRATION.read_text(encoding='utf-8'))
        self.sql((db.ROOT/'supabase/migrations/202610220013_notification_worker.sql').read_text(encoding='utf-8'))

    def snapshot(self, token=TOKEN):
        return json.loads(self.sql('SET ROLE service_role; SELECT public.fn_get_dine_in_snapshot(' + db.literal(token) + ');').splitlines()[-1])

    def test_bootstrap_upgrade_parity_and_rls_all_eight_tables(self):
        query = "SELECT pg_get_functiondef('public.fn_get_dine_in_snapshot(text)'::regprocedure);"
        self.assertEqual(self.sql(query), self.sql(query, db='bootstrap_check'))
        self.assertEqual(self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity"), '8')

    def test_public_roles_cannot_read_base_tables_views_columns_or_execute(self):
        for role in ['anon','authenticated']:
            for table in TABLES + VIEWS:
                self.sql(f'SET ROLE {role}; SELECT * FROM public.{table};', error='42501')
            self.sql(f"SET ROLE {role}; SELECT session_token FROM public.table_sessions;", error='42501')
            self.sql(f'SET ROLE {role}; SELECT public.fn_get_dine_in_snapshot({db.literal(TOKEN)});', error='42501')
            self.sql(f"SET ROLE {role}; SELECT * FROM public.fn_get_financial_kpi(now()-interval '1 day',now());", error='42501')
            for table in TABLES:
                self.sql(f'SET ROLE {role}; DELETE FROM public.{table};', error='42501')
                self.sql(f'SET ROLE {role}; TRUNCATE public.{table} CASCADE;', error='42501')
                for privilege in ['SELECT','INSERT','UPDATE','REFERENCES']:
                    self.assertEqual(self.sql(f"SELECT has_any_column_privilege('{role}','public.{table}','{privilege}');"),'f')

    def test_restrictive_rls_still_denies_rows_with_legacy_permissive_policy_and_grants(self):
        self.sql('CREATE POLICY old_allow_all ON public.table_sessions FOR ALL TO anon USING (true) WITH CHECK (true); GRANT ALL ON public.table_sessions TO anon;')
        try:
            self.assertEqual(self.sql('SET ROLE anon; SELECT count(*) FROM public.table_sessions;').splitlines()[-1],'0')
            self.sql("SET ROLE anon; INSERT INTO public.table_sessions(session_token,session_type,status) VALUES ('rogue','DINE_IN','ACTIVE');",error='42501')
        finally:
            self.sql('DROP POLICY old_allow_all ON public.table_sessions;')
            self.apply_read_migrations()

    def test_upgrade_removes_even_legacy_column_select_and_execute_grants(self):
        self.sql('GRANT ALL ON public.table_sessions,public.staff_profiles TO PUBLIC,anon,authenticated,service_role; GRANT SELECT(session_token),UPDATE(status) ON public.table_sessions TO anon,authenticated,service_role; GRANT UPDATE(role) ON public.staff_profiles TO service_role; '
                 'GRANT SELECT(gross_revenue) ON public.vw_kpi_financial_summary TO anon; GRANT EXECUTE ON FUNCTION public.fn_get_financial_kpi(timestamptz,timestamptz) TO PUBLIC;')
        self.apply_read_migrations()
        self.test_public_roles_cannot_read_base_tables_views_columns_or_execute()
        self.test_service_can_read_all_guarded_sources_but_not_private_raw_tables()

    def test_guest_snapshot_has_no_other_rows_cost_contact_actor_stock_or_push(self):
        self.sql(order(session=SECOND,token='other-secret',op='40000000-0000-4000-8000-000000000002',lines=[dict(menu_item_id=FOOD,quantity=1,note='private-other-note',expected_price=100)]))
        result = self.snapshot()
        self.assertEqual(len(result['items']),1)
        self.assertEqual(result['items'][0]['session_id'], SESSION)
        self.assertEqual(set(result['session']), {'id','status','payment_method'})
        self.assertEqual(set(result['menu'][0]), {'id','name','category','station','price','prep_time_minutes','image_url','is_available'})
        encoded = json.dumps(result)
        for secret in [SECOND,'other-secret','private-other-note','customer_phone','unit_cost_price','cost_price','served_by_staff_id','cancelled_by','stock_export_log_id','stock_quantity','push_subscription']:
            self.assertNotIn(secret, encoded)

    def test_only_own_live_dine_in_token_is_accepted(self):
        for token in ['wrong',SESSION,'', 'x'*257]:
            self.sql(f'SET ROLE service_role; SELECT public.fn_get_dine_in_snapshot({db.literal(token)});', error='P0002')
        for status in ['CLOSED','PENDING_PAYMENT']:
            self.sql(f"UPDATE public.table_sessions SET status='{status}' WHERE id='{SESSION}';")
            self.sql(f'SET ROLE service_role; SELECT public.fn_get_dine_in_snapshot({db.literal(TOKEN)});', error='P0002')
        self.sql(f"UPDATE public.table_sessions SET status='REQUEST_BILL' WHERE id='{SESSION}';")
        self.assertEqual(self.snapshot()['session']['status'],'REQUEST_BILL')
        self.sql(f"UPDATE public.table_sessions SET session_type='TAKEAWAY',status='ACTIVE' WHERE id='{SESSION}';")
        self.sql(f'SET ROLE service_role; SELECT public.fn_get_dine_in_snapshot({db.literal(TOKEN)});', error='P0002')

    def test_queue_counts_only_earlier_live_kitchen_rows_without_exposing_them(self):
        self.sql(order(session=SECOND,token='other-secret',op='40000000-0000-4000-8000-000000000002'))
        self.sql(f"UPDATE public.order_items SET created_at='2026-10-22T01:00:00Z' WHERE session_id='{SECOND}'; UPDATE public.order_items SET created_at='2026-10-22T02:00:00Z' WHERE session_id='{SESSION}';")
        self.assertEqual(list(self.snapshot()['queuePositions'].values()),[2])
        self.sql(f"UPDATE public.table_sessions SET status='PENDING_PAYMENT' WHERE id='{SECOND}';")
        self.assertEqual(list(self.snapshot()['queuePositions'].values()),[1])
        self.sql(f"UPDATE public.table_sessions SET status='REQUEST_BILL' WHERE id='{SECOND}'; UPDATE public.order_items SET created_at='2026-10-22T02:00:00Z' WHERE session_id='{SECOND}';")
        self.assertEqual(list(self.snapshot()['queuePositions'].values()),[1])

    def test_service_can_read_all_guarded_sources_but_not_private_raw_tables(self):
        for table in TABLES + VIEWS:
            self.sql(f'SET ROLE service_role; SELECT * FROM public.{table};')
        for table in ['operation_requests','notification_outbox','menu_image_uploads']:
            self.sql(f'SET ROLE service_role; SELECT * FROM private.{table};', error='42501')
        self.sql("SET ROLE service_role; UPDATE public.staff_profiles SET push_subscription=null WHERE id='user_admin';", error='42501')
        self.sql("SET ROLE service_role; SELECT public.fn_set_push_subscription('user_admin',NULL,'expired-endpoint');")
        self.sql("SET ROLE service_role; UPDATE public.staff_profiles SET role='staff' WHERE id='user_admin';", error='42501')

    def test_finite_nonnegative_checks_and_returned_zero_quantity(self):
        for sql in [
            f"UPDATE public.menu_items SET price='NaN' WHERE id='{FOOD}'",
            f"UPDATE public.menu_items SET cost_price='Infinity' WHERE id='{FOOD}'",
            f"UPDATE public.order_items SET unit_price=-1 WHERE session_id='{SESSION}'",
            f"UPDATE public.order_items SET unit_cost_price='NaN' WHERE session_id='{SESSION}'",
            f"UPDATE public.table_sessions SET total_amount=-1 WHERE id='{SESSION}'",
            "INSERT INTO public.ingredients(name,unit,stock_quantity) VALUES ('bad','can',-1)",
            "INSERT INTO public.ingredients(name,unit,min_threshold) VALUES ('bad','can','NaN')",
            "INSERT INTO public.ingredients(name,unit,unit_cost) VALUES ('bad','can','Infinity')",
        ]:
            self.sql(sql,error='23514')
        self.sql(f"UPDATE public.order_items SET quantity=0 WHERE session_id='{SESSION}'")
        self.assertEqual(self.snapshot()['items'][0]['quantity'],0)
        self.sql("INSERT INTO public.ingredients(id,name,unit) VALUES ('30000000-0000-4000-8000-000000000001','Stock','can')")
        self.sql("INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost) VALUES ('30000000-0000-4000-8000-000000000001','IMPORT',-1,1)",error='23514')
        self.sql("INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost) VALUES ('30000000-0000-4000-8000-000000000001','EXPORT_SALE',1,1)",error='23514')

    def test_unique_live_table_and_invalid_pointer_upgrade_preflight(self):
        zone='60000000-0000-4000-8000-000000000001'; table='70000000-0000-4000-8000-000000000001'
        self.sql(f"INSERT INTO public.zones(id,name) VALUES ('{zone}','Zone'); INSERT INTO public.tables(id,table_number,zone_id) VALUES ('{table}','A1','{zone}'); UPDATE public.table_sessions SET table_id='{table}' WHERE id='{SESSION}';")
        self.sql(f"UPDATE public.table_sessions SET table_id='{table}' WHERE id='{SECOND}';",error='23505')
        self.sql(f"UPDATE public.tables SET current_session_id='{SECOND}' WHERE id='{table}';")
        self.sql(MIGRATION.read_text(encoding='utf-8'),error='23514')
        self.sql(f"UPDATE public.tables SET current_session_id=NULL WHERE id='{table}';")
        self.sql('DROP INDEX public.one_live_dine_in_per_table;')
        try:
            self.sql(f"UPDATE public.table_sessions SET table_id='{table}' WHERE id='{SECOND}';")
            self.sql(MIGRATION.read_text(encoding='utf-8'),error='23505')
            self.assertEqual(self.sql(f"SELECT count(*) FROM public.table_sessions WHERE table_id='{table}'"),'2')
        finally:
            self.sql(f"UPDATE public.table_sessions SET table_id=NULL WHERE id='{SECOND}';")
            self.apply_read_migrations()

    def test_explain_uses_read_indexes_on_large_fixture(self):
        self.sql("INSERT INTO public.table_sessions(session_token,session_type,status,opened_at) SELECT 'history-'||n,'TAKEAWAY','CLOSED',now()-n*interval '1 minute' FROM generate_series(1,12000) n;")
        self.sql(f"INSERT INTO public.order_items(session_id,menu_item_id,quantity,station,status,unit_price,unit_cost_price,created_at) SELECT CASE WHEN n%20=0 THEN '{SESSION}'::uuid ELSE '{SECOND}'::uuid END,'{FOOD}',1,'KITCHEN','QUEUED',100,40,now()-n*interval '1 minute' FROM generate_series(1,24000) n;")
        self.sql('ANALYZE public.table_sessions; ANALYZE public.order_items;')
        self.sql("INSERT INTO public.ingredients(id,name,unit) VALUES ('30000000-0000-4000-8000-000000000001','Stock','can'); INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost,created_at) SELECT '30000000-0000-4000-8000-000000000001',CASE WHEN n%2=0 THEN 'WASTAGE' ELSE 'IMPORT' END,CASE WHEN n%2=0 THEN -1 ELSE 1 END,1,now()-n*interval '1 minute' FROM generate_series(1,12000) n; ANALYZE public.inventory_logs;")
        for query,index in [
            ("SELECT id FROM public.table_sessions WHERE status='CLOSED' ORDER BY status DESC,opened_at DESC,id DESC LIMIT 26",'bill_status_page_idx'),
            (f"SELECT * FROM public.order_items WHERE session_id='{SESSION}' ORDER BY created_at,id LIMIT 25",'session_item_display_idx'),
            ("SELECT * FROM public.inventory_logs WHERE type='WASTAGE' ORDER BY created_at DESC,id DESC LIMIT 26",'inventory_type_page_idx'),
        ]:
            plan=self.sql('EXPLAIN (ANALYZE,BUFFERS) '+query)
            self.assertIn(index,plan)
            self.assertIn('Execution Time:',plan)
        # A tiny earlier time range can legitimately favor the existing time index.
        plan=self.sql("EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM public.order_items WHERE station='KITCHEN' AND status='QUEUED' AND created_at<now()-interval '23000 minutes'")
        self.assertTrue('idx_order_items_queue_lookup' in plan or 'idx_order_items_created_at' in plan,plan)


if __name__ == '__main__':
    unittest.main(verbosity=2)
