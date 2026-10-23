"""Real PostgreSQL policy/transaction tests; managed Realtime is an explicit fixture.
Does not prove a Supabase server accepts our signing key or cached authorization.
"""
import json
import time
import unittest
import staff_rpc_test as db
from dine_in_rpc_test import SESSION, SECOND, TOKEN, FOOD, order

MIGRATION = db.ROOT / 'supabase/migrations/202610220014_private_realtime.sql'


class RealtimePolicyTest(db.PostgresTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        try:
            cls.sql("""
              CREATE SCHEMA realtime;
              CREATE TABLE realtime.messages(topic text, extension text, payload jsonb, event text, private boolean);
              ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
              GRANT USAGE ON SCHEMA realtime TO anon,authenticated;
              GRANT ALL ON realtime.messages TO anon,authenticated;
              CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
                $$ SELECT current_setting('test.realtime_topic',true) $$;
              CREATE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean)
                RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages VALUES ($3,'broadcast',$1,$2,$4) $$;
              CREATE POLICY legacy_allow_all ON realtime.messages TO anon,authenticated USING (true) WITH CHECK (true);
            """)
            cls.sql(MIGRATION.read_text(encoding='utf-8'))
            cls.sql(MIGRATION.read_text(encoding='utf-8'))
        except Exception:
            cls.cleanup()
            raise

    def setUp(self):
        self.sql('TRUNCATE public.staff_profiles, public.menu_items, public.table_sessions CASCADE; TRUNCATE realtime.messages;')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_staff','Staff','staff'),('user_kitchen','Kitchen','kitchen');")
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price) VALUES ('{FOOD}','Food','FOOD','KITCHEN',100,40);")
        self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status) VALUES ('{SESSION}','{TOKEN}','DINE_IN','ACTIVE'),('{SECOND}','other-token','DINE_IN','ACTIVE');")
        self.sql('TRUNCATE realtime.messages;')
        self.topic = f'123dzo:session:{SESSION}'

    def claims(self, **changes):
        now = int(time.time())
        return dict(app='123dzo-live-v1', role='authenticated', aud='authenticated',
                    scope='session', actor_id=SESSION, topic=self.topic, iat=now, exp=now+120, **changes)

    def as_ticket(self, statement, claims=None, topic=None, role='authenticated', error=None):
        body = claims if claims is not None else self.claims()
        return self.sql(f"SET ROLE {role}; SET request.jwt.claims={db.literal(json.dumps(body))}; SET test.realtime_topic={db.literal(topic or self.topic)}; " + statement, error=error).splitlines()[-1]

    def add_probe(self, topic=None, extension='broadcast'):
        self.sql(f"INSERT INTO realtime.messages VALUES ({db.literal(topic or self.topic)},{db.literal(extension)},'{{}}','invalidate',true);")

    def test_only_own_broadcast_even_with_legacy_allow_all(self):
        self.add_probe()
        self.add_probe(f'123dzo:session:{SECOND}')
        self.add_probe(extension='presence')
        self.assertEqual(self.as_ticket('SELECT count(*) FROM realtime.messages;'), '1')
        self.assertEqual(self.as_ticket('SELECT count(*) FROM realtime.messages;',topic=f'123dzo:session:{SECOND}'), '0')
        self.assertEqual(self.as_ticket('SELECT count(*) FROM realtime.messages;',role='anon'), '0')

    def test_no_publish_presence_update_delete_even_with_legacy_grants(self):
        self.add_probe()
        for extension in ['broadcast','presence']:
            self.as_ticket(f"INSERT INTO realtime.messages VALUES ('{self.topic}','{extension}','{{}}','fake',true);",error='42501')
        self.as_ticket("UPDATE realtime.messages SET payload='{\"fake\":true}';")
        self.as_ticket('DELETE FROM realtime.messages;')
        self.assertEqual(self.sql("SELECT payload::text FROM realtime.messages;"),'{}')

    def test_malformed_expired_future_or_long_lifetime_denied(self):
        self.add_probe()
        good = self.claims()
        cases = [{}, {**good,'iat':None}, {**good,'exp':'not-a-number'},
                 {**good,'exp':good['iat']-1}, {**good,'iat':good['iat']+60},
                 {**good,'exp':good['iat']+121}, {**good,'role':'service_role'},
                 {**good,'app':'other'}, {**good,'actor_id':SECOND}]
        for claims in cases:
            self.assertEqual(self.as_ticket('SELECT count(*) FROM realtime.messages;',claims), '0')

    def test_closed_pending_or_takeaway_session_denied_and_snapshot_revoked(self):
        for update in ["status='CLOSED'", "status='PENDING_PAYMENT'", "status='ACTIVE',session_type='TAKEAWAY'"]:
            self.sql(f"UPDATE public.table_sessions SET {update} WHERE id='{SESSION}';")
            self.assertEqual(self.as_ticket(f"SELECT public.fn_realtime_receive_allowed('{self.topic}');"),'f')
            self.sql(f"SET ROLE service_role; SELECT public.fn_get_dine_in_snapshot('{TOKEN}');",error='P0002')

    def test_staff_current_active_role_and_demotion_rechecked(self):
        topic='123dzo:role:staff'
        claims={**self.claims(),'scope':'staff','actor_id':'user_staff','topic':topic}
        self.add_probe(topic)
        self.assertEqual(self.as_ticket('SELECT count(*) FROM realtime.messages;',claims,topic), '1')
        self.assertEqual(self.as_ticket('SELECT count(*) FROM realtime.messages;',claims,'123dzo:role:kitchen'), '0')
        self.sql("UPDATE public.staff_profiles SET is_active=false WHERE id='user_staff';")
        self.assertEqual(self.as_ticket(f"SELECT public.fn_realtime_receive_allowed('{topic}');",claims,topic),'f')
        self.sql("UPDATE public.staff_profiles SET is_active=true,role='admin' WHERE id='user_staff';")
        self.assertEqual(self.as_ticket(f"SELECT public.fn_realtime_receive_allowed('{topic}');",claims,topic),'f')

    def test_ticket_does_not_grant_base_rows_business_rpc_or_private_helpers(self):
        self.as_ticket('SELECT * FROM public.table_sessions;',error='42501')
        self.as_ticket(order(),error='42501')
        self.as_ticket('SELECT private.emit_invalidation();',error='42501')

    def test_transactional_signal_safe_fanout_and_closing_former_session(self):
        self.sql(order())
        rows=json.loads(self.sql('SELECT jsonb_agg(to_jsonb(m)) FROM realtime.messages m;'))
        self.assertEqual({r['topic'] for r in rows},{self.topic,f'123dzo:session:{SECOND}','123dzo:role:staff','123dzo:role:kitchen','123dzo:role:admin'})
        for row in rows:
            self.assertEqual(set(row['payload']),{'v','id'})
            self.assertTrue(row['private'])
            self.assertEqual(row['event'],'invalidate')
        self.sql('TRUNCATE realtime.messages;')
        self.sql(f"BEGIN; UPDATE public.menu_items SET is_available=false WHERE id='{FOOD}'; ROLLBACK;")
        self.assertEqual(self.sql('SELECT count(*) FROM realtime.messages;'),'0')
        self.sql(f"UPDATE public.table_sessions SET status='CLOSED' WHERE id='{SESSION}';")
        self.assertEqual(self.sql(f"SELECT count(*) FROM realtime.messages WHERE topic='{self.topic}';"),'1')

    def test_realtime_failure_does_not_rollback_order(self):
        self.sql("CREATE OR REPLACE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture outage'; END $$;")
        try:
            self.sql(order())
            self.assertEqual(self.sql('SELECT count(*) FROM public.order_items;'),'1')
        finally:
            self.sql("CREATE OR REPLACE FUNCTION realtime.send(payload jsonb,event text,topic text,private boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.messages VALUES ($3,'broadcast',$1,$2,$4) $$;")


if __name__ == '__main__':
    unittest.main(verbosity=2)
