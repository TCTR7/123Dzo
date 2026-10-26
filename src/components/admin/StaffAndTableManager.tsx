'use client';
import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Users, LayoutGrid, Pencil, Trash2, X } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { AccountCredentials, type LoginCredentials } from '@/components/shared/AccountCredentials';
import { normalizePhoneUsername, PHONE_USERNAME_ERROR } from '@/lib/auth/phone-username';
import { staffRoleLabel } from '@/lib/ui-labels';
import type { StaffRole, StaffProfileRow, TableRow, TableSessionRow } from '@/types/database.types';

interface Props { currentStaffRole: StaffRole; initialTables: TableRow[]; initialStaff: StaffProfileRow[]; initialActiveSessions: TableSessionRow[] }
export function StaffAndTableManager({ currentStaffRole, initialTables, initialStaff, initialActiveSessions }: Props) {
  const db = createSupabaseBrowserClient();
  const [tables, setTables] = useState(initialTables), [staff, setStaff] = useState(initialStaff), [sessions, setSessions] = useState(initialActiveSessions);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(false), [editingTable, setEditingTable] = useState<TableRow | null>(null), [number, setNumber] = useState('');
  const [staffOpen, setStaffOpen] = useState(false), [editingStaff, setEditingStaff] = useState<StaffProfileRow | null>(null);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState<StaffRole>('staff'), [active, setActive] = useState(true);
  const [credentials, setCredentials] = useState<LoginCredentials | null>(null);
  const sortedTables = useMemo(() => [...tables].sort((a,b) => a.table_number.localeCompare(b.table_number, 'vi', { numeric: true })), [tables]);
  const canEdit = (row: StaffProfileRow) => currentStaffRole === 'operator' || ['staff','kitchen'].includes(row.role);
  function openTable(row: TableRow | null) { setEditingTable(row); setNumber(row?.table_number.replace(/^bàn\s*/i, '') ?? ''); setError(''); setTableOpen(true); }
  function openStaff(row: StaffProfileRow | null) { setEditingStaff(row); setName(row?.full_name ?? ''); setRole(row?.role ?? 'staff'); setActive(row?.is_active ?? true); setPhone(''); setPassword(''); setCredentials(null); setError(''); setStaffOpen(true); }
  async function saveTable(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!/^\d{1,4}$/.test(number) || Number(number) < 1) { setError('Nhập số bàn từ 1 đến 9999.'); return; }
    const label = 'Bàn ' + Number(number);
    if (tables.some(t => t.id !== editingTable?.id && t.table_number.replace(/^bàn\s*/i, '').replace(/^0+/, '') === String(Number(number)))) { setError('Số bàn này đã có rồi.'); return; }
    setBusy(true); setError('');
    try {
      let row: TableRow;
      if (editingTable) {
        const result = await db.from('tables').update({ table_number: label }).eq('id', editingTable.id).select('*').single();
        if (result.error || !result.data) throw Error('Chưa sửa được bàn. Vui lòng thử lại.');
        row = result.data;
      } else {
        const result = await fetch('/api/supabase-proxy/rest/v1/tables', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.pgrst.object+json' }, body: JSON.stringify({ table_number: label }) });
        const body = await result.json();
        if (!result.ok) throw Error(body.message || 'Chưa thêm được bàn.');
        row = body as TableRow;
      }
      setTables(old => editingTable ? old.map(t => t.id === row.id ? row : t) : [...old, row]);
      setTableOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa lưu được bàn.'); }
    finally { setBusy(false); }
  }
  async function deleteTable(row: TableRow) {
    if (busy || pending) return;
    if (row.status === 'OCCUPIED' || sessions.some(s => s.table_id === row.id && s.status !== 'CLOSED')) { setError('Bàn đang có khách, hãy thanh toán trước khi xóa.'); return; }
    if (!confirm('Xóa ' + row.table_number + '?')) return;
    setPending(row.id); setError('');
    try { const result = await db.from('tables').delete().eq('id', row.id); if (result.error) throw Error('Chưa xóa được bàn, có thể bàn đã có hóa đơn.'); setTables(old => old.filter(t => t.id !== row.id)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Chưa xóa được bàn.'); } finally { setPending(null); }
  }
  async function assign(session: TableSessionRow, staffId: string) {
    if (pending) return; setPending(session.id); setError('');
    try { const r = await db.from('table_sessions').update({ assigned_staff_id: staffId || null }).eq('id', session.id).select('*').single(); if (r.error || !r.data) throw Error('Chưa đổi được người phụ trách.'); setSessions(old => old.map(s => s.id === r.data.id ? r.data : s)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Vui lòng thử lại.'); } finally { setPending(null); }
  }
  async function saveStaff(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    const normalized = normalizePhoneUsername(phone);
    if (!editingStaff && !normalized) { setError(PHONE_USERNAME_ERROR); return; }
    setBusy(true);
    try {
      if (editingStaff) {
        const r = await db.from('staff_profiles').update({ full_name: name.trim(), role, is_active: active }).eq('id', editingStaff.id).select('*').single();
        if (r.error || !r.data) throw Error('Chưa cập nhật được nhân viên.');
        setStaff(old => old.map(s => s.id === r.data.id ? r.data : s));
      } else {
        const r = await fetch('/api/accounts/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: name.trim(), phoneNumber: normalized, password, role }) });
        const body = await r.json() as { error?: string; profile: StaffProfileRow; credentials: LoginCredentials };
        if (!r.ok) throw Error(body.error || 'Chưa tạo được tài khoản.');
        setStaff(old => [body.profile, ...old.filter(s => s.id !== body.profile.id)]); setCredentials(body.credentials);
      }
      setPassword(''); setStaffOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Chưa lưu được nhân viên.'); } finally { setBusy(false); }
  }
  const field = 'mt-2 w-full rounded-xl px-4 py-3';
  return <div className="space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">SẮP XẾP QUÁN MÌNH</p><h1 className="mt-2 text-3xl font-bold">Bàn & Nhân sự</h1><p className="mt-2 text-muted-ink">Đánh số bàn, thêm người cùng làm. Ai mở bàn sẽ phụ trách bàn đó.</p></div><div className="flex flex-wrap gap-3"><button onClick={() => openTable(null)} className="neu-button flex items-center gap-2 px-4 py-3"><Plus className="h-4 w-4" />Thêm bàn</button><button onClick={() => openStaff(null)} className="neu-button neu-selected flex items-center gap-2 px-4 py-3"><Users className="h-4 w-4" />Thêm nhân viên</button></div></header>
    {error && !tableOpen && !staffOpen && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    {credentials && <AccountCredentials credentials={credentials} />}
    <section className="space-y-4"><h2 className="flex items-center gap-2 text-xl font-bold"><LayoutGrid className="h-5 w-5 text-teal-700" />Danh sách bàn <span className="text-sm font-normal text-muted-ink">({tables.length})</span></h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{sortedTables.map(t => {
        const session = sessions.find(s => s.table_id === t.id && s.status !== 'CLOSED');
        return <article key={t.id} className={'neu-card p-5 ' + (session ? 'tone-peach' : '')}><div className="flex items-start justify-between gap-3"><div><h3 className="text-2xl font-bold">{t.table_number}</h3><p className="mt-2 text-sm font-semibold text-teal-800">{session || t.status === 'OCCUPIED' ? 'Đang có khách' : 'Bàn trống'}</p></div><div className="flex gap-2"><button aria-label={'Sửa ' + t.table_number} onClick={() => openTable(t)} className="neu-button p-3"><Pencil className="h-4 w-4" /></button><button aria-label={'Xóa ' + t.table_number} disabled={Boolean(pending)} onClick={() => void deleteTable(t)} className="neu-button p-3 text-red-700"><Trash2 className="h-4 w-4" /></button></div></div>
          {session ? <label className="mt-5 block text-sm">Người phụ trách<select aria-label={'Người phụ trách ' + t.table_number} disabled={Boolean(pending)} value={session.assigned_staff_id ?? ''} onChange={e => void assign(session,e.target.value)} className={field}><option value="">Chưa có người phụ trách</option>{staff.filter(s => s.is_active && s.role !== 'kitchen').map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label> : <p className="mt-5 text-sm text-muted-ink">Nhân viên nhận bàn khi bấm Mở bàn.</p>}</article>;
      })}</div>{!tables.length && <p className="neu-card p-10 text-center text-muted-ink">Thêm bàn đầu tiên để bắt đầu đón khách.</p>}
    </section>
    <section className="neu-card p-5"><h2 className="text-xl font-bold">Nhân viên</h2><div className="mt-4 divide-y divide-line">{staff.map(s => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-bold">{s.full_name}</p><p className="mt-1 text-sm text-muted-ink">{staffRoleLabel[s.role]} · {s.is_active ? 'Đang làm việc' : 'Tạm nghỉ'}</p></div><button disabled={!canEdit(s)} onClick={() => openStaff(s)} className="neu-button px-4 py-3 text-sm">Chỉnh sửa</button></div>)}</div>{!staff.length && <p className="py-8 text-muted-ink">Chưa có nhân viên.</p>}</section>
    {(tableOpen || staffOpen) && <div role="dialog" aria-modal="true" aria-labelledby="edit-title" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/35 p-4 backdrop-blur-sm"><section className="neu-card my-auto max-h-[90dvh] w-full max-w-md overflow-y-auto p-6">
      <div className="flex items-center justify-between gap-3"><h2 id="edit-title" className="text-xl font-bold">{tableOpen ? editingTable ? 'Sửa số bàn' : 'Thêm bàn mới' : editingStaff ? 'Sửa nhân viên' : 'Thêm nhân viên'}</h2><button aria-label="Đóng" disabled={busy} onClick={() => { setTableOpen(false); setStaffOpen(false); }} className="neu-button p-3"><X className="h-5 w-5" /></button></div>
      {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
      {tableOpen ? <form onSubmit={saveTable} className="mt-5 space-y-5"><label className="block text-sm font-semibold">Số bàn<input aria-label="Số bàn" autoFocus type="number" min="1" max="9999" step="1" required value={number} onChange={e => setNumber(e.target.value)} className={field} placeholder="Ví dụ: 1" /></label><button disabled={busy} className="neu-button neu-selected w-full py-3 font-bold">{busy ? 'Đang lưu…' : 'Lưu bàn'}</button></form> :
      <form onSubmit={saveStaff} className="mt-5 space-y-4"><label className="block text-sm font-semibold">Họ và tên<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={field} /></label>{!editingStaff && <><label className="block text-sm font-semibold">Số điện thoại đăng nhập<input type="tel" required maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} className={field} placeholder="0912345678" /></label><label className="block text-sm font-semibold">Mật khẩu khởi tạo<input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className={field} /></label></>}
        <label className="block text-sm font-semibold">Công việc<select value={role} onChange={e => setRole(e.target.value as StaffRole)} className={field}><option value="staff">Phục vụ</option><option value="kitchen">Đầu bếp</option>{currentStaffRole === 'operator' && <><option value="admin">Chủ quán</option><option value="operator">Người bàn giao</option></>}</select></label>
        {editingStaff && <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Đang làm việc</label>}
        <button disabled={busy} className="neu-button neu-selected w-full py-3 font-bold">{busy ? 'Đang lưu…' : 'Lưu nhân viên'}</button>
      </form>}
    </section></div>}
  </div>;
}
