'use client';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, requiredSetting } from '@/lib/config/public';
import { isRecord } from '@/lib/orders/contracts';
import type { Database } from '@/types/database.types';

type Owner = { kind: 'session'; token: string } | { kind: 'staff'; actor: string };
let currentActor: string | null | undefined;
const accountListeners = new Set<() => void>();
/** Called synchronously by the Clerk root on sign-out/account changes. */
export function setRealtimeActor(actor: string | null) {
  if (currentActor === actor) return;
  currentActor = actor;
  accountListeners.forEach(listener => listener());
}
function parseTicket(value: unknown, owner: Owner) {
  if (!isRecord(value) || typeof value.token !== 'string' || value.token.length > 4096 ||
      typeof value.topic !== 'string' || typeof value.actorId !== 'string' ||
      typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
      value.expiresAt < Date.now() + 10000 || value.expiresAt > Date.now() + 121000) return null;
  if (owner.kind === 'staff' ? value.actorId !== owner.actor || !/^123dzo:role:(staff|kitchen|admin)$/.test(value.topic)
    : !/^123dzo:session:[0-9a-f-]{36}$/.test(value.topic) || value.topic !== `123dzo:session:${value.actorId}`) return null;
  return { token: value.token, topic: value.topic, expiresAt: value.expiresAt };
}

/** Invalidation only. A dedicated client prevents ticket/cookie sharing across scopes. */
export function subscribeInvalidations(owner: Owner, invalidate: () => void): () => void {
  if (process.env.NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED !== 'true') return () => {};
  let disposed = false, generation = 0, failures = 0;
  let client: SupabaseClient<Database> | null = null, channel: RealtimeChannel | null = null;
  let controller: AbortController | null = null;
  let renewal: ReturnType<typeof setTimeout> | undefined, expiry: ReturnType<typeof setTimeout> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined, debounce: ReturnType<typeof setTimeout> | undefined;
  let requestTimeout: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  const allowed = () => !disposed && document.visibilityState === 'visible' && navigator.onLine &&
    (owner.kind === 'session' || currentActor === undefined || currentActor === owner.actor);
  const signal = () => {
    if (!allowed() || debounce) return;
    debounce = setTimeout(() => { debounce = undefined; if (allowed()) invalidate(); }, 250);
  };
  const disconnect = () => {
    generation++; controller?.abort(); controller = null;
    clearTimeout(requestTimeout);
    clearTimeout(renewal); clearTimeout(expiry); clearTimeout(retry); clearTimeout(debounce); debounce = undefined;
    if (client) {
      if (channel) void client.removeChannel(channel).catch(() => {});
      void client.realtime.disconnect().catch(() => {});
    }
    channel = null; client = null;
  };
  const scheduleRetry = () => {
    disconnect();
    if (allowed()) retry = setTimeout(() => { void connect(); }, Math.min(30000, 2000 * 2 ** Math.min(failures++, 4)));
  };
  const connect = async () => {
    disconnect();
    if (!allowed()) return;
    const run = generation;
    controller = new AbortController();
    const request = controller;
    requestTimeout = setTimeout(() => request.abort(), 10000);
    const timeout = requestTimeout;
    try {
      const response = await fetch(owner.kind === 'session' ? '/api/customer/realtime-ticket' : '/api/staff/realtime-ticket', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: request.signal,
        headers: owner.kind === 'session' ? { 'x-session-token': owner.token } : {},
      });
      if (run !== generation || !allowed() || request.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) { signal(); return; }
      const ticket = response.ok ? parseTicket(await response.json(), owner) : null;
      if (run !== generation || !allowed() || request.signal.aborted) return;
      if (!ticket) throw new Error('INVALID_TICKET');
      client = createClient<Database>(supabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
        requiredSetting('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          accessToken: async () => { if (!allowed() || Date.now() >= ticket.expiresAt) throw new Error('TICKET_EXPIRED'); return ticket.token; },
        });
      expiry = setTimeout(() => scheduleRetry(), Math.max(0, ticket.expiresAt - Date.now()));
      // New authorization and join (not just locally extending an old JWT).
      renewal = setTimeout(() => { void connect(); }, Math.max(1000, ticket.expiresAt - Date.now() - 30000 - Math.random() * 5000));
      // Bootstrap auth before channel.subscribe(): the SDK's async accessToken
      // callback alone can race the first join and send it without a JWT.
      const liveClient = client;
      await liveClient.realtime.setAuth(ticket.token);
      if (run !== generation || !allowed()) { void liveClient.realtime.disconnect().catch(() => {}); return; }
      channel = client.channel(ticket.topic, { config: { private: true, broadcast: { self: false }, presence: { enabled: false } } })
        .on('broadcast', { event: 'invalidate' }, message => {
          if (run !== generation || !isRecord(message.payload) || message.payload.v !== 1 ||
              typeof message.payload.id !== 'string' || !/^[0-9a-f-]{36}$/.test(message.payload.id) || seen.has(message.payload.id)) return;
          seen.add(message.payload.id); if (seen.size > 100) seen.delete(seen.values().next().value!);
          signal();
        }).subscribe(status => {
          if (run !== generation) return;
          if (status === 'SUBSCRIBED') { failures = 0; signal(); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') scheduleRetry();
        });
    } catch { if (run === generation && allowed()) scheduleRetry(); }
    finally { clearTimeout(timeout); if (run === generation) controller = null; }
  };
  const resume = () => { if (allowed()) { if (!client && !controller) void connect(); } else disconnect(); };
  const accountChanged = () => { disconnect(); if (allowed()) void connect(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume); window.addEventListener('offline', resume);
  accountListeners.add(accountChanged);
  void connect();
  return () => {
    disposed = true; disconnect(); seen.clear(); accountListeners.delete(accountChanged);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume); window.removeEventListener('offline', resume);
  };
}
