import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {acceptTakeaway,forgetTakeaway,pendingTakeaway,readTakeaway,recoverTakeaway,submitTakeaway,takeawayHistory} from '@/lib/takeaway/client';
import {parseTakeawayRequest,parseTakeawaySnapshot,parseTakeawayCreated} from '@/lib/takeaway/contracts';
import {crc16,transferQr} from '@/lib/takeaway/vietqr';
import {command,result,journal,token,operationId,snapshot} from './takeaway_fixtures';
const key='123dzo-pending-takeaway-v1',historyKey='123dzo-takeaway-capabilities-v1';
const response=(data:unknown)=>new Response(JSON.stringify({data}));
describe('Takeaway persistent capability recovery',()=>{
 const fetchMock=vi.fn();
 beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);});
 afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
 it('creates a secure capability before POST, never puts it in the body or URL',async()=>{
  fetchMock.mockImplementation(async(url:string,init:RequestInit)=>{const pending=pendingTakeaway()!;expect(pending.token).toMatch(/^[a-f0-9]{64}$/);expect(url).not.toContain(pending.token);expect(init.body).not.toContain(pending.token);expect(init.headers).toMatchObject({'x-takeaway-token':pending.token});return response(result);});
  const found=await submitTakeaway(command);expect(pendingTakeaway()).not.toBeNull();acceptTakeaway(found.result,found.journal);expect(pendingTakeaway()).toBeNull();expect(takeawayHistory()).toEqual([found.journal.token]);
 });
 it('focus recovery is read-only, including when no commit was found',async()=>{
  expect(await recoverTakeaway()).toBeNull();expect(fetchMock).not.toHaveBeenCalled();localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValue(response(null));expect(await recoverTakeaway()).toBeNull();expect(fetchMock.mock.calls[0][1].method).toBeUndefined();expect(pendingTakeaway()).toEqual(journal);
 });
 it('recovers a response-lost order without creating again, ignoring changed cart',async()=>{
  localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValue(response(result));const found=await submitTakeaway({...command,customerName:'Changed'});expect(found.journal).toEqual(journal);expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
 });
 it('explicit retry uses the same frozen body only after GET finds no committed result',async()=>{
  localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(result));await submitTakeaway();expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({operationId,command});
 });
 it.each([409,503])('only known rollback 4xx clears the journal (%s)',async status=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'PRICE_CHANGED',message:'Review quote'}}),{status}));await expect(submitTakeaway(command)).rejects.toThrow('Review quote');expect(pendingTakeaway()===null).toBe(status===409);
 });
 it('request throttling never discards an identity that another same-key request may have committed',async()=>{
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'TAKEAWAY_REQUEST_RATE_LIMIT',message:'Wait, then recover'}}),{status:429}));await expect(submitTakeaway(command)).rejects.toMatchObject({code:'TAKEAWAY_REQUEST_RATE_LIMIT'});const pending=pendingTakeaway()!;expect(pending).not.toBeNull();
  fetchMock.mockResolvedValueOnce(response(result));const recovered=await submitTakeaway();expect(recovered.journal.operationId).toBe(pending.operationId);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();expect(fetchMock.mock.calls.filter(call=>call[1].method==='POST')).toHaveLength(1);
 });
 it('keeps network ambiguity and corrupted journal; never submits without persistent storage',async()=>{
  fetchMock.mockRejectedValueOnce(new Error('lost'));await expect(submitTakeaway(command)).rejects.toMatchObject({code:'TAKEAWAY_UNCONFIRMED'});expect(pendingTakeaway()).not.toBeNull();
  localStorage.setItem(key,'{');await expect(submitTakeaway(command)).rejects.toThrow();expect(fetchMock).toHaveBeenCalledOnce();localStorage.removeItem(key);
  vi.mocked(localStorage.setItem).mockImplementationOnce(()=>{throw new Error('full');});await expect(submitTakeaway(command)).rejects.toThrow('full');expect(fetchMock).toHaveBeenCalledOnce();
 });
 it('rejects mismatched operation and malformed snapshots without marking success',async()=>{
  localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValueOnce(response({...result,operationId:'b0000000-0000-4000-8000-000000000002'}));await expect(recoverTakeaway()).rejects.toThrow();expect(pendingTakeaway()).toEqual(journal);
  fetchMock.mockResolvedValueOnce(response({...snapshot,items:[{...snapshot.items[0],unitPrice:NaN}]}));await expect(readTakeaway(token)).rejects.toThrow();
 });
 it('does not drop recovery identity if writing local history fails after commit',async()=>{
  localStorage.setItem(key,JSON.stringify(journal));vi.mocked(localStorage.setItem).mockImplementationOnce(()=>{throw new Error('full');});expect(()=>acceptTakeaway(result,journal)).toThrow('full');expect(pendingTakeaway()).toEqual(journal);
 });
 it('removes only the local reference and bounds history to20 valid unique tokens',()=>{
  localStorage.setItem(historyKey,JSON.stringify([token,'bad',token,...Array.from({length:24},(_,i)=>i.toString(16).padStart(64,'0'))]));expect(takeawayHistory()).toHaveLength(20);forgetTakeaway(token);expect(takeawayHistory()).not.toContain(token);expect(fetchMock).not.toHaveBeenCalled();
 });
 it('aborts/cleans timeout without retrying a mutation or losing the token',async()=>{
  vi.useFakeTimers();fetchMock.mockImplementation((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  const assertion=expect(submitTakeaway(command)).rejects.toMatchObject({code:'TAKEAWAY_UNCONFIRMED'});await vi.advanceTimersByTimeAsync(15000);await assertion;expect(pendingTakeaway()).not.toBeNull();expect(fetchMock).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 });
});
describe('Takeaway strict projections and local QR encoding',()=>{
 it('validates recipient, snapshots and excludes private fields',()=>{
  expect(parseTakeawayRequest({operationId,command:{...command,customerName:' An  Nguyen ',customerPhone:'+84 912 345 678'}})?.command).toMatchObject({customerName:'An Nguyen',customerPhone:'0912345678'});
  for(const field of ['actor','status','unit_price'])expect(parseTakeawayRequest({operationId,command:{...command,[field]:'spoof'}})).toBeNull();
  expect(parseTakeawaySnapshot({...snapshot,customerPhone:'private',unit_cost_price:40})).toEqual(snapshot);expect(parseTakeawayCreated({...result,token:'private'})).toEqual(result);
  expect(parseTakeawaySnapshot({...snapshot,items:[snapshot.items[0],snapshot.items[0]]})).toBeNull();expect(parseTakeawayCreated({...result,totalAmount:0})).toBeNull();
 });
 it('CRC matches the standard check vector and TLV encodes exact account/amount/purpose',()=>{
  expect(crc16('123456789')).toBe('29B1');const qr=transferQr('970407','1234567890',100,result.paymentCode)!;
  expect(qr).toContain('000697040701101234567890');expect(qr).toContain('530370454031005802VN');expect(qr).toContain('0820'+result.paymentCode);expect(qr.slice(-4)).toBe(crc16(qr.slice(0,-4)));
 });
 it.each([['970407','123',100],['bad','1234567890',100],['970407','1234567890',-1],['970407','1234567890',1.5]])('invalid payment fields never produce a QR',(...args)=>{expect(transferQr(String(args[0]),String(args[1]),Number(args[2]),result.paymentCode)).toBeNull();});
});
