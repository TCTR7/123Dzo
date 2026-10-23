import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitSessionAction, pendingSessionAction, acknowledgeSessionAction } from '@/lib/sessions/client';
import { open, bill, operationId, result, sessionId } from './session_action_fixtures';
const scope = { mode: 'staff' as const, identity: 'user_staff' };
const key = '123dzo-pending-session:staff:user_staff';
function response(data: unknown) { return new Response(JSON.stringify({ data })); }
describe('Session action durable journal', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('persists before POST, waits for caller acknowledgement', async () => {
    fetchMock.mockImplementation(async () => { expect(pendingSessionAction(scope)).toEqual(open); return response(result); });
    expect((await submitSessionAction(scope, open)).result).toEqual(result); expect(pendingSessionAction(scope)).toEqual(open);
    acknowledgeSessionAction(scope, operationId); expect(pendingSessionAction(scope)).toBeNull();
  });
  it('recovers unknown OPEN by GET without creating a second session', async () => {
    fetchMock.mockRejectedValueOnce(new Error('lost')); await expect(submitSessionAction(scope, open)).rejects.toMatchObject({ code: 'SESSION_ACTION_UNCONFIRMED' });
    fetchMock.mockResolvedValueOnce(response(result)); await submitSessionAction(scope);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
  });
  it('reuses exact frozen request after GET says no commit', async () => {
    localStorage.setItem(key, JSON.stringify(open)); fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(result));
    await submitSessionAction(scope, bill); expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(open);
  });
  it('clears rolled-back bill conflict and gives the quote for explicit new confirmation', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BILL_CHANGED', message: 'Check total', totalAmount: 51000 } }), { status: 409 }));
    await expect(submitSessionAction(scope, open)).rejects.toMatchObject({ totalAmount: 51000 }); expect(pendingSessionAction(scope)).toBeNull();
  });
  it('retains server ambiguity and prevents storage failure from creating a request', async () => {
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('full'); }); await expect(submitSessionAction(scope, open)).rejects.toThrow('full'); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BILL_CHANGED', message: 'unknown' } }), { status: 503 }));
    await expect(submitSessionAction(scope, open)).rejects.toThrow(); expect(pendingSessionAction(scope)).toEqual(open);
  });
  it('customer sends capability in header only and cannot submit a staff action', async () => {
    const customer = { mode: 'customer' as const, identity: sessionId, token: 'test-capability' };
    await expect(submitSessionAction(customer, open)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response({ ...result, action: 'REQUEST_BILL', status: 'REQUEST_BILL' })); await submitSessionAction(customer, bill);
    expect(fetchMock.mock.calls[0][1].headers['x-session-token']).toBe('test-capability');
    expect(fetchMock.mock.calls[0][1].body).not.toContain('test-capability');
  });
  it('keeps an uncertain close operation after timeout and clears its timer', async () => {
    vi.useFakeTimers();
    const close={operationId,action:'CLOSE' as const,input:{sessionId,paymentMethod:'CASH' as const,expectedTotal:51000,confirmedReceived:true as const}};
    fetchMock.mockImplementation((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
    const assertion=expect(submitSessionAction(scope,close)).rejects.toMatchObject({code:'SESSION_ACTION_UNCONFIRMED'});
    await vi.advanceTimersByTimeAsync(15000);await assertion;
    expect(pendingSessionAction(scope)).toEqual(close);expect(fetchMock).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['{',JSON.stringify({operationId,action:'OPEN',input:{tableId:'corrupt'}})])('refuses to overwrite a corrupted journal: %s',async raw=>{
    localStorage.setItem(key,raw);await expect(submitSessionAction(scope,open)).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe(raw);expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a result for another table and keeps the original identity',async()=>{
    localStorage.setItem(key,JSON.stringify(open));fetchMock.mockResolvedValue(response({...result,tableId:'70000000-0000-4000-8000-000000000002'}));
    await expect(submitSessionAction(scope)).rejects.toMatchObject({code:'SESSION_ACTION_UNCONFIRMED'});
    acknowledgeSessionAction(scope,'90000000-0000-4000-8000-000000000002');expect(pendingSessionAction(scope)).toEqual(open);expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('does not repost a journal when recovery is denied or returns malformed JSON',async()=>{
    localStorage.setItem(key,JSON.stringify(open));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'FORBIDDEN'}}),{status:403}));
    await expect(submitSessionAction(scope)).rejects.toMatchObject({code:'FORBIDDEN'});
    fetchMock.mockResolvedValueOnce(new Response('upstream failure',{status:502}));
    await expect(submitSessionAction(scope)).rejects.toMatchObject({code:'SESSION_ACTION_UNCONFIRMED'});
    expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls.every(call=>call[1].method===undefined)).toBe(true);expect(pendingSessionAction(scope)).toEqual(open);
  });
});
