import { auth } from '@clerk/nextjs/server';
import { resolveStaffProfile } from '@/lib/auth/roles';
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { readSnapshot } from '@/lib/services/snapshots';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Short, cancellable SSE connections reconnect automatically. No work outlives the response.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || undefined;
  const view = new URL(req.url).searchParams.get('view') || undefined;
  const { userId } = await auth();
  const actor = !token && userId ? await resolveStaffProfile(userId) : null;
  if (!token && !actor) return Response.json({ error: 'Chưa đăng nhập.' }, { status: 401 });
  try {
    const initial = await readSnapshot(actor, token, view);
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let finish = () => { closed = true; if (timer) clearTimeout(timer); };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const started = Date.now();
        let previous = JSON.stringify(initial);
        finish = () => {
          if (closed) return;
          closed = true; if (timer) clearTimeout(timer);
          req.signal.removeEventListener('abort', finish);
          try { controller.close(); } catch { /* Reader already cancelled. */ }
        };
        req.signal.addEventListener('abort', finish, { once: true });
        if (req.signal.aborted) { finish(); return; }
        controller.enqueue(encoder.encode(`retry: 1000\ndata: ${previous}\n\n`));
        async function tick() {
          if (closed) return;
          if (Date.now() - started >= 24000) { finish(); return; }
          try {
            const profile = !token && userId ? await createSupabaseServiceRoleClient().from('staff_profiles').select('*').eq('id', userId).eq('is_active', true).maybeSingle() : null;
            const freshActor = profile?.data ?? null;
            if (!token && !freshActor) { finish(); return; }
            const next = JSON.stringify(await readSnapshot(freshActor, token, view));
            if (closed) return;
            if (next !== previous) { controller.enqueue(encoder.encode(`data: ${next}\n\n`)); previous = next; }
            else controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch { finish(); return; }
          if (!closed) timer = setTimeout(tick, 3000);
        }
        timer = setTimeout(tick, 3000);
      },
      cancel() { finish(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch { return Response.json({ error: 'Không đọc được dữ liệu phiên.' }, { status: 403 }); }
}
