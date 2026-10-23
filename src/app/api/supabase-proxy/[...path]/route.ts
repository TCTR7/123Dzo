import { NextResponse, type NextRequest } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { canManageRole, getCurrentStaffProfile, isConfiguredOperator, isManager, isStaffRole } from '@/lib/auth/roles';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

const ALLOWED_PATHS = /^\/(rest\/v1|storage\/v1|auth\/v1)\b/;

async function proxyToSupabase(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const subPath = '/' + (path ?? []).join('/');
  if (!ALLOWED_PATHS.test(subPath)) {
    return NextResponse.json({ message: 'Forbidden Supabase path' }, { status: 403 });
  }

  // Personnel writes must enforce the same hierarchy as account provisioning.
  // A hidden UI option alone does not prevent elevating a role via REST.
  if (path[0] === 'rest' && path[1] === 'v1' && path[2] === 'staff_profiles') {
    const actor = await getCurrentStaffProfile();
    const forbidden = () => NextResponse.json({ message: 'Không có quyền thay đổi nhân sự này.' }, { status: 403 });
    if (!actor) return forbidden();
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!isManager(actor.role) || !['POST', 'PATCH'].includes(req.method)) return forbidden();
      const body: unknown = await req.clone().json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return forbidden();
      const data = body as Record<string, unknown>;
      if (Object.keys(data).some((key) => !['id', 'full_name', 'role', 'assigned_zone_id', 'is_active'].includes(key))) return forbidden();
      if (data.role !== undefined && (!isStaffRole(data.role) || !canManageRole(actor.role, data.role))) return forbidden();
      const filter = req.nextUrl.searchParams.get('id');
      const id = req.method === 'POST' ? data.id : filter?.startsWith('eq.') ? filter.slice(3) : null;
      if (typeof id !== 'string' || !id || (req.method === 'PATCH' && data.id !== undefined)) return forbidden();
      const existing = await createSupabaseServiceRoleClient().from('staff_profiles').select('role').eq('id', id).maybeSingle();
      if (existing.error || (existing.data && !canManageRole(actor.role, existing.data.role))) return forbidden();
      if (id === actor.id && (data.role !== undefined && data.role !== actor.role || data.is_active === false)) return forbidden();
      if (req.method === 'POST' && !existing.data) {
        if (!isStaffRole(data.role)) return forbidden();
        const user = await (await clerkClient()).users.getUser(id).catch(() => null);
        if (!user || (actor.role !== 'operator' && isConfiguredOperator(user))) return forbidden();
      }
    }
  }
  if (['accept-profile', 'content-profile'].some((key) => req.headers.has(key) && req.headers.get(key) !== 'public')) {
    return NextResponse.json({ message: 'Forbidden schema' }, { status: 403 });
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, '');
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    '';

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ message: 'Supabase configuration missing' }, { status: 500 });
  }

  const targetUrl = `${supabaseUrl}${subPath}${req.nextUrl.search}`;
  const headers = new Headers();

  for (const [key, value] of req.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === 'accept' ||
      lower === 'content-type' ||
      lower === 'prefer' ||
      lower === 'accept-profile' ||
      lower === 'content-profile' ||
      lower === 'range' ||
      lower === 'x-upsert' ||
      lower === 'cache-control'
    ) {
      headers.set(key, value);
    }
  }

  headers.set('apikey', serviceKey);
  headers.set('Authorization', `Bearer ${serviceKey}`);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const bodyBuffer = hasBody ? await req.arrayBuffer() : undefined;

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: bodyBuffer,
    cache: 'no-store',
  });

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === 'content-type' ||
      lower === 'content-range' ||
      lower === 'preference-applied'
    ) {
      responseHeaders.set(key, value);
    }
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToSupabase(req, ctx.params);
}

export function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToSupabase(req, ctx.params);
}

export function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToSupabase(req, ctx.params);
}

export function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToSupabase(req, ctx.params);
}

export function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToSupabase(req, ctx.params);
}
