"""Request limits in a fresh initdb loopback fixture; no application DB/env."""
import concurrent.futures
import json
import unittest
import staff_rpc_test as db

FP='a'*64
class TakeawayRequestLimitsTest(db.PostgresTestCase):
 def setUp(self):self.sql('TRUNCATE private.request_limits;')
 def query(self,fp=FP,network_minute=10,network_hour=120,global_minute=60,global_hour=600):
  return f"SET ROLE service_role; SELECT public.fn_takeaway_request_gate({db.literal(fp)},{network_minute},{network_hour},{global_minute},{global_hour});"
 def claim(self,**kwargs):return json.loads(self.sql(self.query(**kwargs)).splitlines()[-1])
 def test_allowed_and_denied_counters_persist_without_business_rows(self):
  self.assertTrue(self.claim(network_hour=1)['allowed']);result=self.claim(network_hour=1)
  self.assertFalse(result['allowed']);self.assertGreaterEqual(result['retryAfter'],1);self.assertLessEqual(result['retryAfter'],3600)
  self.assertEqual(self.sql("SELECT hits FROM private.request_limits WHERE scope_key='global:takeaway' AND window_seconds=3600;"),'2')
  self.assertEqual(self.sql('SELECT count(*) FROM public.table_sessions;'),'0');self.assertEqual(self.sql('SELECT count(*) FROM private.operation_requests;'),'0')
 def test_concurrent_workers_share_one_budget(self):
  # Hour budget avoids minute-boundary flakiness. Skip only the final seconds of an hour.
  if float(self.sql("SELECT extract(epoch FROM date_trunc('hour',clock_timestamp())+interval '1 hour'-clock_timestamp());"))<10:self.skipTest('Hour boundary during concurrency fixture')
  def call(_):
   result=self.cli('psql','-X','-w','-h','127.0.0.1','-p',self.port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At','-f','-',input_text=self.query(network_minute=100,network_hour=3,global_minute=100),check=True)
   return json.loads(result.stdout.splitlines()[-1])
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(call,range(8)))
  self.assertEqual(sum(row['allowed'] for row in results),3)
  self.assertEqual(self.sql(f"SELECT count(*) FROM private.request_limits WHERE scope_key='{FP}' AND window_seconds=3600;"),'1')
 def test_global_rejection_does_not_allocate_new_network_rows(self):
  self.assertTrue(self.claim(global_hour=1)['allowed']);self.assertFalse(self.claim(fp='b'*64,global_hour=1)['allowed'])
  self.assertEqual(self.sql("SELECT count(*) FROM private.request_limits WHERE scope_key=repeat('b',64);"),'0')
 def test_networks_are_independent_until_global_budget(self):
  self.assertTrue(self.claim(network_hour=1)['allowed']);self.assertFalse(self.claim(network_hour=1)['allowed']);self.assertTrue(self.claim(fp='b'*64,network_hour=1)['allowed'])
 def test_expired_state_is_pruned_in_bounded_batches_without_touching_audit(self):
  self.sql("INSERT INTO private.request_limits SELECT md5(n::text)||md5(n::text),60,date_trunc('minute',clock_timestamp())-interval '2 minutes',1,date_trunc('minute',clock_timestamp())-interval '1 minute' FROM generate_series(1,250)n;")
  self.claim();self.assertEqual(self.sql('SELECT count(*) FROM private.request_limits WHERE expires_at<=clock_timestamp();'),'50')
  self.claim();self.assertEqual(self.sql('SELECT count(*) FROM private.request_limits WHERE expires_at<=clock_timestamp();'),'0')
 def test_permissions_input_and_bootstrap_upgrade_parity(self):
  for role in ('anon','authenticated'):
   self.sql(f"SET ROLE {role}; SELECT public.fn_takeaway_request_gate('{FP}');",error='42501')
  for role in ('anon','authenticated','service_role'):
   self.sql(f'SET ROLE {role}; SELECT * FROM private.request_limits;',error='42501')
  for args in ("'bad'","NULL",f"'{FP}',0",f"'{FP}',100001",f"'{FP}',NULL"):
   self.sql('SET ROLE service_role; SELECT public.fn_takeaway_request_gate('+args+');',error='22023')
  function="SELECT pg_get_functiondef('public.fn_takeaway_request_gate(text,integer,integer,integer,integer)'::regprocedure);"
  self.assertEqual(self.sql(function),self.sql(function,db='bootstrap_check'))

if __name__=='__main__':unittest.main(verbosity=2)
