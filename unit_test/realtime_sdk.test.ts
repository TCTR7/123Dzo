import { afterEach, expect, it, vi } from 'vitest';
import { subscribeInvalidations, setRealtimeActor } from '@/lib/realtime/invalidation';

// Actual installed Supabase/Phoenix SDK; only the WebSocket peer is a fixture.
// This proves join wire/config/token/dispatch/cleanup, not server RLS/key trust.
class PeerSocket extends EventTarget {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  CONNECTING=0; OPEN=1; CLOSING=2; CLOSED=3; readyState=0;
  protocol=''; binaryType=''; bufferedAmount=0; extensions='';
  onopen: ((event: Event) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  static instances: PeerSocket[]=[];
  frames: unknown[][]=[];
  constructor(public url: string) {
    super(); PeerSocket.instances.push(this);
    queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState=1; this.onopen?.(new Event('open')); });
  }
  send(data: string) {
    if (typeof data !== 'string') throw new Error('Unexpected non-control fixture frame');
    const frame: unknown[] = JSON.parse(data); this.frames.push(frame);
    const [join, ref, topic, event] = frame;
    if (event === 'phx_join' || event === 'phx_leave') queueMicrotask(() => this.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]),
    })));
  }
  close() { this.readyState=3; this.onclose?.(new CloseEvent('close')); }
  invalidate(topic: string) {
    const join=this.frames.find(frame => frame[3]==='phx_join')?.[0];
    this.onmessage?.(new MessageEvent('message',{data:JSON.stringify([join,null,topic,'broadcast',{
      type:'broadcast',event:'invalidate',payload:{v:1,id:'10000000-0000-4000-8000-000000000001'},
    }])}));
  }
}
let dispose=() => {};
afterEach(async () => { dispose(); setRealtimeActor(null); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('installed SDK sends scoped JWT/private join, receives invalidation and releases socket', async () => {
  vi.useFakeTimers(); PeerSocket.instances=[];
  vi.stubEnv('NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED','true'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://fixture.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','fixture-publishable-key');
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible'); vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
  vi.stubGlobal('WebSocket',PeerSocket); setRealtimeActor('user_staff');
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
    topic:'123dzo:role:staff',actorId:'user_staff',token:'fixture-scoped-jwt',expiresAt:Date.now()+120000,
  }))));
  const changed=vi.fn(); dispose=subscribeInvalidations({kind:'staff',actor:'user_staff'},changed);
  await vi.advanceTimersByTimeAsync(500);
  expect(PeerSocket.instances).toHaveLength(1);
  const socket=PeerSocket.instances[0], join=socket.frames.find(frame => frame[3]==='phx_join');
  expect(join).toBeDefined(); expect(join?.[2]).toBe('realtime:123dzo:role:staff');
  expect(join?.[4]).toMatchObject({access_token:'fixture-scoped-jwt',config:{private:true}});
  expect(JSON.stringify(join)).not.toContain('postgres_changes_options');
  changed.mockClear(); socket.invalidate('realtime:123dzo:role:staff'); await vi.advanceTimersByTimeAsync(250);
  expect(changed).toHaveBeenCalledOnce(); dispose(); await vi.advanceTimersByTimeAsync(500);
  expect(socket.readyState).toBe(3);
  // Installed SDK socketAdapter.disconnect retains a bounded10s timeout even
  // after resolving its close promise. It must expire, with no reconnect.
  expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  await vi.advanceTimersByTimeAsync(10000);
  expect(vi.getTimerCount()).toBe(0); expect(PeerSocket.instances).toHaveLength(1);
});
