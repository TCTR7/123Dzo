"""Real PostgreSQL tests in a disposable loopback-only cluster; no app env/DB URL.

Run: python integration_test/staff_rpc_test.py
POSTGRES_BIN may point to a local PostgreSQL bin directory. Never accepts a DB URL.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('POSTGRES_BIN', 'C:/Program Files/PostgreSQL/17/bin'))
MIGRATION = ROOT / 'supabase/migrations/202610220001_admin_staff.sql'
ZONE = '11111111-1111-4111-8111-111111111111'


def profile(user='user_worker', role='staff', active=True, name='Test worker', zone=None):
    return dict(id=user, full_name=name, role=role, assigned_zone_id=zone, is_active=active)


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def save(actor, desired, expected=None):
    before = 'NULL' if expected is None else literal(json.dumps(expected)) + '::jsonb'
    return f'SELECT * FROM public.fn_admin_save_staff({literal(actor)}, {literal(json.dumps(desired))}::jsonb, {before});'


class PostgresTestCase(unittest.TestCase):
    @classmethod
    def cli(cls, binary, *args, check=True, input_text=None):
        executable = BIN / (binary + ('.exe' if os.name == 'nt' else ''))
        options = dict(text=True, encoding='utf-8', errors='replace', timeout=60,
                       env={**os.environ, 'PGCLIENTENCODING': 'UTF8'}, input=input_text,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        # A detached Windows postgres can inherit PIPE handles after pg_ctl exits.
        # Redirect startup output to the provided server log, never a Python PIPE.
        if binary == 'pg_ctl' and 'start' in args:
            result = subprocess.run([str(executable), *map(str, args)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
        else:
            result = subprocess.run([str(executable), *map(str, args)], capture_output=True, **options)
        if check and result.returncode:
            raise RuntimeError(result.stderr or result.stdout or 'PostgreSQL command failed; inspect disposable server log.')
        return result

    @classmethod
    def sql(cls, statement, db='postgres', error=None):
        result = cls.cli('psql', '-X', '-w', '-h', '127.0.0.1', '-p', cls.port, '-U', 'postgres',
                         '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At',
                         '-f', '-', check=False, input_text=statement)
        if error:
            if result.returncode == 0 or f'{error}:' not in result.stderr:
                raise AssertionError(f'Expected SQLSTATE {error}: {result.stderr or result.stdout}')
        elif result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip()

    @classmethod
    def setUpClass(cls):
        for name in ('initdb', 'pg_ctl', 'psql'):
            if not (BIN / (name + ('.exe' if os.name == 'nt' else ''))).is_file():
                raise RuntimeError(f'PostgreSQL binary missing: {name}; configure POSTGRES_BIN.')
        cls.temp_root = (ROOT / '.temp').resolve()
        cls.temp_root.mkdir(exist_ok=True)
        cls.workspace = Path(tempfile.mkdtemp(prefix='staff-rpc-', dir=cls.temp_root)).resolve()
        cls.data = cls.workspace / 'data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = str(sock.getsockname()[1])
        cls.started = False
        try:
            cls.cli('initdb', '-D', cls.data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--no-locale')
            cls.cli('pg_ctl', '-D', cls.data, '-l', cls.workspace / 'server.log', '-o',
                    f'-h 127.0.0.1 -p {cls.port} -c fsync=off -c synchronous_commit=off', '-w', 'start')
            cls.started = True
            cls.sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;')
            cls.sql('CREATE PUBLICATION supabase_realtime;')
            schema = (ROOT / 'supabase/schema.sql').read_text(encoding='utf-8')
            migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
            for migration_path in migrations:
                if migration_path.read_text(encoding='utf-8') not in schema:
                    raise AssertionError(f'Bootstrap schema differs from {migration_path.name}.')
            cls.sql(schema.split('-- Admin staff API (spec amendment 2026-10-22)')[0])
            # Simulate older deployments with both table and column write grants.
            cls.sql('GRANT ALL ON public.staff_profiles TO anon, authenticated; '
                    'GRANT UPDATE(role), INSERT(id, full_name, role) ON public.staff_profiles TO authenticated;')
            for migration_path in migrations:
                migration = migration_path.read_text(encoding='utf-8')
                cls.sql(migration)
                cls.sql(migration)  # repeatable upgrade
            cls.sql('CREATE DATABASE bootstrap_check;')
            cls.sql('CREATE PUBLICATION supabase_realtime;', db='bootstrap_check')
            cls.sql(schema, db='bootstrap_check')
        except Exception:
            cls.cleanup()
            raise

    @classmethod
    def cleanup(cls):
        if cls.started:
            result = cls.cli('pg_ctl', '-D', cls.data, '-m', 'immediate', '-w', 'stop', check=False)
            if result.returncode:
                raise RuntimeError('Could not stop disposable PostgreSQL; preserving its data directory.')
            cls.started = False
        # Check the resolved recursive-delete target before removal on Windows.
        if cls.workspace.parent != cls.temp_root or not cls.workspace.name.startswith('staff-rpc-'):
            raise RuntimeError('Refusing to remove an unexpected test directory.')
        shutil.rmtree(cls.workspace)

    @classmethod
    def tearDownClass(cls):
        cls.cleanup()


class StaffRpcTest(PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.staff_profiles CASCADE; '
                 "INSERT INTO public.zones(id,name) VALUES ('" + ZONE + "','Test zone') ON CONFLICT DO NOTHING;")
        for item in [profile('user_admin', 'admin', name='Test admin'), profile()]:
            self.sql('INSERT INTO public.staff_profiles(id,full_name,role,assigned_zone_id,is_active) VALUES (' +
                     ','.join([literal(item['id']), literal(item['full_name']), literal(item['role']), 'NULL', 'true']) + ');')

    def test_bootstrap_matches_upgrade(self):
        query = "SELECT pg_get_functiondef('public.fn_admin_save_staff(text,jsonb,jsonb)'::regprocedure);"
        self.assertEqual(self.sql(query), self.sql(query, db='bootstrap_check'))

    def test_create_and_update_with_service_role(self):
        new = profile('user_new', zone=ZONE)
        self.sql('SET ROLE service_role; ' + save('user_admin', new))
        self.sql('SET ROLE service_role; ' + save('user_admin', {**new, 'role': 'kitchen'}, new))
        self.assertEqual(self.sql("SELECT role FROM public.staff_profiles WHERE id='user_new'"), 'kitchen')

    def test_invalid_actor_rejected_inside_rpc(self):
        for actor in ('user_missing', 'user_worker'):
            self.sql('SET ROLE service_role; ' + save(actor, profile('user_new')), error='42501')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_admin'")
        self.sql('SET ROLE service_role; ' + save('user_admin', profile('user_new')), error='42501')

    def test_public_roles_cannot_call_rpc_or_write_even_by_column(self):
        for role in ('anon', 'authenticated'):
            self.sql(f'SET ROLE {role}; ' + save('user_admin', profile('user_new')), error='42501')
            self.sql(f"SET ROLE {role}; UPDATE public.staff_profiles SET role='admin' WHERE id='user_worker'", error='42501')
            self.sql(f'SET ROLE {role}; DELETE FROM public.staff_profiles', error='42501')
            self.sql(f'SET ROLE {role}; TRUNCATE public.staff_profiles CASCADE', error='42501')
            self.sql(f"SET ROLE {role}; INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_fake','Fake','admin')", error='42501')

    def test_last_admin_cannot_disable_or_demote_self(self):
        before = profile('user_admin', 'admin', name='Test admin')
        for changed in ({**before, 'is_active': False}, {**before, 'role': 'staff'}):
            self.sql('SET ROLE service_role; ' + save('user_admin', changed, before), error='P0001')
        self.assertEqual(self.sql("SELECT count(*) FROM public.staff_profiles WHERE role='admin' AND is_active"), '1')

    def test_two_admins_concurrently_demote_self_leave_one_admin(self):
        second = profile('user_second', 'admin')
        self.sql(save('user_admin', second))
        first = profile('user_admin', 'admin', name='Test admin')
        def demote(item):
            result = self.cli('psql', '-X', '-w', '-h', '127.0.0.1', '-p', self.port, '-U', 'postgres',
                              '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-At',
                              '-c', 'SET ROLE service_role; ' + save(item['id'], {**item, 'role': 'staff'}, item), check=False)
            return result
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(demote, [first, second]))
        self.assertEqual(sum(r.returncode == 0 for r in results), 1)
        self.assertTrue(any('P0001:' in r.stderr for r in results))
        self.assertEqual(self.sql("SELECT count(*) FROM public.staff_profiles WHERE role='admin' AND is_active"), '1')

    def test_stale_update_does_not_overwrite_profile_or_subscription(self):
        before = profile()
        self.sql("UPDATE public.staff_profiles SET push_subscription='{}'::jsonb WHERE id='user_worker'")
        self.sql(save('user_admin', {**before, 'full_name': 'New name'}, before))
        self.sql(save('user_admin', {**before, 'role': 'admin'}, before), error='40001')
        self.assertEqual(self.sql("SELECT full_name || ':' || push_subscription::text FROM public.staff_profiles WHERE id='user_worker'"), 'New name:{}')

    def test_duplicate_missing_bad_zone_and_invalid_profile_rollback(self):
        self.sql(save('user_admin', profile()), error='23505')
        self.sql(save('user_admin', profile('user_missing'), profile('user_missing')), error='P0002')
        self.sql(save('user_admin', profile('user_new', zone='22222222-2222-4222-8222-222222222222')), error='23503')
        for invalid in [None, [], {**profile('user_new'), 'role': 'root'}, {**profile('user_new'), 'actor': 'user_admin'},
                        {**profile('user_new'), 'is_active': 'true'}, profile('user_new', zone='not-uuid')]:
            self.sql(save('user_admin', invalid), error='22023')
        self.assertEqual(self.sql("SELECT count(*) FROM public.staff_profiles WHERE id='user_new'"), '0')


if __name__ == '__main__':
    unittest.main(verbosity=2)
