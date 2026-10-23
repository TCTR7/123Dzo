"""Demonstrate default seed safety and explicit demo guard using disposable DBs only."""
import unittest
import staff_rpc_test as db

class DemoSeedTest(db.PostgresTestCase):
    def test_default_seed_noop_and_demo_guards_and_totals(self):
        default=(db.ROOT/'supabase/seed.sql').read_text(encoding='utf-8')
        demo=(db.ROOT/'supabase/demo/seed.sql').read_text(encoding='utf-8')
        self.sql("INSERT INTO public.ingredients(name,unit,stock_quantity,unit_cost) VALUES('Real stock','can',42,12)")
        self.sql(default);self.assertEqual(self.sql('SELECT stock_quantity FROM public.ingredients'),'42')
        self.sql("SET app.seed_mode='demo';"+demo,error='42501')
        self.sql('CREATE DATABASE seed_fixture_demo;');self.sql('CREATE PUBLICATION supabase_realtime;',db='seed_fixture_demo')
        self.sql((db.ROOT/'supabase/schema.sql').read_text(encoding='utf-8'),db='seed_fixture_demo')
        self.sql(demo,db='seed_fixture_demo',error='42501')
        self.assertEqual(self.sql('SELECT count(*) FROM public.ingredients',db='seed_fixture_demo'),'0')
        self.sql("SET app.seed_mode='demo';"+demo,db='seed_fixture_demo')
        self.assertEqual(self.sql("SELECT total_amount FROM public.table_sessions WHERE session_token='vip-01-bill-token'",db='seed_fixture_demo'),'978000')
        self.assertEqual(self.sql("SELECT count(*) FROM public.table_sessions s WHERE total_amount<>(SELECT coalesce(sum(quantity*unit_price),0) FROM public.order_items WHERE session_id=s.id AND status<>'CANCELLED')",db='seed_fixture_demo'),'0')
        self.sql("UPDATE public.ingredients SET stock_quantity=1234 WHERE name LIKE 'Bia Tiger%'",db='seed_fixture_demo')
        self.sql("SET app.seed_mode='demo';"+demo,db='seed_fixture_demo',error='55000')
        self.sql(default,db='seed_fixture_demo')
        self.assertEqual(self.sql("SELECT stock_quantity FROM public.ingredients WHERE name LIKE 'Bia Tiger%'",db='seed_fixture_demo'),'1234')

if __name__=='__main__':unittest.main(verbosity=2)
