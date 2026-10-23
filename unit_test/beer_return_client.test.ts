import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitBeerReturn, pendingBeerReturn, acknowledgeBeerReturn } from '@/lib/returns/client';
import { draft, journal, operationId, result } from './beer_return_fixtures';
const key = '123dzo-pending-return:user_staff';
const actor = 'user_staff';
function response(data: unknown) { return new Response(JSON.stringify({ data })); }
describe('Beer return recovery journal', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('persists before POST, only removes after confirmation is accepted', async () => {
    fetchMock.mockImplementation(async () => { expect(pendingBeerReturn(actor)).toEqual(journal); return response(result); });
    expect(await submitBeerReturn(actor, draft)).toEqual(result); expect(pendingBeerReturn(actor)).toEqual(journal);
    acknowledgeBeerReturn(actor, operationId); expect(pendingBeerReturn(actor)).toBeNull();
  });
  it('recovers lost response by GET, ignores changed draft and never duplicates POST', async () => {
    fetchMock.mockRejectedValueOnce(new Error('lost')); await expect(submitBeerReturn(actor, draft)).rejects.toMatchObject({ code: 'RETURN_UNCONFIRMED' });
    fetchMock.mockResolvedValueOnce(response(result)); expect(await submitBeerReturn(actor, { ...draft, quantity: 2 })).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
  });
  it('resubmits exact original payload only if lookup confirms no commit', async () => {
    localStorage.setItem(key, JSON.stringify(journal)); fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(result));
    await submitBeerReturn(actor, { ...draft, quantity: 2 }); expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(journal);
  });
  it('clears a rolled-back stale quantity to allow explicit new confirmation', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'RETURN_CHANGED', message: 'Reload quantity' } }), { status: 409 }));
    await expect(submitBeerReturn(actor, draft)).rejects.toThrow('Reload quantity'); expect(pendingBeerReturn(actor)).toBeNull();
  });
  it.each([503, 409])('keeps unknown result/conflict journal for status %s', async (status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: status === 409 ? 'OPERATION_CONFLICT' : 'RETURN_CHANGED', message: 'check' } }), { status }));
    await expect(submitBeerReturn(actor, draft)).rejects.toThrow(); expect(pendingBeerReturn(actor)).toEqual(journal);
  });
  it('cannot POST when persistent storage fails or journal is corrupted', async () => {
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('full'); }); await expect(submitBeerReturn(actor, draft)).rejects.toThrow('full');
    localStorage.setItem(key, '{'); await expect(submitBeerReturn(actor, draft)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('times out reading body while retaining the identity and clearing timers', async () => {
    vi.useFakeTimers(); fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('Abort')));
    }) }));
    const assertion = expect(submitBeerReturn(actor, draft)).rejects.toMatchObject({ code: 'RETURN_UNCONFIRMED' });
    await vi.advanceTimersByTimeAsync(15000); await assertion; expect(pendingBeerReturn(actor)).toEqual(journal); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects an inconsistent remaining quantity and never acknowledges another operation',async()=>{
    localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValue(response({...result,remainingQuantity:99}));
    await expect(submitBeerReturn(actor)).rejects.toMatchObject({code:'RETURN_UNCONFIRMED'});
    acknowledgeBeerReturn(actor,'60000000-0000-4000-8000-000000000002');expect(pendingBeerReturn(actor)).toEqual(journal);
  });
  it('keeps a pending return when recovery authorization is revoked, without another POST',async()=>{
    localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'FORBIDDEN'}}),{status:403}));
    await expect(submitBeerReturn(actor)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][1].method).toBeUndefined();expect(pendingBeerReturn(actor)).toEqual(journal);
  });
});
