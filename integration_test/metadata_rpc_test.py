"""Admin metadata acceptance tests; disposable local PostgreSQL only."""
import concurrent.futures
import json
import uuid
import unittest
import staff_rpc_test as db
import dine_in_rpc_test as orders

ZONE='60000000-0000-4000-8000-000000000001'
TABLE='70000000-0000-4000-8000-000000000001'


class MetadataRpcTest(db.PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.zones CASCADE;')
        orders.DineInRpcTest.setUp(self)
        self.sql(f"INSERT INTO public.zones(id,name) VALUES ('{ZONE}','Garden'); INSERT INTO public.tables(id,table_number,zone_id) VALUES ('{TABLE}','Table 1','{ZONE}');")

    def snapshot(self, resource='INGREDIENT', id=orders.INGREDIENT):
        table,fields={'INGREDIENT':('ingredients',"'name',name,'unit',unit,'min_threshold',min_threshold"),
                      'ZONE':('zones',"'name',name"),'TABLE':('tables',"'table_number',table_number,'zone_id',zone_id")}[resource]
        return json.loads(self.sql(f"SELECT jsonb_build_object({fields}) FROM public.{table} WHERE id='{id}'"))

    def command(self, resource='INGREDIENT', action='UPDATE', id=orders.INGREDIENT, item=None, expected=None, actor='user_admin', op=orders.OP):
        if resource=='INGREDIENT' and item is None: item={'name':'Updated stock','unit':'can','min_threshold':3.125}
        if action=='UPDATE' and expected is None: expected=self.snapshot(resource,id)
        body=dict(resource=resource,action=action,id=id,item=item,expected=expected)
        return f"SELECT public.fn_admin_metadata_action({db.literal(actor)},'{op}',{db.literal(json.dumps(body))}::jsonb);"

    def execute(self,*args,**kwargs):
        return json.loads(self.sql('SET ROLE service_role;'+self.command(*args,**kwargs)).splitlines()[-1])

    def lookup(self,actor='user_admin',op=orders.OP):
        return f"SELECT public.fn_get_admin_metadata_operation('{actor}','{op}');"

    def raw(self,statement):
        return self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-At','-c',statement,check=False)

    def test_bootstrap_upgrade_repeatable_grants_and_restrict_foreign_keys(self):
        for sig in ['fn_admin_metadata_action(text,uuid,jsonb)','fn_get_admin_metadata_operation(text,uuid)']:
            query=f"SELECT pg_get_functiondef('public.{sig}'::regprocedure)"
            self.assertEqual(self.sql(query),self.sql(query,db='bootstrap_check'))
        self.sql('GRANT ALL ON public.ingredients,public.zones,public.tables TO anon,authenticated; GRANT UPDATE(stock_quantity),INSERT(id,name) ON public.ingredients TO authenticated; GRANT UPDATE(name) ON public.zones TO anon; GRANT UPDATE(status),INSERT(id) ON public.tables TO authenticated;')
        self.sql((db.ROOT/'supabase/migrations/202610220010_admin_metadata.sql').read_text(encoding='utf-8'))
        for role in ['anon','authenticated']:
            for cmd in [self.command(),self.lookup(),'UPDATE public.ingredients SET stock_quantity=0','DELETE FROM public.ingredients','UPDATE public.zones SET name=\'X\'',
                        'DELETE FROM public.zones','UPDATE public.tables SET status=\'AVAILABLE\'','DELETE FROM public.tables','TRUNCATE public.zones CASCADE',
                        "INSERT INTO public.zones(name) VALUES ('X')","INSERT INTO public.ingredients(name,unit) VALUES ('X','can')",
                        f"INSERT INTO public.tables(table_number,zone_id) VALUES ('X','{ZONE}')"]:
                self.sql(f'SET ROLE {role};'+cmd,error='42501')
        self.sql("SET ROLE service_role; SELECT private.assert_metadata_fields('ZONE','{}')",error='42501')
        self.assertEqual(self.sql("SELECT string_agg(confdeltype::text,',' ORDER BY conname) FROM pg_constraint WHERE conname IN ('tables_zone_id_fkey','staff_profiles_assigned_zone_id_fkey','table_sessions_table_id_fkey')"),'r,r,r')

    def test_ingredient_metadata_never_changes_stock_cost_or_logs_and_create_defaults_zero(self):
        before=self.snapshot(); result=self.execute(expected=before)
        self.assertEqual(self.sql('SELECT stock_quantity||\':\'||unit_cost FROM public.ingredients'),'10:12')
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs'),'0')
        self.assertEqual(self.execute(expected=before),result)
        id=str(uuid.uuid4()); self.execute(action='CREATE',id=id,op=str(uuid.uuid4()))
        self.assertEqual(self.sql(f"SELECT stock_quantity||':'||unit_cost FROM public.ingredients WHERE id='{id}'"),'0:0')
        self.assertEqual(set(result),{'operationId','resource','action','entityId'})

    def test_unit_changes_require_zero_stock_no_history_or_mapping(self):
        before=self.snapshot();item={**before,'unit':'bottle'}
        self.sql(self.command(item=item,expected=before),error='P1603')
        self.sql('UPDATE public.ingredients SET stock_quantity=0')
        self.sql(self.command(item=item,expected=before),error='P1603') # menu mapping even at stock0
        self.sql('UPDATE public.menu_items SET linked_ingredient_id=NULL')
        self.sql(f"INSERT INTO public.inventory_logs(ingredient_id,type,quantity_change,total_cost) VALUES ('{orders.INGREDIENT}','IMPORT',1,12)")
        self.sql(self.command(item=item,expected=before),error='P1603')
        fresh=str(uuid.uuid4()); self.execute(action='CREATE',id=fresh,op=str(uuid.uuid4()))
        self.execute(id=fresh,item={**self.snapshot(id=fresh),'unit':'kg'},op=str(uuid.uuid4()))
        self.assertEqual(self.snapshot(id=fresh)['unit'],'kg')

    def test_admin_roles_revalidated_for_post_lookup_replay_and_scope(self):
        before=self.snapshot();result=self.execute(expected=before)
        self.assertEqual(json.loads(self.sql(self.lookup())),result)
        for actor in ['user_staff','user_kitchen','user_missing']:
            self.sql(self.command(actor=actor),error='42501');self.sql(self.lookup(actor),error='42501')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_other','Other','admin')")
        self.assertEqual(self.sql(self.lookup('user_other')),'')
        self.sql("UPDATE public.staff_profiles SET role='staff' WHERE id='user_admin'")
        self.sql(self.command(expected=before),error='42501');self.sql(self.lookup(),error='42501')
        self.sql("UPDATE public.staff_profiles SET role='admin',is_active=false WHERE id='user_admin'")
        self.sql(self.lookup(),error='42501')

    def test_stale_and_key_payload_conflicts_roll_back(self):
        before=self.snapshot();self.execute(expected=before)
        self.sql(self.command(item={**before,'name':'Other'},expected=before,op=str(uuid.uuid4())),error='P1602')
        self.sql(self.command(item={**before,'name':'Other'},expected=before),error='22000')
        self.assertEqual(self.snapshot()['name'],'Updated stock')
        self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='metadata.action'"),'1')

    def test_zone_create_rename_delete_replay_and_no_cascade(self):
        id=str(uuid.uuid4());op=str(uuid.uuid4())
        result=self.execute('ZONE','CREATE',id,{'name':'New'},op=op)
        self.assertEqual(self.execute('ZONE','CREATE',id,{'name':'New'},op=op),result)
        self.execute('ZONE','UPDATE',id,{'name':'Changed'},{'name':'New'},op=str(uuid.uuid4()))
        self.execute('ZONE','DELETE',id,expected={'name':'Changed'},op=str(uuid.uuid4()))
        self.assertEqual(self.execute('ZONE','CREATE',id,{'name':'New'},op=op),result)
        self.sql(self.command('ZONE','DELETE',ZONE,expected={'name':'Garden'}),error='23503')
        self.assertEqual(self.sql('SELECT count(*) FROM public.tables'),'1')
        self.sql(f"UPDATE public.staff_profiles SET assigned_zone_id='{ZONE}' WHERE id='user_staff'; DELETE FROM public.tables")
        self.sql(self.command('ZONE','DELETE',ZONE,expected={'name':'Garden'}),error='23503')
        self.assertEqual(self.sql("SELECT assigned_zone_id FROM public.staff_profiles WHERE id='user_staff'"),ZONE)

    def test_table_create_metadata_and_deletion_keep_lifecycle_server_owned(self):
        id=str(uuid.uuid4());item={'table_number':'New table','zone_id':ZONE}
        self.execute('TABLE','CREATE',id,item)
        self.assertEqual(self.sql(f"SELECT status||':'||(current_session_id IS NULL) FROM public.tables WHERE id='{id}'"),'AVAILABLE:true')
        self.execute('TABLE','UPDATE',id,{**item,'table_number':'Changed'},item,op=str(uuid.uuid4()))
        self.execute('TABLE','DELETE',id,expected={**item,'table_number':'Changed'},op=str(uuid.uuid4()))
        self.assertEqual(self.sql(f"SELECT count(*) FROM public.tables WHERE id='{id}'"),'0')

    def test_occupied_pointer_or_unclosed_session_blocks_edit_delete_and_history_prevents_delete(self):
        before=self.snapshot('TABLE',TABLE)
        for condition,cleanup in [("UPDATE public.tables SET status='OCCUPIED'","UPDATE public.tables SET status='AVAILABLE'"),
                                  (f"UPDATE public.tables SET current_session_id='{orders.SESSION}'","UPDATE public.tables SET current_session_id=NULL"),
                                  (f"UPDATE public.table_sessions SET table_id='{TABLE}' WHERE id='{orders.SESSION}'","UPDATE public.table_sessions SET table_id=NULL")]:
            self.sql(condition)
            self.sql(self.command('TABLE','UPDATE',TABLE,{**before,'table_number':'Wrong'},before),error='P1604')
            self.sql(self.command('TABLE','DELETE',TABLE,expected=before),error='P1604');self.sql(cleanup)
        self.sql(f"UPDATE public.table_sessions SET table_id='{TABLE}',status='CLOSED' WHERE id='{orders.SESSION}'")
        self.sql(self.command('TABLE','DELETE',TABLE,expected=before),error='23503')
        self.assertEqual(self.sql(f"SELECT table_id FROM public.table_sessions WHERE id='{orders.SESSION}'"),TABLE)

    def test_validation_spoofed_stock_state_actor_and_threshold_bounds(self):
        before=self.snapshot()
        for changes in [{'stock_quantity':0},{'unit_cost':0},{'created_by':'fake'},{'min_threshold':-1},{'min_threshold':1.0001},
                        {'min_threshold':1e13},{'min_threshold':'NaN'},{'unit':''},{'unit':'x'*31},{'name':' '}]:
            self.sql(self.command(item={**before,**changes}),error='22023')
        self.sql(self.command('TABLE','CREATE',str(uuid.uuid4()),{'table_number':'X','zone_id':ZONE,'status':'OCCUPIED'}),error='22023')
        self.sql(self.command('TABLE','CREATE',str(uuid.uuid4()),{'table_number':'X','zone_id':str(uuid.uuid4())}),error='23503')
        self.sql(self.command(action='DELETE',expected=before),error='22023')
        self.sql(self.command(action='CREATE',expected=before),error='22023')
        self.assertEqual(self.sql("SELECT count(*) FROM private.operation_requests WHERE action='metadata.action'"),'0')

    def test_concurrent_edit_and_stock_import_preserve_both_changes(self):
        from inventory_rpc_test import movement
        before=self.snapshot()
        import_sql=movement(quantity=2,cost=20,note='test',op=str(uuid.uuid4()))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(self.raw,[self.command(expected=before),import_sql]))
        self.assertTrue(all(r.returncode==0 for r in results),[r.stderr for r in results])
        self.assertEqual(self.snapshot()['name'],'Updated stock')
        self.assertEqual(self.sql('SELECT stock_quantity||\':\'||unit_cost FROM public.ingredients'),'12:20')

    def test_concurrent_edit_only_one_snapshot_wins_and_commit_failure_rolls_back(self):
        before=self.snapshot()
        commands=[self.command(item={**before,'name':name},expected=before,op=str(uuid.uuid4())) for name in ['A','B']]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(self.raw,commands))
        self.assertEqual(sum(r.returncode==0 for r in results),1);self.assertTrue(any('P1602:' in r.stderr for r in results))
        before=self.snapshot()
        self.sql("CREATE FUNCTION public.test_metadata_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fault'; END; $$; CREATE TRIGGER test_metadata_fail BEFORE UPDATE ON private.operation_requests FOR EACH ROW EXECUTE FUNCTION public.test_metadata_fail();")
        try:
            self.sql(self.command(expected=before),error='P0001');self.assertEqual(self.snapshot(),before)
        finally:self.sql('DROP TRIGGER test_metadata_fail ON private.operation_requests; DROP FUNCTION public.test_metadata_fail();')


if __name__=='__main__':unittest.main(verbosity=2)
