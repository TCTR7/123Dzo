import { isRecord } from '@/lib/orders/contracts';
import type { KpiFinancialSummary, KpiKitchenPerformance, KpiMenuAnalytics, KpiWaitstaffPerformance, KpiPeakHour } from '@/types/database.types';

const numbers = (value: unknown, fields: string[]) => isRecord(value) && fields.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
export function parseAnalytics(value: unknown): { financial: KpiFinancialSummary; menu: KpiMenuAnalytics[]; kitchen: KpiKitchenPerformance; staff: KpiWaitstaffPerformance[]; peak: KpiPeakHour[] } | null {
  if (!isRecord(value) || !isRecord(value.financial) || !isRecord(value.kitchen) || !Array.isArray(value.menu) || !Array.isArray(value.staff)) return null;
  if (!numbers(value.financial, ['gross_revenue','cash_revenue','vietqr_revenue','dine_in_revenue','takeaway_revenue','closed_sessions_count','total_cogs','total_wastage_cost','net_profit']) ||
    !numbers(value.kitchen, ['total_cooked_items','batch_cooked_items','avg_queue_wait_minutes','avg_actual_cook_minutes','avg_standard_prep_minutes','batch_cooking_efficiency_pct','slow_cancelled_count']) ||
    !['ON_TIME','WARNING','LATE','NO_DATA'].includes(String(value.kitchen.cook_time_evaluation))) return null;
  if (!Array.isArray(value.peak) || !value.peak.every(row => numbers(row,['hour_of_day','total_orders_count','total_items_quantity','total_order_value']) && isRecord(row) && Number.isInteger(row.hour_of_day) && Number(row.hour_of_day)>=0 && Number(row.hour_of_day)<=23)) return null;
  if (!value.menu.every(row => isRecord(row) && typeof row.menu_item_id === 'string' && typeof row.name === 'string' &&
    ['FOOD','BEER','DRINK','OTHER'].includes(String(row.category)) && ['KITCHEN','BAR_INSTANT'].includes(String(row.station)) && typeof row.is_available === 'boolean' &&
    numbers(row, ['total_quantity_sold','gross_revenue','total_cogs','gross_profit']))) return null;
  if (!value.staff.every(row => isRecord(row) && typeof row.staff_id === 'string' && typeof row.full_name === 'string' &&
    ['admin','staff','kitchen'].includes(String(row.role)) && (row.assigned_zone_id === null || typeof row.assigned_zone_id === 'string') && typeof row.is_active === 'boolean' &&
    ['EXCELLENT','NORMAL','SLOW','NO_DATA'].includes(String(row.pickup_speed_evaluation)) && numbers(row, ['tables_opened_count','managed_tables_revenue','active_serving_count','avg_pickup_speed_seconds']))) return null;
  // Shape and scalar domains checked above; endpoint is admin-only and contains KPI projections.
  return value as unknown as { financial: KpiFinancialSummary; menu: KpiMenuAnalytics[]; kitchen: KpiKitchenPerformance; staff: KpiWaitstaffPerformance[]; peak: KpiPeakHour[] };
}
