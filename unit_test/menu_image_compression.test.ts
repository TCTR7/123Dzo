import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({compress:vi.fn(),decode:vi.fn(),close:vi.fn()}));
vi.mock('browser-image-compression',()=>({default:mocks.compress}));
import {compressMenuImageToWebP} from '@/lib/utils';
function blob(size:number,type='image/webp'){return new Blob([new Uint8Array(size)],{type});}
const original=()=>new File([new Uint8Array(100000)],'menu.png',{type:'image/png'});
describe('Image compression boundaries and decoded dimensions',()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('createImageBitmap',mocks.decode);mocks.decode.mockResolvedValue({width:640,height:480,close:mocks.close});mocks.compress.mockResolvedValue(blob(81919));});
  afterEach(()=>vi.unstubAllGlobals());
  it('accepts81919 bytes and closes decoded source bitmap',async()=>{const file=await compressMenuImageToWebP(original());expect(file.size).toBe(81919);expect(file.type).toBe('image/webp');expect(mocks.close).toHaveBeenCalledOnce();});
  it.each([81920,81921])('recompresses exact/oversized output %s',async(size)=>{mocks.compress.mockResolvedValueOnce(blob(size)).mockResolvedValueOnce(blob(60000));expect((await compressMenuImageToWebP(original())).size).toBe(60000);expect(mocks.compress).toHaveBeenCalledTimes(2);});
  it.each([81920,81921])('rejects if a second pass still returns %s bytes',async(size)=>{mocks.compress.mockResolvedValue(blob(size));await expect(compressMenuImageToWebP(original())).rejects.toThrow('80KB');});
  it('rejects a fake MIME output, empty file, unsupported source and large source before upload',async()=>{
    mocks.compress.mockResolvedValue(blob(100,'image/png'));await expect(compressMenuImageToWebP(original())).rejects.toThrow();
    for(const file of [new File([],'empty.png',{type:'image/png'}),new File(['svg'],'file.svg',{type:'image/svg+xml'}),new File([new Uint8Array(10*1024*1024+1)],'large.jpg',{type:'image/jpeg'})])await expect(compressMenuImageToWebP(file)).rejects.toThrow();
  });
  it('rejects decoder failure and excessive actual dimensions',async()=>{
    mocks.decode.mockRejectedValueOnce(new Error('fake image'));await expect(compressMenuImageToWebP(original())).rejects.toThrow();
    mocks.decode.mockResolvedValueOnce({width:5000,height:1,close:mocks.close});await expect(compressMenuImageToWebP(original())).rejects.toThrow('4096');expect(mocks.compress).not.toHaveBeenCalled();expect(mocks.close).toHaveBeenCalledOnce();
  });
});
