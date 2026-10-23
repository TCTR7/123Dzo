import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acknowledgeInventory, pendingInventory, submitInventory } from '@/lib/inventory/client';
import { input, journal, operationId, result } from './inventory_fixtures';
const actor = 'user_admin';
const key = `123dzo-pending-inventory:${actor}`;
function response(data: unknown) { return new Response(JSON.stringify({ data })); }
describe('Inventory persistent retry identity', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('persists before POST and only caller acknowledges confirmed result', async () => {
    fetchMock.mockImplementation(async () => { expect(pendingInventory(actor)).toEqual(journal); return response(result); });
    expect(await submitInventory(actor, input)).toEqual(result);
    expect(pendingInventory(actor)).toEqual(journal);
    acknowledgeInventory(actor, operationId);
    expect(pendingInventory(actor)).toBeNull();
  });
  it('recovers lost response via GET without a duplicate POST', async () => {
    fetchMock.mockRejectedValueOnce(new Error('lost'));
    await expect(submitInventory(actor, input)).rejects.toMatchObject({ code: 'INVENTORY_UNCONFIRMED' });
    fetchMock.mockResolvedValueOnce(response(result));
    expect(await submitInventory(actor, { ...input, quantity: 9 })).toEqual(result);
    expect(fetchMock.mock.calls[1][0]).toContain('?operationId=');
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('reuses exact journal only after lookup says not committed', async () => {
    localStorage.setItem(key, JSON.stringify(journal));
    fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(result));
    await submitInventory(actor, { ...input, quantity: 9 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(journal);
  });
  it.each([503, 409])('retains ambiguous server/conflict outcome %s', async (status) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: status === 409 ? 'OPERATION_CONFLICT' : 'OUT_OF_STOCK', message: 'Check previous' } }), { status }));
    await expect(submitInventory(actor, input)).rejects.toThrow('Check previous');
    expect(pendingInventory(actor)).toEqual(journal);
  });
  it('clears only confirmed business rejection, not a lookup rejection', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'OUT_OF_STOCK', message: 'Not enough' } }), { status: 409 }));
    await expect(submitInventory(actor, input)).rejects.toThrow();
    expect(pendingInventory(actor)).toBeNull();
    localStorage.setItem(key, JSON.stringify(journal));
    await expect(submitInventory(actor)).rejects.toThrow();
    expect(pendingInventory(actor)).toEqual(journal);
  });
  it('cannot write a new journal when storage is unavailable or corrupted', async () => {
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('full'); });
    await expect(submitInventory(actor, input)).rejects.toThrow('full');
    localStorage.setItem(key, '{');
    await expect(submitInventory(actor, input)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not mix actors or accept mismatched dependency results', async () => {
    localStorage.setItem(key, JSON.stringify(journal));
    expect(pendingInventory('user_other')).toBeNull();
    fetchMock.mockResolvedValue(response({ ...result, ingredientId: operationId }));
    await expect(submitInventory(actor)).rejects.toMatchObject({ code: 'INVENTORY_UNCONFIRMED' });
    expect(pendingInventory(actor)).toEqual(journal);
  });
  it('times out across response body parsing without dropping the key', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({ ok: true, json: () => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('Abort')));
    }) }));
    const assertion = expect(submitInventory(actor, input)).rejects.toMatchObject({ code: 'INVENTORY_UNCONFIRMED' });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(pendingInventory(actor)).toEqual(journal);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
