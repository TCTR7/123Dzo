// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {journal,operationId,entityId,item,result,zoneId} from './metadata_fixtures';
import {parseMetadataRequest} from '@/lib/metadata/contracts';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/sync-staff',()=>({getCurrentStaffAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:()=>({rpc:mocks.rpc})}));
import {POST,GET} from '@/app/api/admin/metadata/route';
function post(body:unknown=journal,headers:Record<string,string>={}){return new Request('http://localhost/api/admin/metadata',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',...headers},body:JSON.stringify(body)});}
function lookup(){return new Request(`http://localhost/api/admin/metadata?operationId=${operationId}`);}
describe('Admin metadata API and contracts',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.access.mockResolvedValue({status:'authorized',staff:{userId:'user_admin',role:'admin',isActive:true}});mocks.rpc.mockResolvedValue({data:result,error:null});});
  it('gets actor from guard and projects minimal no-store output',async()=>{
    mocks.rpc.mockResolvedValue({data:{...result,stock_quantity:100,session_token:'secret'},error:null});
    const response=await POST(post());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual({data:result});
    expect(mocks.rpc).toHaveBeenCalledWith('fn_admin_metadata_action',{p_actor_id:'user_admin',p_operation_id:operationId,p_command:{resource:'INGREDIENT',action:'UPDATE',id:entityId,item,expected:journal.expected}});
  });
  it.each([[{status:'unauthenticated'},401],[{status:'forbidden'},403],[{status:'unavailable'},503],
    [{status:'authorized',staff:{userId:'user_staff',role:'staff',isActive:true}},403],
    [{status:'authorized',staff:{userId:'user_kitchen',role:'kitchen',isActive:true}},403]])('denies missing/unavailable/incorrect role',async(access,status)=>{
    mocks.access.mockResolvedValue(access);expect((await POST(post())).status).toBe(status);expect((await GET(lookup())).status).toBe(status);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{...journal,actorId:'user_admin'},{...journal,item:{...item,stock_quantity:0}},{...journal,item:{...item,unit_cost:1}},
    {...journal,item:{...item,created_at:'fake'}},{...journal,item:{...item,min_threshold:-1}},{...journal,item:{...item,min_threshold:0.0001}},
    {...journal,item:{...item,min_threshold:1e13}},{...journal,item:{...item,unit:''}},{...journal,item:{...item,unit:'x'.repeat(31)}},
    {...journal,item:{...item,name:' '}},{...journal,resource:'OTHER'},{...journal,id:'bad'},{...journal,expected:null},
    {...journal,action:'CREATE'},{...journal,action:'DELETE',item:null},
    {...journal,resource:'TABLE',item:{table_number:'T',zone_id:zoneId,status:'AVAILABLE'}},
    {...journal,resource:'ZONE',item:{name:'Z'},expected:{name:'Z',created_at:'fake'}}])('rejects forged business fields and invalid data',async(body)=>{
    expect((await POST(post(body))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('allows narrow resource-specific create/update/delete payloads and decimal thresholds',()=>{
    expect(parseMetadataRequest({...journal,action:'CREATE',expected:null,item:{...item,min_threshold:0.125}})).not.toBeNull();
    expect(parseMetadataRequest({...journal,resource:'ZONE',action:'CREATE',item:{name:'Garden'},expected:null})).not.toBeNull();
    expect(parseMetadataRequest({...journal,resource:'ZONE',action:'DELETE',item:null,expected:{name:'Garden'}})).not.toBeNull();
    expect(parseMetadataRequest({...journal,resource:'TABLE',item:{table_number:'T1',zone_id:zoneId},expected:{table_number:'T0',zone_id:zoneId}})).not.toBeNull();
  });
  it('requires same origin and bounds actual request bytes',async()=>{
    expect((await POST(post(journal,{origin:'https://bad.test'}))).status).toBe(403);
    expect((await POST(post({padding:'x'.repeat(8192)}))).status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([['42501',403,'FORBIDDEN'],['P1601',409,'METADATA_NOT_FOUND'],['P1602',409,'METADATA_CHANGED'],['P1603',409,'INGREDIENT_UNIT_IN_USE'],
    ['P1604',409,'TABLE_IN_USE'],['23503',409,'METADATA_REFERENCED'],['23505',409,'METADATA_EXISTS'],['22023',400,'INVALID_METADATA'],['22000',409,'OPERATION_CONFLICT'],['55P03',503,'METADATA_UNAVAILABLE']])('maps SQL %s without SQL leakage',async(code,status,name)=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code,message:'private SQL'}});const response=await POST(post());expect(response.status).toBe(status);
    const body=await response.json();expect(body.error.code).toBe(name);expect(JSON.stringify(body)).not.toContain('private SQL');
  });
  it('lookup cannot create operations or cross actor scope',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:null});expect(await(await GET(lookup())).json()).toEqual({data:null});
    expect(mocks.rpc).toHaveBeenCalledWith('fn_get_admin_metadata_operation',{p_actor_id:'user_admin',p_operation_id:operationId});
  });
  it('does not confirm mismatched dependency output',async()=>{
    for(const data of [{...result,entityId:operationId},{...result,resource:'ZONE'},{...result,action:'CREATE'},{}, {...result,operationId:entityId}]){
      mocks.rpc.mockResolvedValue({data,error:null});expect((await POST(post())).status).toBe(503);
    }
  });
});
