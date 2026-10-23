"""Durable operation helper tests; isolated PostgreSQL, no application credentials."""
import concurrent.futures
import json
import unittest
import staff_rpc_test as dbtest

OP = '12345678-1234-4234-8234-123456789abc'


def begin(scope='test:session', body=None, action='test.order', actor=None):
    request = json.dumps(body if body is not None else {'qty': 1})
    actor_sql = 'NULL' if actor is None else dbtest.literal(actor)
    return (f"SELECT private.begin_operation({dbtest.literal(scope)}, '{OP}', "
            f"{dbtest.literal(action)}, {dbtest.literal(request)}::jsonb, NULL, {actor_sql});")


def complete(result=None, scope='test:session'):
    result = json.dumps(result if result is not None else {'accepted': True})
    return f"SELECT private.complete_operation({dbtest.literal(scope)}, '{OP}', {dbtest.literal(result)}::jsonb);"


class OperationRpcTest(dbtest.PostgresTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Test-only business transaction used to prove helper atomicity. This is
        # not shipped in schema.sql and is not evidence for customer auth itself.
        cls.sql('''
            CREATE TABLE public.test_effects(id int PRIMARY KEY, count int NOT NULL);
            INSERT INTO public.test_effects VALUES (1,0);
            CREATE FUNCTION public.test_business(p_scope text, p_op uuid, p_body jsonb, p_fail boolean DEFAULT false)
            RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
            DECLARE v_claim jsonb; v_result jsonb; v_count int;
            BEGIN
                v_claim := private.begin_operation(p_scope,p_op,'test.order',p_body,NULL,NULL);
                IF (v_claim->>'replay')::boolean THEN RETURN v_claim->'result'; END IF;
                PERFORM pg_sleep(0.15);
                UPDATE public.test_effects SET count=count+1 WHERE id=1 RETURNING count INTO v_count;
                IF p_fail THEN RAISE EXCEPTION 'Injected failure' USING ERRCODE='P0001'; END IF;
                v_result := jsonb_build_object('accepted',true,'effect',v_count);
                RETURN private.complete_operation(p_scope,p_op,v_result);
            END;
            $$;
            REVOKE ALL ON FUNCTION public.test_business(text,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
            GRANT EXECUTE ON FUNCTION public.test_business(text,uuid,jsonb,boolean) TO service_role;
        ''')

    def setUp(self):
        self.sql('TRUNCATE private.operation_requests; UPDATE public.test_effects SET count=0;')

    def test_atomic_commit_and_replay_across_connections(self):
        self.sql('BEGIN;' + begin() + complete() + 'COMMIT;')
        replay = json.loads(self.sql(begin()))
        self.assertEqual(replay, {'replay': True, 'result': {'accepted': True}})
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '1')

    def test_reordered_object_keys_have_same_fingerprint(self):
        self.sql('BEGIN;' + begin(body={'qty': 1, 'note': 'less spicy'}) + complete() + 'COMMIT;')
        self.assertTrue(json.loads(self.sql(begin(body={'note': 'less spicy', 'qty': 1})))['replay'])

    def test_changed_body_or_action_conflicts(self):
        self.sql('BEGIN;' + begin() + complete() + 'COMMIT;')
        self.sql(begin(body={'qty': 2}), error='22000')
        self.sql(begin(action='test.return'), error='22000')

    def test_scope_isolation(self):
        self.sql('BEGIN;' + begin() + complete() + 'COMMIT;')
        self.sql('BEGIN;' + begin(scope='test:other') + complete(scope='test:other') + 'COMMIT;')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '2')

    def test_incomplete_claim_cannot_commit(self):
        self.sql('BEGIN;' + begin() + 'UPDATE public.test_effects SET count=1; COMMIT;', error='23514')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')
        self.assertEqual(self.sql('SELECT count FROM public.test_effects'), '0')

    def test_failure_rolls_back_business_and_claim_then_retry_succeeds(self):
        call = f"SELECT public.test_business('test:session','{OP}','{{\"qty\":1}}',true);"
        self.sql('SET ROLE service_role;' + call, error='P0001')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')
        self.assertEqual(self.sql('SELECT count FROM public.test_effects'), '0')
        self.sql('SET ROLE service_role;' + call.replace(',true)', ',false)'))
        self.assertEqual(self.sql('SELECT count FROM public.test_effects'), '1')

    def test_concurrent_same_key_applies_once(self):
        call = f"SET ROLE service_role; SELECT public.test_business('test:session','{OP}','{{\"qty\":1}}');"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.sql, [call, call]))
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.sql('SELECT count FROM public.test_effects'), '1')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '1')

    def test_ledger_and_helpers_are_denied_to_public_and_service_roles(self):
        for role in ('anon', 'authenticated', 'service_role'):
            self.sql(f'SET ROLE {role}; SELECT * FROM private.operation_requests;', error='42501')
            self.sql(f'SET ROLE {role};' + begin(), error='42501')
            self.sql(f'SET ROLE {role};' + complete(), error='42501')
        self.assertEqual(self.sql("SELECT relrowsecurity FROM pg_class WHERE oid='private.operation_requests'::regclass"), 't')
        self.assertEqual(self.sql("SELECT count(*) FROM pg_publication_tables WHERE schemaname='private'"), '0')

    def test_completed_result_is_immutable(self):
        self.sql('BEGIN;' + begin() + complete() + 'COMMIT;')
        self.sql(complete(result={'accepted': False}), error='22000')
        self.assertEqual(json.loads(self.sql(complete())), {'accepted': True})

    def test_rls_hides_rows_even_if_read_grants_are_accidentally_added(self):
        self.sql('BEGIN;' + begin() + complete() + 'COMMIT;')
        result = self.sql('BEGIN; GRANT USAGE ON SCHEMA private TO authenticated; '
                          'GRANT SELECT ON private.operation_requests TO authenticated; '
                          'SET LOCAL ROLE authenticated; SELECT count(*) FROM private.operation_requests; ROLLBACK;')
        self.assertIn('0', result.splitlines())

    def test_pending_duplicate_in_same_transaction_is_rejected(self):
        self.sql('BEGIN;' + begin() + begin() + 'COMMIT;', error='55000')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')

    def test_failure_after_complete_still_rolls_back_effect_and_result(self):
        self.sql('BEGIN;' + begin() + 'UPDATE public.test_effects SET count=1;' + complete() +
                 "DO $$ BEGIN RAISE EXCEPTION 'late failure'; END $$; COMMIT;", error='P0001')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')
        self.assertEqual(self.sql('SELECT count FROM public.test_effects'), '0')

    def test_cannot_complete_unclaimed_operation(self):
        self.sql(complete(), error='P0002')

    def test_invalid_requests_and_result_bounds_rollback(self):
        self.sql('BEGIN;' + begin() + complete(result=['not-object']) + 'COMMIT;', error='22023')
        self.sql('BEGIN;' + begin() + complete(result={'padding': 'x' * 65536}) + 'COMMIT;', error='22023')
        self.sql(begin(body={'padding': 'x' * 32768}), error='22023')
        self.sql(begin(scope=' '), error='22023')
        self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests'), '0')

    def test_no_raw_request_stored_and_hash_is_sha256(self):
        self.sql('BEGIN;' + begin(body={'note': 'do-not-store-this-note'}) + complete() + 'COMMIT;')
        row = json.loads(self.sql('SELECT row_to_json(op) FROM private.operation_requests AS op;'))
        self.assertEqual(len(row['request_hash']), 64)
        self.assertNotIn('do-not-store-this-note', json.dumps(row))
        self.assertIsNotNone(row['completed_at'])

    def test_missing_actor_fk_and_different_actor_cannot_retarget(self):
        self.sql(begin(actor='user_missing'), error='23503')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_actor','Test','staff');")
        self.sql('BEGIN;' + begin(actor='user_actor') + complete() + 'COMMIT;')
        self.sql(begin(actor=None), error='22000')

    def test_bootstrap_and_upgrade_functions_match(self):
        for signature in ['private.begin_operation(text,uuid,text,jsonb,uuid,text)', 'private.complete_operation(text,uuid,jsonb)']:
            query = f"SELECT pg_get_functiondef('{signature}'::regprocedure);"
            self.assertEqual(self.sql(query), self.sql(query, db='bootstrap_check'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
