import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {uploadMenuImage,cleanupMenuImages} from '@/lib/menu-images/client';
const id='80000000-0000-4000-8000-000000000001',url=`https://project.test/storage/v1/object/public/menu-images/managed/${id}.webp`;
describe('Image API client',()=>{
  const fetchMock=vi.fn();
  beforeEach(()=>{fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);});afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
  it('sends only WebP bytes and upload ID to scoped API',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{id,url}})));const file=new File(['valid-size'],'menu.webp',{type:'image/webp'});
    expect(await uploadMenuImage(file,id)).toEqual({id,url});expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/menu-images');expect(fetchMock.mock.calls[0][1]).toMatchObject({method:'POST',body:file,headers:{'content-type':'image/webp','x-upload-id':id}});
  });
  it.each([81920,81921])('rejects size %s before a network write',async(size)=>{await expect(uploadMenuImage(new File([new Uint8Array(size)],'x.webp',{type:'image/webp'}),id)).rejects.toThrow('80KB');expect(fetchMock).not.toHaveBeenCalled();});
  it('rejects invalid returned image identity and passes a safe API error',async()=>{
    const file=new File(['image'],'x.webp',{type:'image/webp'});fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{id,url:'https://attacker.test/image'}})));
    await expect(uploadMenuImage(file,id)).rejects.toThrow('Chưa xác nhận');fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({error:{message:'Ảnh chưa hợp lệ'}}),{status:400}));await expect(uploadMenuImage(file,id)).rejects.toThrow('Ảnh chưa hợp lệ');
  });
  it('bounds response body time without automatic retries',async()=>{
    vi.useFakeTimers();fetchMock.mockImplementation(async(_url:string,init:RequestInit)=>({ok:true,json:()=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(new Error('Abort'))))}));
    const assertion=expect(uploadMenuImage(new File(['image'],'x.webp',{type:'image/webp'}),id)).rejects.toThrow('Abort');await vi.advanceTimersByTimeAsync(30000);await assertion;expect(fetchMock).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('cleanup does not accept browser supplied paths and checks aggregate result',async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{removed:2,failed:1}})));expect(await cleanupMenuImages()).toEqual({removed:2,failed:1});expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{removed:21,failed:0}})));await expect(cleanupMenuImages()).rejects.toThrow('Chưa xác nhận');
  });
});
