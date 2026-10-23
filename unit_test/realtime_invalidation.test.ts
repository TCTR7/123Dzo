import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(), channel: vi.fn(), on: vi.fn(), subscribe: vi.fn(), remove: vi.fn(), disconnect: vi.fn(), setAuth: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.create }));
import { setRealtimeActor, subscribeInvalidations } from '@/lib/realtime/invalidation';
const actor = 'user_staff', id = '10000000-0000-4000-8000-000000000001';
describe('Private invalidation lifecycle', () => {
  let visible: boolean, online: boolean, dispose: () => void;
  const fetchMock = vi.fn(), refresh = vi.fn();
  let event: (data: { payload: unknown }) => void, status: (status: string) => void;
  const ticket = (changes = {}) => ({ token: 'signed-ticket', topic: '123dzo:role:staff', actorId: actor, expiresAt: Date.now()+120000, ...changes });
  const respond = (value = ticket()) => new Response(JSON.stringify(value));
  const flush = () => vi.advanceTimersByTimeAsync(0);
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); fetchMock.mockReset(); visible = true; online = true; dispose = () => {};
    vi.stubEnv('NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED', 'true'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test-project.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY','test-publishable-key');
    vi.stubGlobal('fetch', fetchMock); setRealtimeActor(actor);
    vi.spyOn(document,'visibilityState','get').mockImplementation(() => visible ? 'visible' : 'hidden');
    vi.spyOn(navigator,'onLine','get').mockImplementation(() => online);
    const channel = { on: mocks.on, subscribe: mocks.subscribe, teardown: vi.fn() };
    mocks.on.mockImplementation((_type, _filter, cb) => { event=cb; return channel; });
    mocks.subscribe.mockImplementation(cb => { status=cb; return channel; });
    mocks.channel.mockReturnValue(channel); mocks.remove.mockResolvedValue('ok');
    mocks.setAuth.mockResolvedValue(undefined);
    mocks.disconnect.mockResolvedValue('ok');
    mocks.create.mockReturnValue({ channel: mocks.channel, removeChannel: mocks.remove, realtime: { disconnect: mocks.disconnect, setAuth: mocks.setAuth } });
    fetchMock.mockImplementation(async () => respond());
  });
  afterEach(() => { dispose(); setRealtimeActor(null); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const mount = async () => { dispose = subscribeInvalidations({ kind:'staff',actor },refresh); await flush(); };
  it('does not connect when disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED','false'); await mount(); expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('uses one private broadcast-only client, no auth persistence; reconnect triggers refetch', async () => {
    await mount(); expect(fetchMock).toHaveBeenCalledWith('/api/staff/realtime-ticket',expect.objectContaining({ method:'POST',cache:'no-store' }));
    expect(mocks.channel).toHaveBeenCalledWith('123dzo:role:staff',expect.objectContaining({config:expect.objectContaining({private:true,presence:{enabled:false}})}));
    expect(mocks.on).toHaveBeenCalledWith('broadcast',{event:'invalidate'},expect.any(Function));
    const options = mocks.create.mock.calls[0][2] as { accessToken: () => Promise<string>; auth: object };
    expect(options.auth).toMatchObject({persistSession:false,autoRefreshToken:false}); expect(await options.accessToken()).toBe('signed-ticket');
    status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(250); expect(refresh).toHaveBeenCalledOnce();
  });
  it('coalesces duplicates, out-of-order IDs and a burst; never applies event rows', async () => {
    await mount(); event({payload:{v:1,id}}); event({payload:{v:1,id}});
    event({payload:{v:1,id:'10000000-0000-4000-8000-000000000002'}});
    event({payload:{v:2,id:'bad',status:'CLOSED'}});
    await vi.advanceTimersByTimeAsync(250); expect(refresh).toHaveBeenCalledOnce();
    event({payload:{v:1,id}}); await vi.advanceTimersByTimeAsync(250); expect(refresh).toHaveBeenCalledOnce();
  });
  it('removes channel, disconnects socket and cancels every timer on unmount', async () => {
    await mount(); event({payload:{v:1,id}}); dispose();
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(200000); expect(fetchMock).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
  });
  it('pauses hidden/offline, ignores late old callbacks and rejoins once on resume', async () => {
    await mount(); const stale = event; visible=false; document.dispatchEvent(new Event('visibilitychange'));
    expect(mocks.remove).toHaveBeenCalledOnce(); stale({payload:{v:1,id}}); await vi.advanceTimersByTimeAsync(250); expect(refresh).not.toHaveBeenCalled();
    visible=true; online=false; document.dispatchEvent(new Event('visibilitychange')); expect(fetchMock).toHaveBeenCalledOnce();
    online=true; window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('online')); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(mocks.channel).toHaveBeenCalledTimes(2);
  });
  it('aborts an unresolved ticket and never opens a socket for a late result', async () => {
    let resolve!: (value: Response) => void; fetchMock.mockReturnValue(new Promise<Response>(done => { resolve=done; }));
    await mount(); const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    dispose(); resolve(respond()); await flush(); expect(signal?.aborted).toBe(true); expect(mocks.create).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('renews through fresh authorization and removes the old socket even when renewal fails', async () => {
    await mount(); const options = mocks.create.mock.calls[0][2] as { accessToken: () => Promise<string> };
    fetchMock.mockResolvedValue(new Response('{}',{status:503})); await vi.advanceTimersByTimeAsync(90000);
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.disconnect).toHaveBeenCalledOnce(); expect(mocks.create).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(31000); await expect(options.accessToken()).rejects.toThrow('TICKET_EXPIRED');
  });
  it('immediately closes on account change and rejects a ticket issued to another user', async () => {
    await mount(); setRealtimeActor('user_other'); expect(mocks.remove).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30000); expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValue(respond(ticket({actorId:'user_other'}))); setRealtimeActor(actor); await flush(); expect(mocks.create).toHaveBeenCalledOnce();
  });
  it.each([401,403,404])('stops automatic ticket retries on %s and asks the protected read to recheck', async code => {
    fetchMock.mockResolvedValue(new Response('{}',{status:code})); await mount(); await vi.advanceTimersByTimeAsync(120000);
    expect(mocks.create).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  });
  it('cleans a failed join and retries with a new authorization request', async () => {
    await mount(); status('CHANNEL_ERROR'); expect(mocks.remove).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(mocks.channel).toHaveBeenCalledTimes(2);
  });
  it('sends the guest capability in a header, never a topic/url parameter', async () => {
    fetchMock.mockResolvedValue(respond(ticket({topic:`123dzo:session:${id}`,actorId:id})));
    dispose=subscribeInvalidations({kind:'session',token:'secret-capability'},refresh); await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/customer/realtime-ticket',expect.objectContaining({headers:{'x-session-token':'secret-capability'}}));
    expect(mocks.channel).toHaveBeenCalledWith(`123dzo:session:${id}`,expect.any(Object));
  });
});
