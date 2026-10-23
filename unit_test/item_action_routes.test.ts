// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {journal,operationId,item,result} from './item_action_fixtures';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/sync-staff',()=>({getCurrentStaffAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:()=>({rpc:mocks.rpc})}));
import {POST,GET} from '@/app/api/staff/item-actions/route';
function post(body:unknown=journal,headers:Record<string,string>={}) {return new Request('http://localhost/api/staff/item-actions',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',...headers},body:JSON.stringify(body)});}
function lookup(){return new Request(`http://localhost/api/staff/item-actions?operationId=${operationId}`);}
describe('Item transition API',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.access.mockResolvedValue({status:'authorized',staff:{userId:'user_kitchen',role:'kitchen',isActive:true}});mocks.rpc.mockResolvedValue({data:result,error:null});});
  it('takes actor from guard, projects result and disables caching',async()=>{
    mocks.rpc.mockResolvedValue({data:{...result,cost_price:10,items:[{...result.items[0],served_by_staff_id:'private'}]},error:null});
    const response=await POST(post());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual({data:result});
    expect(mocks.rpc).toHaveBeenCalledWith('fn_transition_order_items',{p_actor_id:'user_kitchen',p_operation_id:operationId,p_command:{action:'START',items:[item],reason:''}});
  });
  it.each([[{status:'unauthenticated'},401],[{status:'forbidden'},403],[{status:'unavailable'},503]])('denies unauthenticated/unavailable access',async(access,status)=>{
    mocks.access.mockResolvedValue(access);expect((await POST(post())).status).toBe(status);expect((await GET(lookup())).status).toBe(status);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {...journal,actorId:'user_admin'}, {...journal,batchId:operationId}, {...journal,items:[{...item,served_at:'fake'}]},
    {...journal,items:[{...item,expectedQuantity:0}]}, {...journal,items:[{...item,expectedQuantity:1.5}]},
    {...journal,items:[item,item]}, {...journal,items:[]}, {...journal,action:'CANCEL',reason:' '},
    {...journal,reason:'unexpected'}, {...journal,items:Array(101).fill(item)},
  ])('rejects forged fields and invalid batch before DB',async(body)=>{expect((await POST(post(body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
  it('rejects cross Origin and bounds actual body bytes',async()=>{
    expect((await POST(post(journal,{origin:'https://attacker.test'}))).status).toBe(403);
    expect((await POST(post({padding:'x'.repeat(32768)}))).status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([['42501',403,'FORBIDDEN'],['P1401',409,'ITEM_CHANGED'],['P1402',409,'INVALID_TRANSITION'],['P1403',409,'INVALID_ITEM_TIMESTAMPS'],['P1001',409,'SESSION_NOT_ACTIVE'],['22000',409,'OPERATION_CONFLICT'],['55P03',503,'ITEM_ACTION_UNAVAILABLE']])('maps SQL %s safely',async(code,status,name)=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code,message:'private SQL'}});const response=await POST(post());expect(response.status).toBe(status);const body=await response.json();expect(body.error.code).toBe(name);expect(JSON.stringify(body)).not.toContain('private SQL');
  });
  it('lookup cannot create a new action and is actor scoped',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:null});expect(await(await GET(lookup())).json()).toEqual({data:null});expect(mocks.rpc).toHaveBeenCalledWith('fn_get_item_action_operation',{p_actor_id:'user_kitchen',p_operation_id:operationId});
  });
  it('refuses partial/mismatched successful dependency output',async()=>{
    mocks.rpc.mockResolvedValue({data:{...result,items:[]},error:null});expect((await POST(post())).status).toBe(503);
    mocks.rpc.mockResolvedValue({data:{...result,items:[{...result.items[0],fromStatus:'READY'}]},error:null});expect((await POST(post())).status).toBe(503);
  });
});
