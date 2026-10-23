import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {acknowledgeManualPayment,pendingManualPayment,submitManualPayment} from '@/lib/payments/client';
import {parseManualPaymentRequest,parseManualPaymentStatus,paymentPage} from '@/lib/payments/contracts';
import {command,journal,result,operationId,status} from './manual_payment_fixtures';
const actor='user_staff',key='123dzo-pending-payment:'+actor;
const response=(data:unknown)=>new Response(JSON.stringify({data}));
describe('Manual receipt identity and recovery',()=>{
 const fetchMock=vi.fn();
 beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);});
 afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
 it('persists before POST and only removes after caller acceptance',async()=>{
  fetchMock.mockImplementation(async()=>{expect(pendingManualPayment(actor)).toEqual(journal);return response(result);});
  expect(await submitManualPayment(actor,command)).toEqual(result);expect(pendingManualPayment(actor)).toEqual(journal);
  acknowledgeManualPayment(actor,operationId);expect(pendingManualPayment(actor)).toBeNull();
 });
 it('recovers lost response with GET instead of confirming a second payment',async()=>{
  fetchMock.mockRejectedValueOnce(new Error('lost'));await expect(submitManualPayment(actor,command)).rejects.toMatchObject({code:'PAYMENT_UNCONFIRMED'});
  fetchMock.mockResolvedValueOnce(response(result));expect(await submitManualPayment(actor,{...command,reference:'changed'})).toEqual(result);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
 });
 it('only explicitly retries the frozen command after lookup confirms no result',async()=>{
  localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(result));
  await submitManualPayment(actor,{...command,expectedTotal:200});expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(journal);
 });
 it.each([409,503])('only known 4xx rollback clears the journal: %s',async code=>{
  fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'OUT_OF_STOCK',message:'No stock'}}),{status:code}));
  await expect(submitManualPayment(actor,command)).rejects.toThrow('No stock');expect(pendingManualPayment(actor)).toEqual(code===409?null:journal);
 });
 it('keeps conflict/revoked recovery without reposting',async()=>{
  localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'FORBIDDEN'}}),{status:403}));
  await expect(submitManualPayment(actor)).rejects.toMatchObject({code:'FORBIDDEN'});expect(fetchMock).toHaveBeenCalledOnce();expect(pendingManualPayment(actor)).toEqual(journal);
 });
 it.each([{...result,confirmedBy:'user_other'},{...result,amount:200},{}])('rejects wrong or incomplete receipt and preserves its identity',async data=>{
  fetchMock.mockResolvedValue(response(data));await expect(submitManualPayment(actor,command)).rejects.toMatchObject({code:'PAYMENT_UNCONFIRMED'});
  acknowledgeManualPayment(actor,'90000000-0000-4000-8000-000000000002');expect(pendingManualPayment(actor)).toEqual(journal);
 });
 it('does not send when journal write fails or persisted data is corrupt',async()=>{
  vi.mocked(localStorage.setItem).mockImplementationOnce(()=>{throw new Error('Storage full');});await expect(submitManualPayment(actor,command)).rejects.toThrow('Storage full');
  localStorage.setItem(key,'{');await expect(submitManualPayment(actor,command)).rejects.toThrow();expect(fetchMock).not.toHaveBeenCalled();
 });
 it('does not replace a malformed request or send an unconfirmed/invalid draft',async()=>{
  await expect(submitManualPayment(actor,{...command,expectedTotal:0})).rejects.toThrow();
  localStorage.setItem(key,JSON.stringify({operationId,command:{...command,confirmedReceived:false}}));await expect(submitManualPayment(actor,command)).rejects.toThrow();expect(fetchMock).not.toHaveBeenCalled();
 });
 it('timeout preserves the journal and clears its timer',async()=>{
  vi.useFakeTimers();fetchMock.mockImplementation((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))));
  const assertion=expect(submitManualPayment(actor,command)).rejects.toMatchObject({code:'PAYMENT_UNCONFIRMED'});await vi.advanceTimersByTimeAsync(15000);await assertion;expect(pendingManualPayment(actor)).toEqual(journal);expect(vi.getTimerCount()).toBe(0);
 });
});
describe('Payment contracts',()=>{
 it('normalizes bank references but never accepts spoofed actor or time',()=>{
  expect(parseManualPaymentRequest({...journal,command:{...command,reference:' tcb- 123 '}})).toEqual(journal);
  for(const field of ['actorId','confirmedBy','confirmedAt'])expect(parseManualPaymentRequest({...journal,command:{...command,[field]:'spoofed'}})).toBeNull();
  expect(parseManualPaymentRequest({...journal,command:{...command,paymentMethod:'CASH',reference:''}})?.command.paymentMethod).toBe('CASH');
 });
 it('rejects missing proof, invalid quantities and unsupported methods',()=>{
  for(const change of [{confirmedReceived:false},{reference:' '},{expectedTotal:NaN},{expectedTotal:-1},{paymentMethod:'OTHER'},{reference:'x'.repeat(121)}])expect(parseManualPaymentRequest({...journal,command:{...command,...change}})).toBeNull();
  expect(parseManualPaymentRequest(null)).toBeNull();expect(parseManualPaymentRequest({...journal,command:null})).toBeNull();
 });
 it('projects paged status and strips private extra fields',()=>{
  expect(parseManualPaymentStatus({...status,secret:'private',pending:status.pending.map(row=>({...row,session_token:'private'}))})).toEqual(status);
  expect(parseManualPaymentStatus({...status,pendingHasMore:1})).toBeNull();expect(parseManualPaymentStatus({...status,history:[{...status.history[0],confirmedAt:'bad'}]})).toBeNull();expect(parseManualPaymentStatus({...status,pending:Array(26).fill(status.pending[0])})).toBeNull();
  expect(paymentPage(null)).toBe(1);expect(paymentPage('10000')).toBe(10000);expect(paymentPage('10001')).toBeNull();expect(paymentPage('0')).toBeNull();
 });
});
