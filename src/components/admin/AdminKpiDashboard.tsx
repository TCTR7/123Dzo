'use client';

import { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Flame,
  ChefHat,
  Users,
  Beer,
  UtensilsCrossed,
  Clock,
  Calendar,
  Layers,
  Award,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatVND, cn } from '@/lib/utils';
import type {
  KpiFinancialSummary,
  KpiKitchenPerformance,
  KpiMenuAnalytics,
  KpiPeakHour,
  KpiWaitstaffPerformance,
} from '@/types/database.types';

interface AdminKpiDashboardProps {
  initialFinancial: KpiFinancialSummary;
  initialPeakHours: KpiPeakHour[];
  initialMenuAnalytics: KpiMenuAnalytics[];
  initialKitchenKpi: KpiKitchenPerformance;
  initialWaitstaffKpi: KpiWaitstaffPerformance[];
}

type DateRangePreset = 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

const PIE_COLORS_PAYMENT = ['#f59e0b', '#10b981'];
const PIE_COLORS_CHANNEL = ['#38bdf8', '#a855f7'];

export function AdminKpiDashboard({
  initialFinancial,
  initialPeakHours,
  initialMenuAnalytics,
  initialKitchenKpi,
  initialWaitstaffKpi,
}: AdminKpiDashboardProps) {
  const supabase = createSupabaseBrowserClient();

  const [financial, setFinancial] =
    useState<KpiFinancialSummary>(initialFinancial);
  const [peakHours] = useState<KpiPeakHour[]>(initialPeakHours);
  const [menuAnalytics, setMenuAnalytics] =
    useState<KpiMenuAnalytics[]>(initialMenuAnalytics);
  const [kitchenKpi, setKitchenKpi] =
    useState<KpiKitchenPerformance>(initialKitchenKpi);
  const [waitstaffKpi, setWaitstaffKpi] =
    useState<KpiWaitstaffPerformance[]>(initialWaitstaffKpi);

  const [preset, setPreset] = useState<DateRangePreset>('ALL');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [isLoadingFilter, setIsLoadingFilter] = useState<boolean>(false);

  /**
   * Lọc dữ liệu KPI bằng PostgreSQL Views / RPC Functions trên Supabase
   * Tuyệt đối không kéo bảng order_items về cộng bằng JS (Tuân thủ Mục 10.4 PRD_SPEC.md)
   */
  async function applyDatePreset(
    nextPreset: DateRangePreset,
    startOverride?: string,
    endOverride?: string
  ) {
    setPreset(nextPreset);
    setIsLoadingFilter(true);

    try {
      if (nextPreset === 'ALL') {
        const [finRes, menuRes, kitRes, staffRes] = await Promise.all([
          supabase.from('vw_kpi_financial_summary').select('*').single(),
          supabase.from('vw_kpi_menu_analytics').select('*'),
          supabase.from('vw_kpi_kitchen_performance').select('*').single(),
          supabase.from('vw_kpi_waitstaff_performance').select('*'),
        ]);

        if (finRes.data) setFinancial(finRes.data);
        if (menuRes.data) setMenuAnalytics(menuRes.data);
        if (kitRes.data) setKitchenKpi(kitRes.data);
        if (staffRes.data) setWaitstaffKpi(staffRes.data);
        return;
      }

      const now = new Date();
      let startDate = new Date();
      let endDate = new Date();

      if (nextPreset === 'TODAY') {
        startDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0
        );
      } else if (nextPreset === 'THIS_WEEK') {
        const day = now.getDay() || 7;
        startDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - day + 1,
          0,
          0,
          0
        );
      } else if (nextPreset === 'THIS_MONTH') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      } else if (nextPreset === 'CUSTOM') {
        const s = startOverride ?? customStartDate;
        const e = endOverride ?? customEndDate;
        if (!s || !e) {
          setIsLoadingFilter(false);
          return;
        }
        startDate = new Date(`${s}T00:00:00`);
        endDate = new Date(`${e}T23:59:59`);
      }

      const rpcArgs = {
        p_start_date: startDate.toISOString(),
        p_end_date: endDate.toISOString(),
      };

      const [finRpc, menuRpc, kitRpc, staffRpc] = await Promise.all([
        supabase.rpc('fn_get_financial_kpi', rpcArgs),
        supabase.rpc('fn_get_menu_kpi', rpcArgs),
        supabase.rpc('fn_get_kitchen_kpi', rpcArgs),
        supabase.rpc('fn_get_waitstaff_kpi', rpcArgs),
      ]);

      if (finRpc.data?.[0]) {
        setFinancial(finRpc.data[0]);
      }
      if (menuRpc.data) {
        setMenuAnalytics(menuRpc.data);
      }
      if (kitRpc.data?.[0]) {
        setKitchenKpi(kitRpc.data[0]);
      }
      if (staffRpc.data) {
        setWaitstaffKpi(staffRpc.data);
      }
    } finally {
      setIsLoadingFilter(false);
    }
  }

  // 11.1 Dữ liệu Biểu đồ tròn Tài chính & Khung giờ vàng
  const paymentPieData = useMemo(
    () => [
      { name: 'Tiền mặt (CASH)', value: Number(financial.cash_revenue) || 0 },
      {
        name: 'Chuyển khoản (VIETQR)',
        value: Number(financial.vietqr_revenue) || 0,
      },
    ],
    [financial]
  );

  const channelPieData = useMemo(
    () => [
      {
        name: 'Tại bàn (Dine-in)',
        value: Number(financial.dine_in_revenue) || 0,
      },
      {
        name: 'Mang về (Takeaway)',
        value: Number(financial.takeaway_revenue) || 0,
      },
    ],
    [financial]
  );

  const peakHoursChartData = useMemo(
    () =>
      peakHours.map((ph) => ({
        hourLabel: `${String(ph.hour_of_day).padStart(2, '0')}:00`,
        totalItems: Number(ph.total_items_quantity) || 0,
        totalOrders: Number(ph.total_orders_count) || 0,
        revenue: Number(ph.total_order_value) || 0,
      })),
    [peakHours]
  );

  // 11.2 Top Mồi bén (FOOD) theo lợi nhuận gộp & Top Bia tiêu thụ (BEER / DRINK) & Món ế
  const topFoodByProfit = useMemo(
    () =>
      menuAnalytics
        .filter((m) => m.category === 'FOOD')
        .sort((a, b) => Number(b.gross_profit) - Number(a.gross_profit))
        .slice(0, 6),
    [menuAnalytics]
  );

  const topBeveragesByQuantity = useMemo(
    () =>
      menuAnalytics
        .filter((m) => m.category === 'BEER' || m.category === 'DRINK')
        .sort(
          (a, b) =>
            Number(b.total_quantity_sold) - Number(a.total_quantity_sold)
        )
        .slice(0, 6),
    [menuAnalytics]
  );

  const slowMovingItems = useMemo(
    () =>
      [...menuAnalytics]
        .sort(
          (a, b) =>
            Number(a.total_quantity_sold) - Number(b.total_quantity_sold)
        )
        .slice(0, 5),
    [menuAnalytics]
  );

  // 11.3 Dữ liệu Biểu đồ so sánh Thời gian nấu chuẩn vs Thời gian nấu thực tế
  const kitchenCompareChartData = useMemo(
    () => [
      {
        name: 'Chờ bếp nhận đơn',
        minutes: Number(kitchenKpi.avg_queue_wait_minutes) || 0,
      },
      {
        name: 'Nấu chuẩn (Prep Time)',
        minutes: Number(kitchenKpi.avg_standard_prep_minutes) || 0,
      },
      {
        name: 'Nấu thực tế (Actual)',
        minutes: Number(kitchenKpi.avg_actual_cook_minutes) || 0,
      },
    ],
    [kitchenKpi]
  );

  return (
    <div className="space-y-8">
      {/* Header & Bộ lọc thời gian (Hôm nay / Tuần này / Tháng này / Tùy chọn) */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <div>
          <h2 className="text-2xl font-extrabold text-zinc-100">
            Dashboard Báo cáo Doanh thu & Đánh giá KPI Cuối tháng
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Tính toán trực tiếp từ 4 cụm PostgreSQL Views & RPC Functions trên Supabase (Mục 10.4 & Mục 11).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { key: 'ALL', label: 'Toàn thời gian (Views)' },
              { key: 'TODAY', label: 'Hôm nay' },
              { key: 'THIS_WEEK', label: 'Tuần này' },
              { key: 'THIS_MONTH', label: 'Tháng này' },
              { key: 'CUSTOM', label: 'Tùy chọn ngày' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={isLoadingFilter}
              onClick={() => void applyDatePreset(item.key)}
              className={cn(
                'px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors',
                preset === item.key
                  ? 'bg-amber-500 text-zinc-950 border-amber-500'
                  : 'bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700'
              )}
            >
              {item.label}
            </button>
          ))}

          {preset === 'CUSTOM' && (
            <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0">
              <Calendar className="h-4 w-4 text-amber-400" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
              />
              <span className="text-xs text-zinc-500">→</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
              />
              <button
                type="button"
                onClick={() =>
                  void applyDatePreset('CUSTOM', customStartDate, customEndDate)
                }
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Áp dụng
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* KHỐI 1: ĐÁNH GIÁ TÀI CHÍNH & KHUNG GIỜ VÀNG (MỤC 11.1) */}
      {/* ==================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-amber-400" />
          <h3 className="text-lg font-extrabold text-zinc-100">
            1. Đánh giá Tài chính (Doanh thu, Giá vốn COGS, Hao hụt & Lợi nhuận ròng)
          </h3>
        </div>

        {/* 4 Thẻ Tài chính cốt lõi */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400">
              Tổng Doanh thu (Gross Revenue)
            </span>
            <div className="text-2xl font-black text-amber-400 mt-1">
              {formatVND(Number(financial.gross_revenue))}
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 block">
              {financial.closed_sessions_count} phiên bàn đã đóng (CLOSED)
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400">
              Giá vốn hàng bán (COGS)
            </span>
            <div className="text-2xl font-black text-zinc-100 mt-1">
              {formatVND(Number(financial.total_cogs))}
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 block">
              Tính trên các món đã phục vụ (SERVED)
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900 border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400">
              Chi phí hao hụt kho (Wastage Cost)
            </span>
            <div className="text-2xl font-black text-rose-400 mt-1">
              {formatVND(Number(financial.total_wastage_cost))}
            </div>
            <span className="text-[11px] text-zinc-500 mt-1 block">
              Tổng giá trị phiếu xuất hủy hàng hỏng (WASTAGE)
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-emerald-950/30 border border-emerald-500/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-300">
                Lợi nhuận ròng ước tính (Net Profit)
              </span>
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400 mt-1">
              {formatVND(Number(financial.net_profit))}
            </div>
            <span className="text-[11px] text-emerald-300/70 mt-1 block">
              = Doanh thu - Giá vốn COGS - Hao hụt kho
            </span>
          </div>
        </div>

        {/* Biểu đồ tròn Tỷ trọng Doanh thu & Biểu đồ Khung giờ vàng */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <h4 className="font-bold text-sm text-zinc-200">
              Cơ cấu Doanh thu (Tiền mặt vs VietQR • Tại bàn vs Mang về)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={65}
                  >
                    {paymentPieData.map((entry, idx) => (
                      <Cell
                        key={entry.name}
                        fill={
                          PIE_COLORS_PAYMENT[idx % PIE_COLORS_PAYMENT.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatVND(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>

              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={channelPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={65}
                  >
                    {channelPieData.map((entry, idx) => (
                      <Cell
                        key={entry.name}
                        fill={
                          PIE_COLORS_CHANNEL[idx % PIE_COLORS_CHANNEL.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatVND(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-7 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-zinc-200">
                Biểu đồ Khung Giờ Vàng (Peak Hours Heatmap - vw_kpi_peak_hours)
              </h4>
              <span className="text-xs text-zinc-400">
                Số lượng món gọi theo giờ trong ngày
              </span>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={peakHoursChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis
                    dataKey="hourLabel"
                    stroke="#a1a1aa"
                    fontSize={11}
                  />
                  <YAxis stroke="#a1a1aa" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#3f3f46',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="totalItems"
                    name="Số lượng món đặt"
                    fill="#f59e0b"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* KHỐI 2: ĐÁNH GIÁ THỰC ĐƠN (TOP MỒI BÉN, TOP BIA & CẢNH BÁO MÓN Ế - MỤC 11.2) */}
      {/* ==================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="h-5 w-5 text-amber-400" />
          <h3 className="text-lg font-extrabold text-zinc-100">
            2. Đánh giá Thực đơn (Top Mồi Bén, Sản lượng Bia thực tế & Cảnh báo Món ế)
          </h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Top Mồi bén theo lợi nhuận gộp */}
          <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-400" />
              <h4 className="font-bold text-sm text-zinc-100">
                Top Mồi Bén mang lại Lãi gộp cao nhất (FOOD)
              </h4>
            </div>

            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topFoodByProfit}
                  layout="vertical"
                  margin={{ left: 16, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis type="number" stroke="#a1a1aa" fontSize={10} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={110}
                    stroke="#e4e4e7"
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(value: number) => formatVND(Number(value))}
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#3f3f46',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="gross_profit"
                    name="Lãi gộp"
                    fill="#10b981"
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Bia & Đồ uống tiêu thụ thực tế (đã trừ bia trả lại) */}
          <div className="lg:col-span-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Beer className="h-4 w-4 text-amber-400" />
              <h4 className="font-bold text-sm text-zinc-100">
                Top Bia & Đồ uống tiêu thụ thực tế (Đã trừ bia trả)
              </h4>
            </div>

            <div className="divide-y divide-zinc-800 text-xs">
              {topBeveragesByQuantity.length === 0 ? (
                <p className="py-8 text-center text-zinc-500">
                  Chưa có dữ liệu tiêu thụ bia.
                </p>
              ) : (
                topBeveragesByQuantity.map((bev, idx) => (
                  <div
                    key={bev.menu_item_id}
                    className="py-2.5 flex items-center justify-between"
                  >
                    <div>
                      <span className="font-bold text-amber-400 mr-2">
                        #{idx + 1}
                      </span>
                      <span className="font-semibold text-zinc-100">
                        {bev.name}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-black text-emerald-400 block">
                        {bev.total_quantity_sold} lon/chai
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Lãi: {formatVND(Number(bev.gross_profit))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Cảnh báo 5 Món ế (Slow-moving Items) */}
          <div className="lg:col-span-3 bg-zinc-900 border border-red-500/30 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h4 className="font-bold text-sm text-red-300">
                5 Món ế nhất (Cân nhắc đổi món)
              </h4>
            </div>

            <div className="divide-y divide-zinc-800 text-xs">
              {slowMovingItems.map((item) => (
                <div
                  key={item.menu_item_id}
                  className="py-2.5 flex items-center justify-between"
                >
                  <span className="font-medium text-zinc-200 truncate pr-2">
                    {item.name}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-300 font-bold shrink-0">
                    Bán: {item.total_quantity_sold}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* KHỐI 3: ĐÁNH GIÁ HIỆU SUẤT ĐẦU BẾP (KITCHEN KPI - MỤC 11.3) */}
      {/* ==================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-orange-400" />
          <h3 className="text-lg font-extrabold text-zinc-100">
            3. Đánh giá Hiệu suất Đầu bếp (Kitchen KPI - vw_kpi_kitchen_performance)
          </h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
              <span className="text-xs text-zinc-400">
                Thời gian chờ chế biến TB (Queue Wait Time)
              </span>
              <div className="text-2xl font-black text-amber-400 mt-1">
                {kitchenKpi.avg_queue_wait_minutes} phút
              </div>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                AVG(cooking_started_at - created_at)
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  Thời gian nấu thực tế TB (Actual Cook Time)
                </span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-full text-[10px] font-bold',
                    kitchenKpi.cook_time_evaluation === 'ON_TIME'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : kitchenKpi.cook_time_evaluation === 'WARNING'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-red-500/20 text-red-400'
                  )}
                >
                  {kitchenKpi.cook_time_evaluation === 'ON_TIME'
                    ? 'Đạt chuẩn (<= chuẩn)'
                    : kitchenKpi.cook_time_evaluation === 'WARNING'
                    ? 'Hơi trễ (<30%)'
                    : 'Cảnh báo chậm (>30%)'}
                </span>
              </div>
              <div
                className={cn(
                  'text-2xl font-black mt-1',
                  kitchenKpi.cook_time_evaluation === 'ON_TIME'
                    ? 'text-emerald-400'
                    : kitchenKpi.cook_time_evaluation === 'WARNING'
                    ? 'text-amber-400'
                    : 'text-red-400'
                )}
              >
                {kitchenKpi.avg_actual_cook_minutes} phút{' '}
                <span className="text-xs font-normal text-zinc-400">
                  / chuẩn {kitchenKpi.avg_standard_prep_minutes}p
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">
                  Tỷ lệ Nấu gộp mẻ (Batch Cooking Efficiency)
                </span>
                <Layers className="h-4 w-4 text-amber-400" />
              </div>
              <div className="text-2xl font-black text-sky-400 mt-1">
                {kitchenKpi.batch_cooking_efficiency_pct}%
              </div>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                {kitchenKpi.batch_cooked_items} / {kitchenKpi.total_cooked_items}{' '}
                đĩa được gom nấu chung mẻ
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
              <span className="text-xs text-zinc-400">
                Số món bị hủy do bếp làm chậm (&gt; 15 phút)
              </span>
              <div className="text-2xl font-black text-red-400 mt-1">
                {kitchenKpi.slow_cancelled_count} món
              </div>
              <span className="text-[11px] text-zinc-500 mt-1 block">
                status = CANCELLED &amp; (cancelled_at - created_at) &gt; 15p
              </span>
            </div>
          </div>

          {/* Biểu đồ cột so sánh thời gian chuẩn vs thời gian nấu thực tế */}
          <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-2">
            <h4 className="font-bold text-sm text-zinc-200">
              So sánh Tốc độ Chế biến Bếp (Phút)
            </h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kitchenCompareChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} />
                  <YAxis stroke="#a1a1aa" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#18181b',
                      borderColor: '#3f3f46',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="minutes"
                    name="Số phút trung bình"
                    fill="#f97316"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* KHỐI 4: ĐÁNH GIÁ HIỆU SUẤT NHÂN VIÊN CHẠY BÀN (WAITSTAFF KPI - MỤC 11.4) */}
      {/* ==================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-emerald-400" />
          <h3 className="text-lg font-extrabold text-zinc-100">
            4. Bảng xếp hạng Hiệu suất Nhân viên Phục vụ (Waitstaff KPI - vw_kpi_waitstaff_performance)
          </h3>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-400 bg-zinc-950/60">
                  <th className="py-3.5 px-4">Hạng</th>
                  <th className="py-3.5 px-4">Nhân viên</th>
                  <th className="py-3.5 px-4 text-right">
                    Số bàn đã mở &amp; chăm sóc
                  </th>
                  <th className="py-3.5 px-4 text-right">
                    Doanh thu bàn phụ trách
                  </th>
                  <th className="py-3.5 px-4 text-right">
                    Số đĩa bưng thực tế (served_by_staff_id)
                  </th>
                  <th className="py-3.5 px-4 text-right">
                    Tốc độ phản ứng AVG(served_at - ready_at)
                  </th>
                  <th className="py-3.5 px-4">Đánh giá tốc độ bưng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80 text-sm">
                {waitstaffKpi.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-8 text-center text-zinc-500"
                    >
                      Chưa có dữ liệu KPI nhân viên phục vụ.
                    </td>
                  </tr>
                ) : (
                  waitstaffKpi.map((st, idx) => {
                    const avgSeconds = Number(st.avg_pickup_speed_seconds) || 0;
                    return (
                      <tr key={st.staff_id} className="hover:bg-zinc-800/40">
                        <td className="py-3.5 px-4 font-black text-amber-400">
                          <span className="inline-flex items-center gap-1">
                            <Award className="h-4 w-4" />#{idx + 1}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-zinc-100">
                          {st.full_name}
                          <span className="ml-2 text-xs text-zinc-500 font-normal">
                            ({st.role})
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-semibold text-zinc-200">
                          {st.tables_opened_count} bàn
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-amber-400">
                          {formatVND(Number(st.managed_tables_revenue))}
                        </td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-emerald-400">
                          {st.active_serving_count} lượt bưng
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono text-zinc-200">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-zinc-400" />
                            {avgSeconds} giây
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          {st.pickup_speed_evaluation === 'EXCELLENT' && (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold">
                              Xuất sắc (&lt; 90s)
                            </span>
                          )}
                          {st.pickup_speed_evaluation === 'NORMAL' && (
                            <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold">
                              Bình thường (90s – 3p)
                            </span>
                          )}
                          {st.pickup_speed_evaluation === 'SLOW' && (
                            <span className="px-2.5 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 text-xs font-bold">
                              Chậm trễ (&gt; 3 phút)
                            </span>
                          )}
                          {st.pickup_speed_evaluation === 'NO_DATA' && (
                            <span className="px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400 text-xs">
                              Chưa phát sinh lượt bưng
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
