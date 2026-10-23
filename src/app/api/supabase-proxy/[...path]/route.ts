import type { NextRequest } from 'next/server';
import { proxyToSupabase } from '@/lib/services/proxy';

export function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return proxyToSupabase(req, ctx.params); }
export function HEAD(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return proxyToSupabase(req, ctx.params); }
export function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return proxyToSupabase(req, ctx.params); }
export function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return proxyToSupabase(req, ctx.params); }
export function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return proxyToSupabase(req, ctx.params); }
