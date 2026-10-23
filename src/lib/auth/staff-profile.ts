import type { StaffProfileRow, StaffRole } from '@/types/database.types';

export type StaffProfileEditable = Pick<StaffProfileRow, 'id' | 'full_name' | 'role' | 'assigned_zone_id' | 'is_active'>;
export type SaveStaffRequest =
  | { action: 'create'; profile: StaffProfileEditable; expected: null }
  | { action: 'update'; profile: StaffProfileEditable; expected: StaffProfileEditable };

const PROFILE_KEYS = ['id', 'full_name', 'role', 'assigned_zone_id', 'is_active'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function editableStaffProfile(profile: StaffProfileEditable): StaffProfileEditable {
  return {
    id: profile.id, full_name: profile.full_name, role: profile.role,
    assigned_zone_id: profile.assigned_zone_id, is_active: profile.is_active,
  };
}

export function parseStaffProfile(value: unknown): StaffProfileEditable | null {
  if (!isRecord(value) || Object.keys(value).length !== PROFILE_KEYS.length ||
      !PROFILE_KEYS.every((key) => Object.hasOwn(value, key))) return null;
  const { id, full_name, role, assigned_zone_id, is_active } = value;
  if (typeof id !== 'string' || !/^user_[A-Za-z0-9_]{1,128}$/.test(id) ||
      typeof full_name !== 'string' || !full_name.trim() || full_name.length > 120 ||
      (role !== 'admin' && role !== 'staff' && role !== 'kitchen') ||
      (assigned_zone_id !== null && (typeof assigned_zone_id !== 'string' || !UUID.test(assigned_zone_id))) ||
      typeof is_active !== 'boolean') return null;
  return { id, full_name, role, assigned_zone_id, is_active };
}

export function parseSaveStaffRequest(value: unknown): SaveStaffRequest | null {
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
      !['action', 'profile', 'expected'].every((key) => Object.hasOwn(value, key))) return null;
  const parsed = parseStaffProfile(value.profile);
  if (!parsed) return null;
  const profile = { ...parsed, full_name: parsed.full_name.trim() };
  if (value.action === 'create' && value.expected === null) return { action: 'create', profile, expected: null };
  const expected = parseStaffProfile(value.expected);
  if (value.action === 'update' && expected?.id === profile.id) return { action: 'update', profile, expected };
  return null;
}

export function isStaffRole(value: string): value is StaffRole {
  return value === 'admin' || value === 'staff' || value === 'kitchen';
}

/** Browser mutation client; no credentials, actor IDs or subscription keys in payload. */
export async function saveStaffProfile(
  profile: StaffProfileEditable,
  expected: StaffProfileEditable | null
): Promise<StaffProfileEditable> {
  const unconfirmed = 'Chưa xác nhận được kết quả. Vui lòng tải lại trang trước khi thử lại.';
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch('/api/admin/staff', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: expected ? 'update' : 'create', profile: editableStaffProfile(profile), expected: expected ? editableStaffProfile(expected) : null }),
    });
    payload = await response.json();
  } catch {
    throw new Error(unconfirmed);
  }
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    throw new Error(typeof error?.message === 'string' ? error.message : 'Không thể lưu nhân sự. Vui lòng tải lại trang để kiểm tra.');
  }
  const saved = isRecord(payload) ? parseStaffProfile(payload.data) : null;
  if (!saved || saved.id !== profile.id) throw new Error(unconfirmed);
  return saved;
}
