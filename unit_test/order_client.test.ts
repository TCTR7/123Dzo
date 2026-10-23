import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {acknowledgeOrder,pendingOrder,recoverOrder,submitOrder} from '@/lib/orders/client';
import {parseOrderRequest} from '@/lib/orders/contracts';
import {useCartStore} from '@/lib/store/useCartStore';
import {sessionId,operationId,line,result} from './order_fixtures';
const scope={mode:'customer' as const,identity:'table',sessionId,token:'test-capability'};
const key=`123dzo-pending-order:customer:table:${sessionId}`;
const journal={sessionId,operationId,lines:[line]};
function response(data:unknown){return new Response(JSON.stringify({data}));}
describe('Persistent order recovery',()=>{
  const fetchMock=vi.fn();
  beforeEach(()=>{
    fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);
    vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);
    useCartStore.setState({items:[],acceptedOperationIds:[],sessionToken:'test-capability'});
  });
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
  it('persists before POST, keeps journal until caller acknowledges',async()=>{
    fetchMock.mockImplementation(async()=>{expect(pendingOrder(scope)).toEqual(journal);return response(result);});
    expect((await submitOrder(scope,[line])).result).toEqual(result);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pendingOrder(scope)?.operationId).toBe(operationId);
    acknowledgeOrder(scope,operationId);
    expect(pendingOrder(scope)).toBeNull();
  });
  it('foreground recovery has no journal or uncommitted result: never posts',async()=>{
    expect(await recoverOrder(scope)).toBeNull();expect(fetchMock).not.toHaveBeenCalled();
    localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValueOnce(response(null));
    expect(await recoverOrder(scope)).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();expect(pendingOrder(scope)).toEqual(journal);
  });
  it('foreground recovery returns only the exact operation and snapshot',async()=>{
    localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValueOnce(response(result));
    expect(await recoverOrder(scope)).toEqual({result,submittedLines:journal.lines});
    expect(fetchMock.mock.calls[0][1].headers).toEqual({'x-session-token':'test-capability'});
    fetchMock.mockResolvedValueOnce(response({...result,operationId:crypto.randomUUID().replace(/.$/,'2')}));
    await expect(recoverOrder(scope)).rejects.toThrow('RECOVERY_UNAVAILABLE');expect(pendingOrder(scope)).toEqual(journal);
  });
  it('recovers after response loss without another POST',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('Response lost'));
    await expect(submitOrder(scope,[line])).rejects.toThrow('Chưa xác nhận');
    fetchMock.mockResolvedValueOnce(response(result));
    const recovered=await submitOrder(scope,[{...line,quantity:9}]);
    expect(recovered.submittedLines).toEqual([line]);expect(recovered.recovered).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toContain('/operation?');
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('resends same key/snapshot only after lookup confirms no commit',async()=>{
    localStorage.setItem(key,JSON.stringify(journal));
    fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(result));
    await submitOrder(scope,[{...line,note:'changed draft'}]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(journal);
  });
  it('retains pending after transient server failure',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'ORDER_UNAVAILABLE',message:'Check previous order'}}),{status:503}));
    await expect(submitOrder(scope,[line])).rejects.toThrow('Check previous order');
    expect(pendingOrder(scope)).toEqual(journal);
  });
  it('clears known business rejection for quote review',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'PRICE_CHANGED',message:'Review price',quote:{menuItemId:line.menu_item_id,price:120}}}),{status:409}));
    await expect(submitOrder(scope,[line])).rejects.toMatchObject({code:'PRICE_CHANGED',quote:{price:120}});
    expect(pendingOrder(scope)).toBeNull();
  });
  it('keeps the retry identity when a 5xx response carries a business error code',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'PRICE_CHANGED',message:'Unconfirmed upstream result'}}),{status:503}));
    await expect(submitOrder(scope,[line])).rejects.toMatchObject({status:503});
    expect(pendingOrder(scope)).toEqual(journal);
  });
  it('never reposts after recovery access is denied and preserves its journal',async()=>{
    localStorage.setItem(key,JSON.stringify(journal));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'Access revoked'}}),{status:403}));
    await expect(submitOrder(scope,[line])).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(fetchMock).toHaveBeenCalledOnce();expect(fetchMock.mock.calls[0][1].method).toBeUndefined();expect(pendingOrder(scope)).toEqual(journal);
  });
  it.each([{}, {...result,sessionId:'10000000-0000-4000-8000-000000000002'}])('does not acknowledge a missing or mismatched response',async data=>{
    fetchMock.mockResolvedValue(response(data));
    await expect(submitOrder(scope,[line])).rejects.toMatchObject({code:'ORDER_UNCONFIRMED'});
    acknowledgeOrder(scope,'40000000-0000-4000-8000-000000000002');
    expect(pendingOrder(scope)).toEqual(journal);
  });
  it('aborts foreground recovery on unmount without reposting or losing the identity',async()=>{
    vi.useFakeTimers();localStorage.setItem(key,JSON.stringify(journal));
    const controller=new AbortController();
    fetchMock.mockImplementation((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>{
      init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
    }));
    const pending=recoverOrder(scope,controller.signal);const assertion=expect(pending).rejects.toMatchObject({name:'AbortError'});
    controller.abort();await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();expect(pendingOrder(scope)).toEqual(journal);expect(vi.getTimerCount()).toBe(0);
  });
  it('does not POST if persistent journal write fails',async()=>{
    vi.mocked(localStorage.setItem).mockImplementationOnce(()=>{throw new Error('Storage full');});
    await expect(submitOrder(scope,[line])).rejects.toThrow('Storage full');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not replace corrupted journal',async()=>{
    localStorage.setItem(key,'{');await expect(submitOrder(scope,[line])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reconciles cart once even after persisted state is rehydrated',async()=>{
    useCartStore.getState().addItem({menu_item_id:line.menu_item_id,name:'Food',category:'FOOD',station:'KITCHEN',unit_price:100,image_url:null,quantity:3,note:line.note});
    useCartStore.getState().acceptSubmittedOrder(operationId,[line]);
    expect(useCartStore.getState().items[0].quantity).toBe(2);
    await useCartStore.persist.rehydrate();
    useCartStore.getState().acceptSubmittedOrder(operationId,[line]);
    expect(useCartStore.getState().items[0].quantity).toBe(2);
  });
  it('keeps a different current note or price',()=>{
    useCartStore.getState().addItem({menu_item_id:line.menu_item_id,name:'Food',category:'FOOD',station:'KITCHEN',unit_price:120,image_url:null,quantity:1,note:'other note'});
    useCartStore.getState().acceptSubmittedOrder(operationId,[line]);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
  });
  it('normalizes notes and rejects spoofed fields',()=>{
    expect(parseOrderRequest({...journal,lines:[{...line,note:' less spicy '}]})).toEqual(journal);
    expect(parseOrderRequest({...journal,lines:[{...line,unit_cost_price:0}]})).toBeNull();
  });
  it('times out without losing the operation identity or auto retrying',async()=>{
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url:string,init:RequestInit)=>new Promise((_resolve,reject)=>{
      init.signal?.addEventListener('abort',()=>reject(new Error('Abort')));
    }));
    const pending=submitOrder(scope,[line]);
    const assertion=expect(pending).rejects.toMatchObject({code:'ORDER_UNCONFIRMED'});
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(pendingOrder(scope)).toEqual(journal);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
