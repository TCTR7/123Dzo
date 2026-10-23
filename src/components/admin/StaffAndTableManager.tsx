'use client';

import { useState, useMemo } from 'react';
import {
  MapPin,
  Plus,
  Users,
  LayoutGrid,
  UserCheck,
  Trash2,
  Edit3,
  CheckCircle2,
  XCircle,
  X,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { AccountCredentials, type LoginCredentials } from '@/components/shared/AccountCredentials';
import type {
  ZoneRow,
  TableRow,
  StaffProfileRow,
  StaffRole,
  TableSessionRow,
} from '@/types/database.types';

interface StaffAndTableManagerProps {
  currentStaffRole: StaffRole;
  initialZones: ZoneRow[];
  initialTables: TableRow[];
  initialStaff: StaffProfileRow[];
  initialActiveSessions: TableSessionRow[];
}

const ROLE_LABELS: Record<StaffRole, { label: string; badgeClass: string }> = {
  operator: {
    label: 'Bàn giao hệ thống (operator)',
    badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  },
  admin: {
    label: 'Quản trị / Thu ngân (admin)',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  staff: {
    label: 'Phục vụ chạy bàn (staff)',
    badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  kitchen: {
    label: 'Đầu bếp KDS (kitchen)',
    badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
};

export function StaffAndTableManager({
  currentStaffRole,
  initialZones,
  initialTables,
  initialStaff,
  initialActiveSessions,
}: StaffAndTableManagerProps) {
  const supabase = createSupabaseBrowserClient();

  const [zones, setZones] = useState<ZoneRow[]>(initialZones);
  const [tables, setTables] = useState<TableRow[]>(initialTables);
  const [staffList, setStaffList] = useState<StaffProfileRow[]>(initialStaff);
  const [activeSessions, setActiveSessions] = useState<TableSessionRow[]>(
    initialActiveSessions
  );

  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('ALL');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // State tạo nhanh Khu vực (zones)
  const [newZoneName, setNewZoneName] = useState<string>('');
  const [editingZone, setEditingZone] = useState<ZoneRow | null>(null);

  // State Modal Thêm / Sửa Bàn (tables)
  const [isTableModalOpen, setIsTableModalOpen] = useState<boolean>(false);
  const [editingTable, setEditingTable] = useState<TableRow | null>(null);
  const [tableNumber, setTableNumber] = useState<string>('');
  const [tableZoneId, setTableZoneId] = useState<string>('');

  // State Modal Thêm / Sửa Nhân viên (staff_profiles)
  const [isStaffModalOpen, setIsStaffModalOpen] = useState<boolean>(false);
  const [editingStaff, setEditingStaff] = useState<StaffProfileRow | null>(
    null
  );
  const [staffClerkId, setStaffClerkId] = useState<string>('');
  const [staffFullName, setStaffFullName] = useState<string>('');
  const [staffRole, setStaffRole] = useState<StaffRole>('staff');
  const [staffZoneId, setStaffZoneId] = useState<string>('');
  const [staffIsActive, setStaffIsActive] = useState<boolean>(true);
  const [advancedStaff, setAdvancedStaff] = useState(false);
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [credentials, setCredentials] = useState<LoginCredentials | null>(null);
  const canEditStaff = (staff: StaffProfileRow) => currentStaffRole === 'operator' || staff.role === 'staff' || staff.role === 'kitchen';

  const zoneById = useMemo(() => {
    const map = new Map<string, ZoneRow>();
    zones.forEach((z) => map.set(z.id, z));
    return map;
  }, [zones]);

  const sessionByTableId = useMemo(() => {
    const map = new Map<string, TableSessionRow>();
    activeSessions.forEach((s) => {
      if (s.table_id && s.status !== 'CLOSED') {
        map.set(s.table_id, s);
      }
    });
    return map;
  }, [activeSessions]);

  const activeWaitstaff = useMemo(
    () =>
      staffList.filter(
        (s) => s.is_active && (s.role === 'staff' || s.role === 'admin' || s.role === 'operator')
      ),
    [staffList]
  );

  const filteredTables = useMemo(() => {
    if (selectedZoneFilter === 'ALL') return tables;
    return tables.filter((t) => t.zone_id === selectedZoneFilter);
  }, [tables, selectedZoneFilter]);

  // ==========================================================================
  // XỬ LÝ CRUD KHU VỰC (ZONES)
  // ==========================================================================
  async function handleSaveZone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmed = newZoneName.trim();
    if (!trimmed) {
      setErrorMessage('Tên khu vực không được để trống.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (editingZone) {
        const { data, error } = await supabase
          .from('zones')
          .update({ name: trimmed })
          .eq('id', editingZone.id)
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể cập nhật khu vực');
        }

        setZones((prev) => prev.map((z) => (z.id === data.id ? data : z)));
        setEditingZone(null);
      } else {
        const { data, error } = await supabase
          .from('zones')
          .insert({ name: trimmed })
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể thêm khu vực mới');
        }

        setZones((prev) => [...prev, data]);
      }

      setNewZoneName('');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi lưu khu vực'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteZone(zoneId: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.from('zones').delete().eq('id', zoneId);
      if (error) {
        throw new Error(error.message);
      }
      setZones((prev) => prev.filter((z) => z.id !== zoneId));
      setTables((prev) => prev.filter((t) => t.zone_id !== zoneId));
      setStaffList((prev) =>
        prev.map((s) =>
          s.assigned_zone_id === zoneId ? { ...s, assigned_zone_id: null } : s
        )
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Không thể xóa khu vực'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // ==========================================================================
  // XỬ LÝ CRUD BÀN VẬT LÝ (TABLES) & GÁN NHÂN VIÊN PHỤ TRÁCH BÀN
  // ==========================================================================
  function openCreateTableModal() {
    if (zones.length === 0) {
      setErrorMessage('Vui lòng tạo ít nhất 1 Khu vực trước khi thêm bàn.');
      return;
    }
    setEditingTable(null);
    setTableNumber('');
    setTableZoneId(zones[0]?.id ?? '');
    setErrorMessage(null);
    setIsTableModalOpen(true);
  }

  function openEditTableModal(table: TableRow) {
    setEditingTable(table);
    setTableNumber(table.table_number);
    setTableZoneId(table.zone_id);
    setErrorMessage(null);
    setIsTableModalOpen(true);
  }

  async function handleSaveTable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedNumber = tableNumber.trim();
    if (!trimmedNumber || !tableZoneId) {
      setErrorMessage('Vui lòng nhập tên bàn và chọn khu vực.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (editingTable) {
        const { data, error } = await supabase
          .from('tables')
          .update({
            table_number: trimmedNumber,
            zone_id: tableZoneId,
          })
          .eq('id', editingTable.id)
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể cập nhật bàn');
        }

        setTables((prev) => prev.map((t) => (t.id === data.id ? data : t)));
      } else {
        const { data, error } = await supabase
          .from('tables')
          .insert({
            table_number: trimmedNumber,
            zone_id: tableZoneId,
            status: 'AVAILABLE',
          })
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể tạo bàn mới');
        }

        setTables((prev) => [...prev, data]);
      }

      setIsTableModalOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi lưu bàn');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteTable(tableId: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase
        .from('tables')
        .delete()
        .eq('id', tableId);
      if (error) {
        throw new Error(error.message);
      }
      setTables((prev) => prev.filter((t) => t.id !== tableId));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi khi xóa bàn');
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Gán nhân viên phụ trách trực tiếp cho phiên bàn đang mở (table_sessions.assigned_staff_id)
   * hoặc gán nhân viên phụ trách Khu vực của bàn đó (staff_profiles.assigned_zone_id)
   */
  async function handleAssignStaffToTable(
    table: TableRow,
    staffId: string | null
  ) {
    setErrorMessage(null);
    const activeSession = sessionByTableId.get(table.id);

    try {
      // Nếu bàn đang có phiên mở (ACTIVE / REQUEST_BILL), cập nhật trực tiếp table_sessions.assigned_staff_id
      if (activeSession) {
        const { data, error } = await supabase
          .from('table_sessions')
          .update({ assigned_staff_id: staffId })
          .eq('id', activeSession.id)
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(
            error?.message ?? 'Không thể cập nhật nhân viên phụ trách phiên bàn'
          );
        }

        setActiveSessions((prev) =>
          prev.map((s) => (s.id === data.id ? data : s))
        );
      }

      // Đồng thời nếu chọn một nhân viên cụ thể, gán nhân viên đó phụ trách khu vực của bàn (assigned_zone_id)
      if (staffId) {
        const { data: updatedStaff, error: staffError } = await supabase
          .from('staff_profiles')
          .update({ assigned_zone_id: table.zone_id })
          .eq('id', staffId)
          .select('*')
          .single();

        if (staffError || !updatedStaff) {
          throw new Error(
            staffError?.message ?? 'Không thể gán khu vực cho nhân viên'
          );
        }

        setStaffList((prev) =>
          prev.map((s) => (s.id === updatedStaff.id ? updatedStaff : s))
        );
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi gán nhân viên phụ trách'
      );
    }
  }

  // ==========================================================================
  // XỬ LÝ CRUD NHÂN SỰ (STAFF_PROFILES)
  // ==========================================================================
  function openCreateStaffModal() {
    setAdvancedStaff(false);
    setLoginIdentifier('');
    setInitialPassword('');
    setCredentials(null);
    setEditingStaff(null);
    setStaffClerkId('');
    setStaffFullName('');
    setStaffRole('staff');
    setStaffZoneId('');
    setStaffIsActive(true);
    setErrorMessage(null);
    setIsStaffModalOpen(true);
  }

  function openEditStaffModal(staff: StaffProfileRow) {
    setEditingStaff(staff);
    setStaffClerkId(staff.id);
    setStaffFullName(staff.full_name);
    setStaffRole(staff.role);
    setStaffZoneId(staff.assigned_zone_id ?? '');
    setStaffIsActive(staff.is_active);
    setErrorMessage(null);
    setIsStaffModalOpen(true);
  }

  async function handleSaveStaff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedId = staffClerkId.trim();
    const trimmedName = staffFullName.trim();

    if (((editingStaff || advancedStaff) && !trimmedId) || !trimmedName) {
      setErrorMessage('Clerk User ID và Họ tên nhân viên là bắt buộc.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (!editingStaff && !advancedStaff) {
        const identifier = loginIdentifier.trim();
        const response = await fetch('/api/accounts/provision', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: trimmedName, role: staffRole, password: initialPassword,
            ...(identifier.includes('@') ? { emailAddress: identifier } : { username: identifier }), assignedZoneId: staffZoneId || null }),
        });
        const result = await response.json() as { error?: string; profile: StaffProfileRow; credentials: LoginCredentials };
        if (!response.ok) throw new Error(result.error || 'Không thể tạo tài khoản.');
        setStaffList((prev) => [result.profile, ...prev.filter((item) => item.id !== result.profile.id)]);
        setCredentials(result.credentials);
        setInitialPassword('');
      } else if (editingStaff) {
        const { data, error } = await supabase
          .from('staff_profiles')
          .update({
            full_name: trimmedName,
            role: staffRole,
            assigned_zone_id: staffZoneId || null,
            is_active: staffIsActive,
          })
          .eq('id', editingStaff.id)
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể cập nhật nhân viên');
        }

        setStaffList((prev) => prev.map((s) => (s.id === data.id ? data : s)));
      } else {
        const { data, error } = await supabase
          .from('staff_profiles')
          .insert({
            id: trimmedId,
            full_name: trimmedName,
            role: staffRole,
            assigned_zone_id: staffZoneId || null,
            is_active: staffIsActive,
          })
          .select('*')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Không thể thêm hồ sơ nhân viên');
        }

        setStaffList((prev) => [data, ...prev]);
      }

      setIsStaffModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi lưu hồ sơ nhân viên'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleQuickZoneAssignForStaff(
    staffId: string,
    zoneId: string | null
  ) {
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('staff_profiles')
        .update({ assigned_zone_id: zoneId })
        .eq('id', staffId)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? 'Không thể đổi khu vực phụ trách');
      }

      setStaffList((prev) => prev.map((s) => (s.id === data.id ? data : s)));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi cập nhật khu vực nhân viên'
      );
    }
  }

  async function handleToggleStaffActive(staff: StaffProfileRow) {
    setErrorMessage(null);
    try {
      const { data, error } = await supabase
        .from('staff_profiles')
        .update({ is_active: !staff.is_active })
        .eq('id', staff.id)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? 'Không thể đổi trạng thái nhân sự');
      }

      setStaffList((prev) => prev.map((s) => (s.id === data.id ? data : s)));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi đổi trạng thái nhân sự'
      );
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">
            Quản lý Khu vực, Bàn & Phân công Nhân sự
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            Quản lý khu vực, bàn và phân công nhân viên để gửi cảnh báo món chín đúng người trong ứng dụng.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={openCreateTableModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium text-sm border border-zinc-700 transition-colors"
          >
            <LayoutGrid className="h-4 w-4 text-amber-400" />
            Thêm Bàn mới
          </button>
          <button
            type="button"
            onClick={openCreateStaffModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            Thêm Hồ sơ Nhân sự
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-red-950/60 border border-red-500/50 text-red-200 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {credentials && <AccountCredentials credentials={credentials} />}

      {/* PHẦN 1: QUẢN LÝ KHU VỰC (ZONES) */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-bold text-zinc-100">
              1. Danh mục Khu vực (Zones)
            </h3>
          </div>

          <form onSubmit={handleSaveZone} className="flex items-center gap-2">
            <input
              type="text"
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              placeholder={
                editingZone
                  ? `Đổi tên "${editingZone.name}"...`
                  : 'Tên khu vực mới (VD: Sân vườn, Phòng VIP)...'
              }
              className="px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 min-w-[240px]"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm whitespace-nowrap"
            >
              {editingZone ? 'Lưu tên' : '+ Thêm khu vực'}
            </button>
            {editingZone && (
              <button
                type="button"
                onClick={() => {
                  setEditingZone(null);
                  setNewZoneName('');
                }}
                className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-xs"
              >
                Hủy
              </button>
            )}
          </form>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {zones.length === 0 ? (
            <div className="col-span-full py-6 text-center text-zinc-500 text-sm">
              Chưa có khu vực nào. Hãy tạo khu vực đầu tiên (VD: Khu Sân vườn).
            </div>
          ) : (
            zones.map((zone) => {
              const tablesInZone = tables.filter((t) => t.zone_id === zone.id);
              const staffInZone = staffList.filter(
                (s) => s.assigned_zone_id === zone.id && s.is_active
              );
              return (
                <div
                  key={zone.id}
                  className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-zinc-100">{zone.name}</h4>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        {tablesInZone.length} bàn vật lý • {staffInZone.length}{' '}
                        NV phụ trách
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingZone(zone);
                          setNewZoneName(zone.name);
                        }}
                        className="p-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        title="Đổi tên khu vực"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteZone(zone.id)}
                        className="p-1.5 rounded-md bg-zinc-900 hover:bg-red-950 text-zinc-400 hover:text-red-400"
                        title="Xóa khu vực"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {staffInZone.length === 0 ? (
                      <span className="text-[11px] text-amber-400/80">
                        Chưa gán nhân viên trực khu vực
                      </span>
                    ) : (
                      staffInZone.map((st) => (
                        <span
                          key={st.id}
                          className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium"
                        >
                          {st.full_name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* PHẦN 2: SƠ ĐỒ BÀN & GÁN NHÂN VIÊN PHỤ TRÁCH BÀN */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-bold text-zinc-100">
              2. Danh sách Bàn & Gán Nhân viên phụ trách Bàn
            </h3>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedZoneFilter('ALL')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                selectedZoneFilter === 'ALL'
                  ? 'bg-amber-500 text-zinc-950 border-amber-500 font-semibold'
                  : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              )}
            >
              Tất cả khu vực ({tables.length})
            </button>
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => setSelectedZoneFilter(z.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  selectedZoneFilter === z.id
                    ? 'bg-amber-500 text-zinc-950 border-amber-500 font-semibold'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                )}
              >
                {z.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {filteredTables.length === 0 ? (
            <div className="col-span-full py-8 text-center text-zinc-500 text-sm">
              Chưa có bàn vật lý nào trong khu vực này.
            </div>
          ) : (
            filteredTables.map((table) => {
              const zone = zoneById.get(table.zone_id);
              const activeSession = sessionByTableId.get(table.id);
              const zoneStaff = activeWaitstaff.find(
                (s) => s.assigned_zone_id === table.zone_id
              );
              const currentAssignedStaffId =
                activeSession?.assigned_staff_id ?? zoneStaff?.id ?? '';

              return (
                <div
                  key={table.id}
                  className={cn(
                    'p-4 rounded-xl border flex flex-col justify-between gap-3 transition-colors',
                    table.status === 'OCCUPIED'
                      ? 'bg-amber-500/10 border-amber-500/40'
                      : 'bg-zinc-950 border-zinc-800'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] font-medium text-zinc-400">
                        {zone?.name ?? 'Chưa rõ khu vực'}
                      </span>
                      <h4 className="text-base font-bold text-zinc-100">
                        {table.table_number}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[11px] font-semibold border',
                          table.status === 'OCCUPIED'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        )}
                      >
                        {table.status === 'OCCUPIED' ? 'Đang có khách' : 'Bàn trống'}
                      </span>
                      <button
                        type="button"
                        onClick={() => openEditTableModal(table)}
                        className="p-1 text-zinc-400 hover:text-zinc-200"
                        title="Sửa bàn"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTable(table.id)}
                        className="p-1 text-zinc-400 hover:text-red-400"
                        title="Xóa bàn"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zinc-800/80">
                    <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 mb-1.5">
                      <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                      Nhân viên phụ trách bàn:
                    </label>
                    <select
                      value={currentAssignedStaffId}
                      onChange={(e) =>
                        handleAssignStaffToTable(
                          table,
                          e.target.value ? e.target.value : null
                        )
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-100"
                    >
                      <option value="">-- Chưa phân công --</option>
                      {activeWaitstaff.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.full_name} ({st.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* PHẦN 3: DANH SÁCH HỒ SƠ NHÂN SỰ (STAFF_PROFILES) */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-amber-400" />
          <h3 className="text-lg font-bold text-zinc-100">
            3. Hồ sơ Nhân sự & Phân quyền Clerk (staff_profiles)
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
                <th className="py-3 px-4">Họ và tên</th>
                <th className="py-3 px-4">Clerk User ID</th>
                <th className="py-3 px-4">Vai trò (Role)</th>
                <th className="py-3 px-4">Khu vực phụ trách</th>
                <th className="py-3 px-4">Thông báo nội bộ</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70 text-sm">
              {staffList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-500">
                    Chưa có hồ sơ nhân sự nào.
                  </td>
                </tr>
              ) : (
                staffList.map((staff) => {
                  const roleCfg = ROLE_LABELS[staff.role];
                  return (
                    <tr key={staff.id} className="hover:bg-zinc-800/30">
                      <td className="py-3.5 px-4 font-semibold text-zinc-100">
                        {staff.full_name}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-zinc-400">
                        {staff.id}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
                            roleCfg.badgeClass
                          )}
                        >
                          {roleCfg.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          value={staff.assigned_zone_id ?? ''}
                          disabled={!canEditStaff(staff)}
                          onChange={(e) =>
                            handleQuickZoneAssignForStaff(
                              staff.id,
                              e.target.value || null
                            )
                          }
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-200"
                        >
                          <option value="">-- Không cố định --</option>
                          {zones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3.5 px-4 text-xs">
                        <span className="text-zinc-400">{staff.is_active ? 'Nhận khi mở app' : 'Tạm dừng'}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleStaffActive(staff)}
                          disabled={!canEditStaff(staff)}
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border',
                            staff.is_active
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                          )}
                        >
                          {staff.is_active ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Đang làm việc
                            </>
                          ) : (
                            <>
                              <XCircle className="h-3.5 w-3.5" />
                              Tạm nghỉ
                            </>
                          )}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => openEditStaffModal(staff)}
                          disabled={!canEditStaff(staff)}
                          className="p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Thêm / Sửa Bàn (tables) */}
      {isTableModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                {editingTable ? 'Cập nhật Bàn vật lý' : 'Thêm Bàn vật lý mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsTableModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTable} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Tên / Số bàn *
                </label>
                <input
                  type="text"
                  required
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="VD: Bàn 01, Bàn 05, VIP 02..."
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Thuộc Khu vực (Zone) *
                </label>
                <select
                  required
                  value={tableZoneId}
                  onChange={(e) => setTableZoneId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsTableModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm"
                >
                  {isSubmitting ? 'Đang lưu...' : 'Lưu thông tin bàn'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Thêm / Sửa Hồ sơ Nhân viên (staff_profiles) */}
      {isStaffModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-lg font-bold text-zinc-100">
                {editingStaff
                  ? 'Chỉnh sửa Hồ sơ Nhân sự'
                  : 'Thêm Hồ sơ Nhân sự mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsStaffModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStaff} className="space-y-4">
              {errorMessage && <p role="alert" className="text-sm text-red-300">{errorMessage}</p>}
              {!editingStaff && <>
                <label className="block text-sm">Email / Tên đăng nhập
                  <input required={!advancedStaff} disabled={advancedStaff} value={loginIdentifier} onChange={(e) => setLoginIdentifier(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" />
                </label>
                <label className="block text-sm">Mật khẩu khởi tạo
                  <input type="password" minLength={8} maxLength={128} required={!advancedStaff} disabled={advancedStaff} value={initialPassword} onChange={(e) => setInitialPassword(e.target.value)} autoComplete="new-password" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2" />
                </label>
                <label className="flex gap-2 text-xs text-zinc-400"><input type="checkbox" checked={advancedStaff} onChange={(e) => setAdvancedStaff(e.target.checked)} />Nâng cao: Nhập clerk_user_id có sẵn</label>
              </>}
              {(editingStaff || advancedStaff) && <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Clerk User ID (id) *
                </label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingStaff)}
                  value={staffClerkId}
                  onChange={(e) => setStaffClerkId(e.target.value)}
                  placeholder="VD: user_2t9x8kLp..."
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100 disabled:opacity-60 font-mono"
                />
              </div>}

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Họ và tên nhân viên *
                </label>
                <input
                  type="text"
                  required
                  value={staffFullName}
                  onChange={(e) => setStaffFullName(e.target.value)}
                  placeholder="VD: Nguyễn Văn Hùng"
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Vai trò phân quyền (Role) *
                </label>
                <select
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value as StaffRole)}
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                >
                  <option value="staff">Phục vụ chạy bàn (staff)</option>
                  <option value="kitchen">Đầu bếp KDS (kitchen)</option>
                  {currentStaffRole === 'operator' && <><option value="admin">Quản trị viên / Chủ quán (admin)</option><option value="operator">Bàn giao hệ thống (operator)</option></>}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Khu vực phụ trách mặc định (assigned_zone_id)
                </label>
                <select
                  value={staffZoneId}
                  onChange={(e) => setStaffZoneId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                >
                  <option value="">-- Không cố định khu vực --</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>

              {(editingStaff || advancedStaff) && <label className="flex items-center gap-2.5 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={staffIsActive}
                  onChange={(e) => setStaffIsActive(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-amber-500"
                />
                <span>Đang hoạt động (is_active)</span>
              </label>}

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsStaffModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm"
                >
                  {isSubmitting ? 'Đang lưu...' : 'Lưu nhân sự'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
