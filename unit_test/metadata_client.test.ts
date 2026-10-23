import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingMetadata, submitMetadata, acknowledgeMetadata } from '@/lib/metadata/client';
import { journal, operationId, result, item } from './metadata_fixtures';
const actor = 'user_admin', key = `123dzo-pending-metadata:${actor}`;
function response(data: unknown) { return new Response(JSON.stringify({ data })); }
describe('Menu durable recovery', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); vi.spyOn(crypto, 'randomUUID').mockReturnValue(operationId); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it('persists before POST and only acknowledges confirmed identity', async () => {
    fetchMock.mockImplementation(async () => { expect(pendingMetadata(actor)).toEqual(journal); return response(result); });
    expect(await submitMetadata(actor, journal)).toEqual(result); expect(pendingMetadata(actor)).toEqual(journal);
    acknowledgeMetadata(actor, operationId); expect(pendingMetadata(actor)).toBeNull();
  });
  it('recovers unknown outcome through GET without a second mutation', async () => {
    fetchMock.mockRejectedValueOnce(new Error('lost')); await expect(submitMetadata(actor, journal)).rejects.toMatchObject({ code: 'METADATA_UNCONFIRMED' });
    fetchMock.mockResolvedValueOnce(response(result)); await submitMetadata(actor); expect(fetchMock).toHaveBeenCalledTimes(2); expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
  });
  it('retries the frozen CREATE id and metadata only after a null lookup', async () => {
    const saved = { ...journal, action: 'CREATE', item, expected: null };
    localStorage.setItem(key, JSON.stringify(saved)); fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response({ ...result, action: 'CREATE' }));
    await submitMetadata(actor, journal); expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(saved);
  });
  it('clears only known POST rollbacks and retains GET errors or lost permission', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'METADATA_CHANGED', message: 'refresh' } }), { status: 409 }));
    await expect(submitMetadata(actor, journal)).rejects.toThrow(); expect(pendingMetadata(actor)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'permission' } }), { status: 403 }));
    await expect(submitMetadata(actor, journal)).rejects.toThrow(); expect(pendingMetadata(actor)).toEqual(journal);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'METADATA_CHANGED', message: 'ambiguous' } }), { status: 409 }));
    await expect(submitMetadata(actor)).rejects.toThrow(); expect(pendingMetadata(actor)).toEqual(journal);
  });
  it('does not send without durable storage or with a corrupt saved request', async () => {
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => { throw new Error('full'); }); await expect(submitMetadata(actor, journal)).rejects.toThrow('full');
    localStorage.setItem(key, '{'); await expect(submitMetadata(actor, journal)).rejects.toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects mismatched results and keeps the original key', async () => {
    fetchMock.mockResolvedValue(response({ ...result, entityId: operationId })); await expect(submitMetadata(actor, journal)).rejects.toMatchObject({ code: 'METADATA_UNCONFIRMED' });
    expect(pendingMetadata(actor)).toEqual(journal);
  });
  it('bounds a hanging response body with no automatic retry or timer leak', async () => {
    vi.useFakeTimers(); fetchMock.mockImplementation(async (_url: string, init: RequestInit) => ({ ok: true, json: () => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Abort')))) }));
    const assertion = expect(submitMetadata(actor, journal)).rejects.toMatchObject({ code: 'METADATA_UNCONFIRMED' });
    await vi.advanceTimersByTimeAsync(15000); await assertion; expect(pendingMetadata(actor)).toEqual(journal); expect(vi.getTimerCount()).toBe(0);
  });
});
