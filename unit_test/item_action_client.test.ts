import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {pendingItemAction,submitItemAction,acknowledgeItemAction} from '@/lib/item-actions/client';
import {journal,operationId,item,result} from './item_action_fixtures';
const actor='user_kitchen',key=`123dzo-pending-item-action:${actor}`;
function response(data:unknown){return new Response(JSON.stringify({data}));}
describe('Item action persistent recovery',()=>{
  const fetchMock=vi.fn();
  beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);});
  afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
  it('saves before POST and requires acknowledgement after confirmation',async()=>{
    fetchMock.mockImplementation(async()=>{expect(pendingItemAction(actor)).toEqual(journal);return response(result);});expect(await submitItemAction(actor,journal)).toEqual(result);expect(pendingItemAction(actor)).toEqual(journal);acknowledgeItemAction(actor,operationId);expect(pendingItemAction(actor)).toBeNull();
  });
  it('recovers unknown outcome via GET without another mutation',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('lost'));await expect(submitItemAction(actor,journal)).rejects.toMatchObject({code:'ITEM_ACTION_UNCONFIRMED'});
    fetchMock.mockResolvedValueOnce(response(result));await submitItemAction(actor);expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
  });
  it('resubmits the original frozen batch only after no-commit lookup',async()=>{
    localStorage.setItem(key,JSON.stringify(journal));fetchMock.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response(result));await submitItemAction(actor,{...journal,items:[{...item,expectedQuantity:2}]});expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(journal);
  });
  it('clears rolled-back conflict but retains ambiguity or permission failure',async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'ITEM_CHANGED',message:'refresh'}}),{status:409}));await expect(submitItemAction(actor,journal)).rejects.toThrow();expect(pendingItemAction(actor)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'permission'}}),{status:403}));await expect(submitItemAction(actor,journal)).rejects.toThrow();expect(pendingItemAction(actor)).toEqual(journal);
  });
  it('does not create a request without durable storage or valid saved payload',async()=>{
    vi.mocked(localStorage.setItem).mockImplementationOnce(()=>{throw new Error('full');});await expect(submitItemAction(actor,journal)).rejects.toThrow('full');localStorage.setItem(key,'{');await expect(submitItemAction(actor,journal)).rejects.toThrow();expect(fetchMock).not.toHaveBeenCalled();
  });
  it('retains identity if only some requested IDs are returned',async()=>{
    fetchMock.mockResolvedValue(response({...result,items:[{...result.items[0],id:operationId}]}));await expect(submitItemAction(actor,journal)).rejects.toMatchObject({code:'ITEM_ACTION_UNCONFIRMED'});expect(pendingItemAction(actor)).toEqual(journal);
  });
  it('times out while reading the body with no automatic retry or timer leak',async()=>{
    vi.useFakeTimers();fetchMock.mockImplementation(async(_url:string,init:RequestInit)=>({ok:true,json:()=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('Abort'))))}));
    const assertion=expect(submitItemAction(actor,journal)).rejects.toMatchObject({code:'ITEM_ACTION_UNCONFIRMED'});await vi.advanceTimersByTimeAsync(15000);await assertion;expect(pendingItemAction(actor)).toEqual(journal);expect(vi.getTimerCount()).toBe(0);
  });
});
