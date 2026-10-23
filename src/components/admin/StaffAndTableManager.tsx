'use client';
import type { AdminStaffDirectoryEntry as StaffProfileRow } from '@/lib/data/read-contracts';
import { useListPage, LocalListNavigation } from '@/components/ui/LocalListNavigation';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { pendingSessionAction, submitSessionAction, acknowledgeSessionAction } from '@/lib/sessions/client';
import type { SessionCommand } from '@/lib/sessions/contracts';
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
import { useMetadata } from '@/lib/metadata/use-metadata';
import { pendingMetadata } from '@/lib/metadata/client';
import { tableSnapshot } from '@/lib/metadata/contracts';
import { MetadataFeedback } from './MetadataFeedback';
import { cn } from '@/lib/utils';
import { editableStaffProfile, isStaffRole, saveStaffProfile, type StaffProfileEditable } from '@/lib/auth/staff-profile';
import type {
  ZoneRow,
  TableRow,
  StaffRole,
  TableSessionRow,
} from '@/types/database.types';

interface StaffAndTableManagerProps {
  initialZones: ZoneRow[];
  initialTables: TableRow[];
  initialStaff: StaffProfileRow[];
  initialActiveSessions: TableSessionRow[];
  currentAdminId?: string;
}

const ASSIGNMENT_REQUIRED = 'Chọn phiên bàn đang mở và nhân viên nhận bàn đang làm việc.';
const ROLE_LABELS: Record<StaffRole, { label: string; badgeClass: string }> = {
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
  initialZones,
  initialTables,
  initialStaff,
  initialActiveSessions,
  currentAdminId,
}: StaffAndTableManagerProps) {
  const metadata = useMetadata(currentAdminId);
  const router = useRouter();
  const [assignmentPending, setAssignmentPending] = useState(false);

  const [zones, setZones] = useState<ZoneRow[]>(initialZones);
  const [tables, setTables] = useState<TableRow[]>(initialTables);
  const [staffList, setStaffList] = useState<StaffProfileRow[]>(initialStaff);
  const [activeSessions, setActiveSessions] = useState<TableSessionRow[]>(
    initialActiveSessions
  );

  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>('ALL');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [localBusy, setIsSubmitting] = useState<boolean>(false);
  const isSubmitting = localBusy || metadata.busy;
  const staffMutationPending = useRef(false);
  useEffect(() => { setActiveSessions(initialActiveSessions); }, [initialActiveSessions]);
  useEffect(() => { setTables(initialTables); }, [initialTables]);
  useEffect(() => { setZones(initialZones); }, [initialZones]);
  useEffect(() => { setStaffList(initialStaff); }, [initialStaff]);
  useEffect(() => {
    if (!currentAdminId) return;
    try { setAssignmentPending(pendingSessionAction({ mode: 'staff', identity: currentAdminId }) !== null); }
    catch (error) { setAssignmentPending(true); setErrorMessage(error instanceof Error ? error.message : ASSIGNMENT_REQUIRED); }
  }, [currentAdminId]);

  async function runAssignment(command?: SessionCommand, alreadyLocked = false) {
    if (!currentAdminId || (!alreadyLocked && !beginStaffMutationForRecovery())) return;
    const scope = { mode: 'staff' as const, identity: currentAdminId };
    try {
      const { result } = await submitSessionAction(scope, command);
      acknowledgeSessionAction(scope, result.operationId); router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : ASSIGNMENT_REQUIRED); router.refresh();
    } finally {
      try { setAssignmentPending(pendingSessionAction(scope) !== null); } catch { setAssignmentPending(true); }
      endStaffMutation();
    }
  }
  function beginStaffMutationForRecovery() {
    if (staffMutationPending.current || isSubmitting || metadata.pending) return false;
    staffMutationPending.current = true; setIsSubmitting(true); setErrorMessage(null); return true;
  }

  function beginStaffMutation(): boolean {
    if (staffMutationPending.current || isSubmitting || metadata.pending || assignmentPending) return false;
    staffMutationPending.current = true;
    setIsSubmitting(true);
    setErrorMessage(null);
    return true;
  }

  function endStaffMutation() {
    staffMutationPending.current = false;
    setIsSubmitting(false);
  }

  function mergeSavedStaff(saved: StaffProfileEditable) {
    setStaffList((previous) => {
      const exists = previous.some((staff) => staff.id === saved.id);
      return exists
        ? previous.map((staff) => staff.id === saved.id ? { ...staff, ...saved } : staff)
        : [{ ...saved, has_push_subscription: false }, ...previous];
    });
  }

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
        (s) => s.is_active && (s.role === 'staff' || s.role === 'admin')
      ),
    [staffList]
  );

  const filteredTables = useMemo(() => {
    if (selectedZoneFilter === 'ALL') return tables;
    return tables.filter((t) => t.zone_id === selectedZoneFilter);
  }, [tables, selectedZoneFilter]);

  const tablePage = useListPage(filteredTables, selectedZoneFilter);
  const staffPage = useListPage(staffList, 'staff');

  // ==========================================================================
  // XỬ LÝ CRUD KHU VỰC (ZONES)
  // ==========================================================================
  async function handleSaveZone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isSubmitting || assignmentPending || metadata.blocked) return;
    const name = newZoneName.trim();
    if (!name) return;
    const confirmed = await metadata.run(editingZone
      ? { resource: 'ZONE', action: 'UPDATE', id: editingZone.id, item: { name }, expected: { name: editingZone.name } }
      : { resource: 'ZONE', action: 'CREATE', id: crypto.randomUUID(), item: { name }, expected: null });
    if (confirmed) { setEditingZone(null); setNewZoneName(''); }
  }

  async function handleDeleteZone(zone: ZoneRow) {
    if (isSubmitting || assignmentPending || metadata.blocked) return;
    await metadata.run({ resource: 'ZONE', action: 'DELETE', id: zone.id, item: null, expected: { name: zone.name } });
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
    if (isSubmitting || assignmentPending || metadata.blocked) return;
    const item = { table_number: tableNumber.trim(), zone_id: tableZoneId };
    const confirmed = await metadata.run(editingTable
      ? { resource: 'TABLE', action: 'UPDATE', id: editingTable.id, item, expected: tableSnapshot(editingTable) }
      : { resource: 'TABLE', action: 'CREATE', id: crypto.randomUUID(), item, expected: null });
    if (confirmed || (currentAdminId && pendingMetadata(currentAdminId))) setIsTableModalOpen(false);
  }

  async function handleDeleteTable(table: TableRow) {
    if (isSubmitting || assignmentPending || metadata.blocked) return;
    await metadata.run({ resource: 'TABLE', action: 'DELETE', id: table.id, item: null, expected: tableSnapshot(table) });
  }

  /**
   * Gán nhân viên phụ trách trực tiếp cho phiên bàn đang mở (table_sessions.assigned_staff_id)
   * Không tự đổi khu vực mặc định của nhân viên khi phân công một bàn.
   */
  async function handleAssignStaffToTable(table: TableRow, staffId: string | null) {
    const session=sessionByTableId.get(table.id);
    if (!currentAdminId || !session || !staffId) {setErrorMessage(ASSIGNMENT_REQUIRED);return;}
    if (assignmentPending || !beginStaffMutation()) return;
    await runAssignment({action:'HANDOVER',input:{sessionId:session.id,expectedAssignedStaffId:session.assigned_staff_id,assignedStaffId:staffId}},true);
  }

  // ==========================================================================
  // XỬ LÝ CRUD NHÂN SỰ (STAFF_PROFILES)
  // ==========================================================================
  function openCreateStaffModal() {
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
    if (isSubmitting || staffMutationPending.current) return;

    const trimmedId = staffClerkId.trim();
    const trimmedName = staffFullName.trim();

    if (!trimmedId || !trimmedName) {
      setErrorMessage('Clerk User ID và Họ tên nhân viên là bắt buộc.');
      return;
    }

    if (!beginStaffMutation()) return;
    try {
      const saved = await saveStaffProfile({
        id: editingStaff?.id ?? trimmedId, full_name: trimmedName, role: staffRole,
        assigned_zone_id: staffZoneId || null, is_active: staffIsActive,
      }, editingStaff ? editableStaffProfile(editingStaff) : null);
      mergeSavedStaff(saved);

      setIsStaffModalOpen(false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi lưu hồ sơ nhân viên'
      );
    } finally {
      endStaffMutation();
    }
  }

  async function handleQuickZoneAssignForStaff(
    staffId: string,
    zoneId: string | null
  ) {
    const staff = staffList.find((candidate) => candidate.id === staffId);
    if (!staff || !beginStaffMutation()) return;
    try {
      const expected = editableStaffProfile(staff);
      mergeSavedStaff(await saveStaffProfile({ ...expected, assigned_zone_id: zoneId }, expected));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi cập nhật khu vực nhân viên'
      );
    } finally {
      endStaffMutation();
    }
  }

  async function handleToggleStaffActive(staff: StaffProfileRow) {
    if (!beginStaffMutation()) return;
    try {
      const expected = editableStaffProfile(staff);
      mergeSavedStaff(await saveStaffProfile({ ...expected, is_active: !staff.is_active }, expected));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi khi đổi trạng thái nhân sự'
      );
    } finally {
      endStaffMutation();
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
            Thiết lập sơ đồ Khu vực (`zones`), Bàn vật lý (`tables`) và phân công Nhân viên phụ trách bàn/khu vực để định tuyến Web Push Notification.
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
            disabled={isSubmitting || assignmentPending || metadata.pending}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors"
          >
            <Plus className="h-4 w-4" />
            Thêm Hồ sơ Nhân sự
          </button>
        </div>
      </div>

      <MetadataFeedback {...metadata} recover={() => metadata.run()} />
      {assignmentPending && <div role="status" className="rounded-xl border border-amber-500 p-4">
        <p>Có thao tác bàn chưa xác nhận.</p>
        <button type="button" disabled={isSubmitting} onClick={() => void runAssignment()} className="min-h-12 px-4 text-amber-300">Kiểm tra thao tác bàn vừa gửi</button>
      </div>}
      {errorMessage && (
        <div role="alert" className="p-3.5 rounded-lg bg-red-950/60 border border-red-500/50 text-red-200 text-sm flex items-center justify-between">
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
              disabled={isSubmitting || assignmentPending || metadata.pending}
              className="min-h-12 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm whitespace-nowrap"
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
                        className="min-h-12 min-w-12 p-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        title="Đổi tên khu vực"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting || assignmentPending || metadata.blocked}
                        onClick={() => handleDeleteZone(zone)}
                        className="min-h-12 min-w-12 p-1.5 rounded-md bg-zinc-900 hover:bg-red-950 text-zinc-400 hover:text-red-400"
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
            tablePage.pageItems.map((table) => {
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
                        disabled={isSubmitting || assignmentPending || metadata.blocked}
                        onClick={() => openEditTableModal(table)}
                        className="min-h-12 min-w-12 p-1 text-zinc-400 hover:text-zinc-200"
                        title="Sửa bàn"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitting || assignmentPending || metadata.blocked}
                        onClick={() => handleDeleteTable(table)}
                        className="min-h-12 min-w-12 p-1 text-zinc-400 hover:text-red-400"
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
                      disabled={!activeSession || !currentAdminId || isSubmitting || assignmentPending || metadata.pending}
                      aria-label={`Nhân viên phụ trách ${table.table_number}`}
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
                    {!activeSession && (
                      <p className="mt-1.5 text-xs text-zinc-400">
                        Mở bàn để phân công. Khu vực mặc định sửa tại mục Nhân sự.
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <LocalListNavigation {...tablePage} label="Bàn" />
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
                <th className="py-3 px-4">Web Push</th>
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
                staffPage.pageItems.map((staff) => {
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
                          disabled={isSubmitting || assignmentPending || metadata.pending}
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
                        {staff.has_push_subscription ? (
                          <span className="text-emerald-400 font-medium">
                            Đã bật thông báo
                          </span>
                        ) : (
                          <span className="text-zinc-500">Chưa đăng ký</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleStaffActive(staff)}
                          disabled={isSubmitting || assignmentPending || metadata.pending}
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
                          disabled={isSubmitting || assignmentPending || metadata.pending}
                          aria-label={`Sửa hồ sơ ${staff.full_name}`}
                          className="min-h-12 min-w-12 p-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
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

      <LocalListNavigation {...staffPage} label="Nhân sự" />
      {/* Modal Thêm / Sửa Bàn (tables) */}
      {isTableModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
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
              {metadata.error && <p role="alert" className="text-red-300">{metadata.error}</p>}
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
                  disabled={isSubmitting || assignmentPending || metadata.pending}
                  className="min-h-12 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm"
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 space-y-4">
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
              <div>
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
              </div>

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
                  onChange={(e) => { if (isStaffRole(e.target.value)) setStaffRole(e.target.value); }}
                  className="w-full px-3.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-zinc-100"
                >
                  <option value="staff">Phục vụ chạy bàn (staff)</option>
                  <option value="kitchen">Đầu bếp KDS (kitchen)</option>
                  <option value="admin">Quản trị viên / Chủ quán (admin)</option>
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

              <label className="flex items-center gap-2.5 text-sm text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={staffIsActive}
                  onChange={(e) => setStaffIsActive(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-amber-500"
                />
                <span>Đang hoạt động (is_active)</span>
              </label>

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
                  disabled={isSubmitting || assignmentPending || metadata.pending}
                  className="min-h-12 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm"
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
