import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { canManageRole, getCurrentStaffProfile, getHomeByRole, isConfiguredOperator, isManager, isStaffRole } from '@/lib/auth/roles';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const actor = await getCurrentStaffProfile();
    if (!actor || !isManager(actor.role)) return NextResponse.json({ error: 'Không có quyền tạo tài khoản.' }, { status: 403 });
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON không hợp lệ.' }, { status: 400 });
    const input = body as Record<string, unknown>;
    const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
    const emailAddress = typeof input.emailAddress === 'string' ? input.emailAddress.trim().toLowerCase() : '';
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const role = input.role;
    const assignedZoneId = input.assignedZoneId ?? null;
    if (!fullName || fullName.length > 200 || (!emailAddress && !username) || password.length < 8 || password.length > 128 || !isStaffRole(role) ||
      (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) ||
      (username && !/^[a-zA-Z0-9_-]{4,64}$/.test(username)) ||
      (assignedZoneId !== null && (typeof assignedZoneId !== 'string' || !/^[0-9a-f-]{36}$/i.test(assignedZoneId)))) {
      return NextResponse.json({ error: 'Nhập họ tên, email hoặc username (4–64 chữ/số/_/-), mật khẩu 8–128 ký tự và vai trò hợp lệ.' }, { status: 400 });
    }
    if (!canManageRole(actor.role, role)) return NextResponse.json({ error: 'Chỉ Operator được tạo Chủ quán hoặc Operator.' }, { status: 403 });
    if (actor.role !== 'operator' && isConfiguredOperator({ id: '', emailAddresses: emailAddress ? [{ emailAddress, verification: { status: 'verified' } }] : [] })) {
      return NextResponse.json({ error: 'Email này dành riêng cho Operator.' }, { status: 403 });
    }
    const db = createSupabaseServiceRoleClient();
    if (assignedZoneId) {
      const zone = await db.from('zones').select('id').eq('id', assignedZoneId).maybeSingle();
      if (zone.error || !zone.data) return NextResponse.json({ error: 'Khu vực không tồn tại.' }, { status: 400 });
    }
    const client = await clerkClient();
    // Resolve both identifiers before touching a password; never merge two accounts.
    const matches = await Promise.all([
      emailAddress ? client.users.getUserList({ emailAddress: [emailAddress], limit: 2 }) : null,
      username ? client.users.getUserList({ username: [username], limit: 2 }) : null,
    ]);
    const users = new Map(matches.flatMap((result) => result?.data ?? []).map((user) => [user.id, user]));
    if (users.size > 1) return NextResponse.json({ error: 'Email và username thuộc hai tài khoản khác nhau.' }, { status: 409 });
    let user = users.values().next().value;
    let created = false;
    if (user) {
      const existing = await db.from('staff_profiles').select('role').eq('id', user.id).maybeSingle();
      if (existing.error) throw new Error('Không thể kiểm tra tài khoản đã có.');
      if (user.id === actor.id || isConfiguredOperator(user) ||
        (existing.data && !canManageRole(actor.role, existing.data.role)) ||
        (!existing.data && actor.role !== 'operator')) {
        return NextResponse.json({ error: 'Không có quyền thay đổi tài khoản này. Hãy dùng tài khoản mới hoặc liên hệ Operator.' }, { status: 403 });
      }
      // Only return an identifier that really belongs to the existing Clerk user.
      if ((emailAddress && !user.emailAddresses.some((entry) => entry.emailAddress.toLowerCase() === emailAddress)) ||
        (username && user.username !== username)) {
        return NextResponse.json({ error: 'Thông tin đăng nhập không khớp tài khoản đã có.' }, { status: 409 });
      }
      user = await client.users.updateUser(user.id, { password, firstName: fullName, skipPasswordChecks: true });
    } else {
      user = await client.users.createUser({ emailAddress: emailAddress ? [emailAddress] : undefined, username: username || undefined, password, firstName: fullName, skipPasswordChecks: true });
      created = true;
    }
    const result = await db.from('staff_profiles').upsert({
      id: user.id, full_name: fullName, role, assigned_zone_id: assignedZoneId, is_active: true,
    }, { onConflict: 'id' }).select('*').single();
    if (result.error) {
      // A failed database insert must not leave a newly created login behind.
      if (created) await client.users.deleteUser(user.id).catch(() => undefined);
      return NextResponse.json({ error: 'Chưa đồng bộ được hồ sơ nhân sự. Vui lòng thử lại cùng thông tin đăng nhập.' }, { status: 502 });
    }
    const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || req.url).origin;
    return NextResponse.json({ success: true, profile: result.data, credentials: {
      loginIdentifier: emailAddress || username, password, loginUrl: `${origin}${getHomeByRole(role)}`,
    } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const clerkError = error as { errors?: Array<{ code?: string; longMessage?: string; message?: string }> };
    const detail = clerkError.errors?.[0];
    return NextResponse.json({ error: detail?.longMessage || detail?.message || 'Không thể tạo tài khoản. Kiểm tra kết nối Clerk/Supabase và thử lại.' }, { status: detail ? 400 : 500 });
  }
}
