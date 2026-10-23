"""Generate the approved SQL definitions without duplicating return signatures."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
schema=(root/'supabase/schema.sql').read_text(encoding='utf-8')
parts=['-- KPI period correction (spec12.17).\nBEGIN;\nALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS activated_at timestamptz;']
bodies={
'financial': '''WITH revenue AS (
 SELECT coalesce(sum(total_amount),0) gross_revenue,
 coalesce(sum(total_amount) FILTER(WHERE payment_method='CASH'),0) cash_revenue,
 coalesce(sum(total_amount) FILTER(WHERE payment_method='VIETQR'),0) vietqr_revenue,
 coalesce(sum(total_amount) FILTER(WHERE session_type='DINE_IN'),0) dine_in_revenue,
 coalesce(sum(total_amount) FILTER(WHERE session_type='TAKEAWAY'),0) takeaway_revenue,
 count(*) closed_sessions_count FROM public.table_sessions
 WHERE status='CLOSED' AND closed_at>=p_start_date AND closed_at<p_end_date
), costs AS (
 SELECT coalesce(sum(o.unit_cost_price*o.quantity),0) total_cogs
 FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id
 WHERE s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') AND o.quantity>0
 AND (o.status='SERVED' OR (o.status='CANCELLED' AND (o.cooking_started_at IS NOT NULL OR o.ready_at IS NOT NULL)))
 AND coalesce(o.served_at,o.cancelled_at)>=p_start_date AND coalesce(o.served_at,o.cancelled_at)<p_end_date
), waste AS (
 SELECT coalesce(sum(abs(total_cost)),0) total_wastage_cost FROM public.inventory_logs
 WHERE type='WASTAGE' AND created_at>=p_start_date AND created_at<p_end_date
) SELECT r.*,c.total_cogs,w.total_wastage_cost,r.gross_revenue-c.total_cogs-w.total_wastage_cost net_profit
 FROM revenue r CROSS JOIN costs c CROSS JOIN waste w''',
'menu': '''SELECT m.id,m.name,m.category,m.station,m.is_available,
 coalesce(sum(o.quantity),0)::bigint,coalesce(sum(o.unit_price*o.quantity),0)::numeric,
 coalesce(sum(o.unit_cost_price*o.quantity),0)::numeric,coalesce(sum((o.unit_price-o.unit_cost_price)*o.quantity),0)::numeric
 FROM public.menu_items m LEFT JOIN public.order_items o ON o.menu_item_id=m.id AND o.status='SERVED' AND o.quantity>0
 AND o.served_at>=p_start_date AND o.served_at<p_end_date
 AND EXISTS(SELECT 1 FROM public.table_sessions s WHERE s.id=o.session_id AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED'))
 GROUP BY m.id,m.name,m.category,m.station,m.is_available ORDER BY 6 DESC,m.id''',
'kitchen': '''WITH relevant AS (
 SELECT o.*,m.prep_time_minutes,CASE WHEN s.session_type='DINE_IN' THEN o.created_at
 WHEN s.activated_at IS NOT NULL THEN greatest(o.created_at,s.activated_at) END queue_at
 FROM public.order_items o JOIN public.menu_items m ON m.id=o.menu_item_id
 JOIN public.table_sessions s ON s.id=o.session_id WHERE o.station='KITCHEN' AND o.quantity>0
 AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED')
), stats AS (
 SELECT count(*) FILTER(WHERE status='SERVED' AND served_at>=p_start_date AND served_at<p_end_date) total_cooked_items,
 count(*) FILTER(WHERE status='SERVED' AND batch_id IS NOT NULL AND served_at>=p_start_date AND served_at<p_end_date) batch_cooked_items,
 coalesce(round(avg(extract(epoch FROM(cooking_started_at-queue_at))/60) FILTER(WHERE status='SERVED'
 AND served_at>=p_start_date AND served_at<p_end_date AND cooking_started_at>=queue_at),2),0) avg_queue_wait_minutes,
 coalesce(round(avg(extract(epoch FROM(ready_at-cooking_started_at))/60) FILTER(WHERE status='SERVED'
 AND served_at>=p_start_date AND served_at<p_end_date AND ready_at>=cooking_started_at),2),0) actual,
 coalesce(round(avg(prep_time_minutes) FILTER(WHERE status='SERVED' AND served_at>=p_start_date AND served_at<p_end_date
 AND ready_at>=cooking_started_at),2),0) standard,
 count(*) FILTER(WHERE status='SERVED' AND served_at>=p_start_date AND served_at<p_end_date AND ready_at>=cooking_started_at) samples,
 count(*) FILTER(WHERE status='CANCELLED' AND cancelled_at>=p_start_date AND cancelled_at<p_end_date
 AND cancelled_at>queue_at+interval '15 minutes') slow_cancelled_count FROM relevant
) SELECT total_cooked_items,batch_cooked_items,avg_queue_wait_minutes,actual,standard,
 CASE WHEN samples=0 THEN 'NO_DATA' WHEN actual<=standard THEN 'ON_TIME' WHEN actual<=standard*1.3 THEN 'WARNING' ELSE 'LATE' END,
 CASE WHEN total_cooked_items=0 THEN 0::numeric ELSE round(batch_cooked_items*100.0/total_cooked_items,2) END,
 slow_cancelled_count FROM stats''',
'waitstaff': '''WITH sessions AS (
 SELECT assigned_staff_id staff_id,count(*) FILTER(WHERE opened_at>=p_start_date AND opened_at<p_end_date) opened,
 coalesce(sum(total_amount) FILTER(WHERE status='CLOSED' AND closed_at>=p_start_date AND closed_at<p_end_date),0) revenue
 FROM public.table_sessions WHERE assigned_staff_id IS NOT NULL AND status IN ('ACTIVE','REQUEST_BILL','CLOSED') GROUP BY assigned_staff_id
), serving AS (
 SELECT o.served_by_staff_id staff_id,count(*) count_served,
 count(*) FILTER(WHERE o.served_at>=o.ready_at) samples,
 coalesce(round(avg(extract(epoch FROM(o.served_at-o.ready_at))) FILTER(WHERE o.served_at>=o.ready_at),2),0) speed
 FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id WHERE o.status='SERVED' AND o.quantity>0
 AND o.served_at>=p_start_date AND o.served_at<p_end_date AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED') GROUP BY o.served_by_staff_id
) SELECT p.id,p.full_name,p.role,p.assigned_zone_id,p.is_active,coalesce(s.opened,0)::bigint,coalesce(s.revenue,0)::numeric,
 coalesce(v.count_served,0)::bigint,coalesce(v.speed,0)::numeric,
 CASE WHEN coalesce(v.samples,0)=0 THEN 'NO_DATA' WHEN v.speed<90 THEN 'EXCELLENT' WHEN v.speed<=180 THEN 'NORMAL' ELSE 'SLOW' END
 FROM public.staff_profiles p LEFT JOIN sessions s ON s.staff_id=p.id LEFT JOIN serving v ON v.staff_id=p.id
 WHERE p.role IN ('staff','admin') ORDER BY 8 DESC,p.id'''
}
for name,body in bodies.items():
 match=re.search(r'CREATE OR REPLACE FUNCTION public.fn_get_'+name+r'_kpi\([\s\S]*?\n\)\nRETURNS TABLE \([\s\S]*?\n\)',schema)
 if not match: raise RuntimeError(name)
 header=match.group().replace("DEFAULT (date_trunc('month', now()))","DEFAULT '-infinity'::timestamptz").replace('DEFAULT now()',"DEFAULT 'infinity'::timestamptz")
 parts.append(header+'\nLANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$\n'+body+';\n$$;')
parts.append('''CREATE OR REPLACE FUNCTION public.fn_get_peak_hours_kpi(p_start_date timestamptz DEFAULT '-infinity',p_end_date timestamptz DEFAULT 'infinity')
RETURNS TABLE(hour_of_day integer,total_orders_count bigint,total_items_quantity bigint,total_order_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 WITH eligible AS (
 SELECT o.*,CASE WHEN s.session_type='DINE_IN' THEN o.created_at WHEN s.activated_at IS NOT NULL THEN greatest(o.created_at,s.activated_at) END queue_at
 FROM public.order_items o JOIN public.table_sessions s ON s.id=o.session_id
 WHERE o.status<>'CANCELLED' AND o.quantity>0 AND s.status IN ('ACTIVE','REQUEST_BILL','CLOSED')
 ) SELECT extract(hour FROM(queue_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer,count(*),sum(quantity)::bigint,sum(unit_price*quantity)::numeric
 FROM eligible WHERE queue_at>=p_start_date AND queue_at<p_end_date GROUP BY 1 ORDER BY 1;
$$;''')
for view,name in [('financial_summary','financial'),('menu_analytics','menu'),('kitchen_performance','kitchen'),('waitstaff_performance','waitstaff'),('peak_hours','peak_hours')]:
 parts.append(f"CREATE OR REPLACE VIEW public.vw_kpi_{view} WITH(security_invoker=true) AS SELECT * FROM public.fn_get_{name}_kpi('-infinity','infinity');")
 parts.append(f'REVOKE ALL ON public.vw_kpi_{view} FROM PUBLIC,anon,authenticated; GRANT SELECT ON public.vw_kpi_{view} TO service_role;')
for name in [*bodies,'peak_hours']:
 parts.append(f'REVOKE ALL ON FUNCTION public.fn_get_{name}_kpi(timestamptz,timestamptz) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.fn_get_{name}_kpi(timestamptz,timestamptz) TO service_role;')
snapshot=re.search(r'CREATE OR REPLACE FUNCTION public.fn_get_dine_in_snapshot\(p_token text\)[\s\S]*?END \$\$;',schema).group()
snapshot=snapshot.replace('q.created_at<own.created_at',"(CASE WHEN qs.session_type='DINE_IN' THEN q.created_at WHEN qs.activated_at IS NOT NULL THEN greatest(q.created_at,qs.activated_at) END)<own.created_at")
parts.append(snapshot)
parts.append("CREATE INDEX IF NOT EXISTS kpi_closed_period_idx ON public.table_sessions(closed_at) WHERE status='CLOSED';")
parts.append("CREATE INDEX IF NOT EXISTS kpi_served_period_idx ON public.order_items(served_at) WHERE status='SERVED' AND quantity>0;")
parts.append('COMMIT;')
migration='\n\n'.join(parts)+'\n'
path=root/'supabase/migrations/202610220015_kpi_periods.sql'
previous=path.read_text(encoding='utf-8') if path.exists() else None
path.write_text(migration,encoding='utf-8')
(root/'supabase/schema.sql').write_text(schema.replace(previous,migration) if previous and previous in schema else schema+'\n'+migration,encoding='utf-8')
