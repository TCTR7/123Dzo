import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { requiredSetting } from '@/lib/config/public';
import { runNotificationWorker } from '@/lib/notifications/worker';
export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  let secret: string;
  try {
    secret = requiredSetting('NOTIFICATION_WORKER_SECRET', process.env.NOTIFICATION_WORKER_SECRET);
    if (secret.length < 32) throw new Error('INVALID_WORKER_SECRET');
  } catch { return NextResponse.json({ error: 'WORKER_NOT_CONFIGURED' }, { status: 503, headers }); }
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get('authorization') ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers });
  try { return NextResponse.json(await runNotificationWorker(), { headers }); }
  catch { return NextResponse.json({ error: 'WORKER_UNAVAILABLE' }, { status: 503, headers }); }
}
