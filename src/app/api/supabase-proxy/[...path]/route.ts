import { NextResponse, type NextRequest } from 'next/server';

const ALLOWED_PATHS = /^\/(rest\/v1|storage\/v1|auth\/v1)\b/;

async function proxyToSupabase(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const subPath = '/' + (path ?? []).join('/');
  if (!ALLOWED_PATHS.test(subPath)) {
    return NextResponse.json({ message: 'Forbidden Supabase path' }, { status: 403 });
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
