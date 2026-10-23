"""KPI expected amounts from independent fixtures on disposable PostgreSQL."""
import json
import unittest
import staff_rpc_test as db
from dine_in_rpc_test import SESSION, SECOND, FOOD

START='2026-10-21T17:00:00Z'
END='2026-10-22T17:00:00Z'
class KpiPeriodsTest(db.PostgresTestCase):
    def setUp(self):
        self.sql('TRUNCATE public.staff_profiles,public.menu_items,public.table_sessions,public.ingredients CASCADE;')
        self.sql("INSERT INTO public.staff_profiles(id,full_name,role) VALUES ('user_staff','Test','staff');")
        self.sql(f"INSERT INTO public.menu_items(id,name,category,station,price,cost_price,prep_time_minutes) VALUES ('{FOOD}','Meal','FOOD','KITCHEN',999,999,10);")
        self.sql(f"INSERT INTO public.table_sessions(id,session_token,session_type,status,total_amount,opened_at,closed_at,assigned_staff_id,payment_method) VALUES ('{SESSION}','test-a','DINE_IN','CLOSED',300,'2026-10-20T10:00Z','2026-10-22T01:00Z','user_staff','CASH'),('{SECOND}','test-b','TAKEAWAY','PENDING_PAYMENT',500,'2026-10-22T00:00Z',NULL,NULL,NULL);")
        self.sql(f"INSERT INTO public.order_items(session_id,menu_item_id,quantity,station,status,unit_price,unit_cost_price,created_at,cooking_started_at,ready_at,served_at,served_by_staff_id) VALUES ('{SESSION}','{FOOD}',2,'KITCHEN','SERVED',100,30,'2026-10-21T16:59Z','2026-10-21T17:01Z','2026-10-21T17:11Z','2026-10-21T17:12Z','user_staff'),('{SECOND}','{FOOD}',5,'KITCHEN','SERVED',100,30,'2026-10-22T00:00Z','2026-10-22T00:01Z','2026-10-22T00:02Z','2026-10-22T00:03Z',NULL);")

    def query(self,name,start=START,end=END):
        return json.loads(self.sql(f"SET ROLE service_role; SELECT coalesce(jsonb_agg(x),'[]') FROM public.fn_get_{name}_kpi('{start}','{end}') x;").splitlines()[-1])

    def test_revenue_closed_cost_served_not_opened_or_created(self):
        result=self.query('financial')[0]
        self.assertEqual(result['gross_revenue'],300)
        self.assertEqual(result['total_cogs'],60)
        self.assertEqual(result['net_profit'],240)
        menu=self.query('menu')[0]
        self.assertEqual((menu['total_quantity_sold'],menu['gross_revenue'],menu['total_cogs']),(2,200,60))
        staff=self.query('waitstaff')[0]
        self.assertEqual((staff['tables_opened_count'],staff['managed_tables_revenue'],staff['active_serving_count']),(0,300,1))

    def test_half_open_midnight_has_no_double_count(self):
        self.sql(f"UPDATE public.table_sessions SET closed_at='{END}' WHERE id='{SESSION}';")
        self.assertEqual(self.query('financial')[0]['gross_revenue'],0)
        self.assertEqual(self.query('financial',END,'2026-10-23T17:00:00Z')[0]['gross_revenue'],300)

    def test_snapshot_survives_price_edit_and_full_return_excluded(self):
        self.sql(f"UPDATE public.menu_items SET price=123456,cost_price=54321 WHERE id='{FOOD}';")
        self.assertEqual(self.query('financial')[0]['total_cogs'],60)
        self.sql(f"UPDATE public.order_items SET quantity=0 WHERE session_id='{SESSION}';")
        self.assertEqual(self.query('financial')[0]['total_cogs'],0)
        self.assertEqual(self.query('waitstaff')[0]['active_serving_count'],0)
        self.assertEqual(self.query('kitchen')[0]['cook_time_evaluation'],'NO_DATA')

    def test_prepared_cancel_cost_once_without_stock_log(self):
        self.sql(f"UPDATE public.order_items SET status='CANCELLED',cancelled_at='2026-10-22T01:00Z',cancel_reason='Test loss' WHERE session_id='{SESSION}';")
        self.assertEqual(self.query('financial')[0]['total_cogs'],60)
        self.assertEqual(self.query('financial')[0]['total_wastage_cost'],0)
        self.assertEqual(self.sql('SELECT count(*) FROM public.inventory_logs;'),'0')
        self.sql(f"UPDATE public.order_items SET cooking_started_at=NULL,ready_at=NULL,served_at=NULL WHERE session_id='{SESSION}';")
        self.assertEqual(self.query('financial')[0]['total_cogs'],0)

    def test_peak_and_queue_use_activation_and_vietnam_hour(self):
        self.assertEqual(self.query('peak_hours'),[])
        self.sql(f"UPDATE public.table_sessions SET status='ACTIVE',activated_at='2026-10-22T05:00Z' WHERE id='{SECOND}';")
        peak=self.query('peak_hours')
        self.assertEqual([(x['hour_of_day'],x['total_items_quantity']) for x in peak],[(12,5)])

    def test_all_time_views_match_all_five_functions(self):
        for name,view in [('financial','financial_summary'),('menu','menu_analytics'),('kitchen','kitchen_performance'),('waitstaff','waitstaff_performance'),('peak_hours','peak_hours')]:
            expected=self.query(name,'-infinity','infinity')
            actual=json.loads(self.sql(f"SET ROLE service_role; SELECT coalesce(jsonb_agg(x),'[]') FROM public.vw_kpi_{view} x;").splitlines()[-1])
            self.assertEqual(actual,expected)
        for role in ['anon','authenticated']:
            self.sql(f"SET ROLE {role}; SELECT * FROM public.fn_get_peak_hours_kpi();",error='42501')

if __name__=='__main__':unittest.main(verbosity=2)
