import { NextResponse } from 'next/server';
import { getCurrentStaffProfile } from '@/lib/auth/roles';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import type { MenuItemInsert } from '@/types/database.types';

const sampleMenu: MenuItemInsert[] = [
  { name: 'Ếch xào sả ớt', category: 'FOOD', station: 'KITCHEN', price: 95000, cost_price: 45000, prep_time_minutes: 15 },
  { name: 'Đậu hũ chiên sả', category: 'FOOD', station: 'KITCHEN', price: 45000, cost_price: 18000, prep_time_minutes: 10 },
  { name: 'Khoai tây chiên', category: 'FOOD', station: 'KITCHEN', price: 45000, cost_price: 20000, prep_time_minutes: 10 },
  { name: 'Mực nướng', category: 'FOOD', station: 'KITCHEN', price: 120000, cost_price: 65000, prep_time_minutes: 20 },
  { name: 'Bia Sài Gòn', category: 'BEER', station: 'BAR_INSTANT', price: 18000, cost_price: 12000, prep_time_minutes: 0 },
  { name: 'Nước suối', category: 'DRINK', station: 'BAR_INSTANT', price: 10000, cost_price: 4000, prep_time_minutes: 0 },
];

export async function POST(req: Request) {
  try {
    const actor = await getCurrentStaffProfile();
    if (actor?.role !== 'operator') return NextResponse.json({ error: 'Chỉ Operator được dùng tiện ích bàn giao.' }, { status: 403 });
    const body: unknown = await req.json().catch(() => null);
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const db = createSupabaseServiceRoleClient();
    if (input.action === 'seed') {
      const [zones, tables, menu] = await Promise.all([
        db.from('zones').select('id, name'),
        db.from('tables').select('id', { count: 'exact', head: true }),
        db.from('menu_items').select('id', { count: 'exact', head: true }),
      ]);
      if (zones.error || tables.error || menu.error) throw new Error('Không đọc được dữ liệu hiện tại.');
      if (tables.count || menu.count) return NextResponse.json({ error: 'Chỉ tạo mẫu khi quán chưa có bàn và món. Dữ liệu hiện tại được giữ nguyên.' }, { status: 409 });
      let sampleZones = zones.data ?? [];
      if (sampleZones.length === 0) {
        const result = await db.from('zones').insert([{ name: 'Sân vườn' }, { name: 'Trong nhà' }]).select('id, name');
        if (result.error || !result.data) throw new Error('Không tạo được khu vực mẫu.');
        sampleZones = result.data;
      }
      const result = await db.from('tables').insert(Array.from({ length: 6 }, (_, index) => ({
        table_number: `Bàn ${String(index + 1).padStart(2, '0')}`,
        zone_id: sampleZones[Math.floor(index / 3) % sampleZones.length].id,
        status: 'AVAILABLE' as const,
      }))).select('id');
      if (result.error) throw new Error('Không tạo được bàn mẫu.');
      const items = await db.from('menu_items').insert(sampleMenu);
      if (items.error) {
        // Undo only the tables from this request so the operator can retry.
        const rollback = await db.from('tables').delete().in('id', (result.data ?? []).map((table) => table.id));
        throw new Error(rollback.error ? 'Chưa tạo được menu; bàn mẫu đã được lưu. Kiểm tra Bàn & Nhân sự trước khi thử lại.' : 'Không tạo được menu mẫu. Vui lòng thử lại.');
      }
      return NextResponse.json({ success: true, message: 'Đã tạo 6 bàn và 6 món mẫu trong các khu vực của quán.' });
    }
    if (input.action === 'reset' && input.confirmation === 'XOA HOA DON TEST') {
      // Session deletion cascades to order_items and clears table session references.
      const sessions = await db.from('table_sessions').delete().not('id', 'is', null);
      if (sessions.error) throw new Error('Chưa xóa được hóa đơn test. Vui lòng thử lại.');
      const tables = await db.from('tables').update({ status: 'AVAILABLE', current_session_id: null }).not('id', 'is', null);
      if (tables.error) throw new Error('Đã xóa hóa đơn nhưng chưa trả trạng thái bàn. Bấm reset lại để hoàn tất.');
      return NextResponse.json({ success: true, message: 'Đã xóa toàn bộ hóa đơn và món gọi, trả bàn về trống. Thực đơn, khu vực, nhân sự và kho được giữ nguyên.' });
    }
    return NextResponse.json({ error: 'Thao tác hoặc xác nhận không hợp lệ.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Không thể thực hiện. Vui lòng thử lại.' }, { status: 500 });
  }
}
