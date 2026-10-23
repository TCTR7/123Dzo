// @vitest-environment node
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
const mocks=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),upload:vi.fn(),download:vi.fn(),remove:vi.fn(),from:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/sync-staff',()=>({getCurrentStaffAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:()=>({rpc:mocks.rpc,storage:{from:mocks.from}})}));
import {POST} from '@/app/api/admin/menu-images/route';
import {POST as cleanup} from '@/app/api/admin/menu-images/cleanup/route';
const id='80000000-0000-4000-8000-000000000001',path=`managed/${id}.webp`,url=`https://project.test/storage/v1/object/public/menu-images/${path}`;
const image={id,path,url,state:'UPLOADING'};
let bytes:Buffer;
function post(options:{origin?:string;type?:string;id?:string;bytes?:Buffer}={}){return new Request('https://app.test/api/admin/menu-images',{method:'POST',headers:{origin:options.origin??'https://app.test','content-type':options.type??'image/webp','x-upload-id':options.id??id},body:new Uint8Array(options.bytes??bytes)});}
function clean(){return new Request('https://app.test/api/admin/menu-images/cleanup',{method:'POST',headers:{origin:'https://app.test'}});}
beforeAll(async()=>{bytes=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).webp().toBuffer();});
describe('Authorized image upload and cleanup APIs',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();mocks.access.mockResolvedValue({status:'authorized',staff:{userId:'user_admin',role:'admin',isActive:true}});
    mocks.from.mockReturnValue({upload:mocks.upload,download:mocks.download,remove:mocks.remove,getPublicUrl:()=>({data:{publicUrl:url}})});
    mocks.upload.mockResolvedValue({data:{path},error:null});mocks.remove.mockResolvedValue({data:[],error:null});
    mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>({data:name==='fn_claim_menu_image_cleanup'?[]:name==='fn_finish_menu_image_cleanup'?null:{...image,state:args.p_action==='READY'?'READY':'UPLOADING'},error:null}));
  });
  it('validates real bytes, reserves server hash and writes immutable WebP with no browser credentials',async()=>{
    const response=await POST(post());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual({data:{id,url}});
    expect(mocks.rpc).toHaveBeenNthCalledWith(1,'fn_menu_image_upload',{p_actor_id:'user_admin',p_id:id,p_hash:createHash('sha256').update(bytes).digest('hex'),p_url:url,p_action:'RESERVE'});
    expect(mocks.upload).toHaveBeenCalledWith(path,bytes,{contentType:'image/webp',cacheControl:'31536000',upsert:false});expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each([[{status:'unauthenticated'},401],[{status:'forbidden'},403],[{status:'unavailable'},503],
    [{status:'authorized',staff:{userId:'user_staff',role:'staff',isActive:true}},403],[{status:'authorized',staff:{userId:'user_kitchen',role:'kitchen',isActive:true}},403]])('denies unauthorized upload and cleanup before Storage',async(access,status)=>{
    mocks.access.mockResolvedValue(access);expect((await POST(post())).status).toBe(status);expect((await cleanup(clean())).status).toBe(status);expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects Origin, upload ID and MIME/payload spoof before reservation',async()=>{
    expect((await POST(post({origin:'https://evil.test'}))).status).toBe(403);expect((await POST(post({id:'bad'}))).status).toBe(400);
    expect((await POST(post({type:'image/png'}))).status).toBe(415);expect((await POST(post({bytes:Buffer.from('fake')}))).status).toBe(400);
    expect((await POST(post({bytes:Buffer.alloc(81920)}))).status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('replays a READY reservation without another Storage upload',async()=>{
    mocks.rpc.mockResolvedValue({data:{...image,state:'READY'},error:null});expect((await POST(post())).status).toBe(200);expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.download).not.toHaveBeenCalled();
  });
  it('verifies a duplicate object by actual downloaded hash instead of overwriting',async()=>{
    mocks.upload.mockResolvedValue({error:{statusCode:'409'}});mocks.download.mockResolvedValue({data:new Blob([new Uint8Array(bytes)]),error:null});expect((await POST(post())).status).toBe(200);
    mocks.download.mockResolvedValue({data:new Blob([Buffer.alloc(bytes.length)]),error:null});expect((await POST(post())).status).toBe(503);expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('does not delete an uploaded image on ambiguous DB failure; tombstone permits compensation only',async()=>{
    mocks.rpc.mockImplementation(async(_name:string,args:Record<string,unknown>)=>args.p_action==='READY'?{error:{code:'XX000',message:'secret SQL'}}:{data:image,error:null});
    const failed=await POST(post());expect(failed.status).toBe(503);expect(JSON.stringify(await failed.json())).not.toContain('secret SQL');expect(mocks.remove).not.toHaveBeenCalled();
    mocks.rpc.mockImplementation(async(_name:string,args:Record<string,unknown>)=>args.p_action==='READY'?{error:{code:'P1702'}}:{data:image,error:null});
    expect((await POST(post())).status).toBe(503);expect(mocks.remove).toHaveBeenCalledWith([path]);
  });
  it.each([['42501',403],['P1704',429],['22000',409],['P1702',409],['55P03',503]])('maps reservation errors %s without Storage writes',async(code,status)=>{
    mocks.rpc.mockResolvedValue({error:{code,message:'private SQL'}});const response=await POST(post());expect(response.status).toBe(status);expect(JSON.stringify(await response.json())).not.toContain('private SQL');expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('leaves failed Storage uploads pending with no READY or remove',async()=>{
    mocks.upload.mockResolvedValue({error:{statusCode:'500',message:'private storage'}});expect((await POST(post())).status).toBe(503);expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('cleans only paths returned by DB claim and finishes only after Storage success',async()=>{
    mocks.rpc.mockImplementation(async(name:string)=>({data:name==='fn_claim_menu_image_cleanup'?[{id,path}]:null,error:null}));
    expect(await(await cleanup(clean())).json()).toEqual({data:{removed:1,failed:0}});expect(mocks.remove).toHaveBeenCalledWith([path]);expect(mocks.rpc).toHaveBeenLastCalledWith('fn_finish_menu_image_cleanup',{p_actor_id:'user_admin',p_id:id});
    mocks.rpc.mockClear();mocks.remove.mockResolvedValue({error:{message:'offline'}});expect(await(await cleanup(clean())).json()).toEqual({data:{removed:0,failed:1}});expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects malicious cleanup paths and cross-Origin without removing anything',async()=>{
    mocks.rpc.mockResolvedValue({data:[{id,path:'../other-bucket/important'}],error:null});expect((await cleanup(clean())).status).toBe(503);expect(mocks.remove).not.toHaveBeenCalled();
    const req=clean();req.headers.set('origin','https://evil.test');expect((await cleanup(req)).status).toBe(403);
  });
});
