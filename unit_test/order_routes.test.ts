// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {sessionId,operationId,line,result} from './order_fixtures';
const mocks=vi.hoisted(()=>({access:vi.fn(),client:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/sync-staff',()=>({getCurrentStaffAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
import {POST as customerPOST} from '@/app/api/customer/orders/route';
import {GET as customerGET} from '@/app/api/customer/operation/route';
import {POST as staffPOST} from '@/app/api/staff/orders/route';
import {GET as staffGET} from '@/app/api/staff/operation/route';
const body={sessionId,operationId,lines:[line]};
function request(mode='customer',data:unknown=body,headers:Record<string,string>={}) {
  return new Request(`http://localhost/api/${mode}/orders`,{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost','x-session-token':'test-capability',...headers},body:JSON.stringify(data)});
}
function lookup(mode='customer') {
  return new Request(`http://localhost/api/${mode}/operation?sessionId=${sessionId}&operationId=${operationId}`,{headers:{'x-session-token':'test-capability'}});
}
describe('Order route auth and contracts',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    mocks.access.mockResolvedValue({status:'authorized',staff:{userId:'user_staff',role:'staff',isActive:true}});
    mocks.client.mockReturnValue({rpc:mocks.rpc});
    mocks.rpc.mockResolvedValue({data:result,error:null});
  });
  it('guest uses capability without Clerk and strips internal fields',async()=>{
    mocks.rpc.mockResolvedValue({data:{...result,items:[{...result.items[0],unit_cost_price:40,served_by_staff_id:'private-user'}]},error:null});
    const response=await customerPOST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('fn_submit_dine_in_order',{
      p_session_id:sessionId,p_session_token:'test-capability',p_actor_id:null,p_operation_id:operationId,p_lines:[line],
    });
    expect(JSON.stringify(await response.json())).not.toContain('unit_cost_price');
  });
  it('staff actor comes from guard, not body/token',async()=>{
    expect((await staffPOST(request('staff'))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('fn_submit_dine_in_order',expect.objectContaining({p_actor_id:'user_staff',p_session_token:null}));
  });
  it.each([
    [{status:'unauthenticated'},401], [{status:'forbidden'},403], [{status:'unavailable'},503],
    [{status:'authorized',staff:{userId:'user_kitchen',role:'kitchen',isActive:true}},403],
  ])('denies unauthorized staff',async(access,status)=>{
    mocks.access.mockResolvedValue(access);
    expect((await staffPOST(request('staff'))).status).toBe(status);
    expect((await staffGET(lookup('staff'))).status).toBe(status);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('rejects missing capability or cross-origin JSON',async()=>{
    expect((await customerPOST(request('customer',body,{'x-session-token':''}))).status).toBe(403);
    expect((await customerPOST(request('customer',body,{origin:'https://attacker.test'}))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {...body,actor:'user_admin'}, {...body,lines:[{...line,status:'READY'}]}, {...body,lines:[{...line,unit_price:1}]},
    {...body,lines:[{...line,quantity:1.5}]}, {...body,lines:[{...line,quantity:0}]}, {...body,lines:[]},
  ])('rejects invalid fields',async(input)=>{
    expect((await customerPOST(request('customer',input))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('lookup returns null without creating order',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:null});
    expect(await (await customerGET(lookup())).json()).toEqual({data:null});
    expect(mocks.rpc).toHaveBeenCalledWith('fn_get_dine_in_operation',expect.objectContaining({p_session_id:sessionId}));
  });
  it.each([
    ['P1001',409,'SESSION_NOT_ACTIVE'],['P1002',409,'MENU_UNAVAILABLE'],['P1004',409,'OUT_OF_STOCK'],
    ['P1005',422,'INVENTORY_MAPPING_INVALID'],['P1006',429,'ORDER_RATE_LIMIT'],['22000',409,'OPERATION_CONFLICT'],
    ['42501',403,'FORBIDDEN'],['P0002',404,'SESSION_NOT_FOUND'],['XX000',503,'ORDER_UNAVAILABLE'],
  ])('maps DB %s without SQL detail',async(code,status,expectedCode)=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code,message:'private SQL detail'}});
    const response=await customerPOST(request());
    expect(response.status).toBe(status);
    const payload=await response.json();
    expect(payload.error.code).toBe(expectedCode);
    expect(JSON.stringify(payload)).not.toContain('private SQL detail');
  });
  it('provides safe price quote for review',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code:'P1003',details:JSON.stringify({menuItemId:line.menu_item_id,price:120})}});
    const response=await customerPOST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error:{code:'PRICE_CHANGED',quote:{price:120}}});
  });
  it('rejects malformed and oversized bodies',async()=>{
    expect((await customerPOST(new Request('http://localhost/api/customer/orders',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','x-session-token':'test'},body:'{'}))).status).toBe(400);
    expect((await customerPOST(request('customer',{padding:'x'.repeat(32768)}))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects wrong-session dependency result',async()=>{
    mocks.rpc.mockResolvedValue({data:{...result,sessionId:'10000000-0000-4000-8000-000000000002'},error:null});
    expect((await customerPOST(request())).status).toBe(503);
  });
});
