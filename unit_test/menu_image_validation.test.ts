// @vitest-environment node
import {beforeAll,describe,expect,it,vi} from 'vitest';
import sharp from 'sharp';
vi.mock('server-only',()=>({}));
import {readMenuImage} from '@/lib/menu-images/validate';
let valid:Buffer;
function request(bytes:Buffer,type='image/webp'){return new Request('https://app.test/api/admin/menu-images',{method:'POST',headers:{'content-type':type},body:new Uint8Array(bytes)});}
function padded(size:number){const buffer=Buffer.alloc(size);valid.copy(buffer);buffer.write('JUNK',valid.length);buffer.writeUInt32LE(size-valid.length-8,valid.length+4);buffer.writeUInt32LE(size-8,4);return buffer;}
beforeAll(async()=>{valid=await sharp({create:{width:2,height:2,channels:3,background:'#ff0000'}}).webp().toBuffer();});
describe('Real WebP decoder and bounded request stream',()=>{
  it('fully decodes real WebP',async()=>expect(await readMenuImage(request(valid))).toEqual(valid));
  it('accepts a real decodable even-length RIFF at81918 bytes',async()=>expect((await readMenuImage(request(padded(81918)))).length).toBe(81918));
  it('lets81919 bytes reach the decoder, which rejects this malformed odd-length RIFF rather than its size',async()=>{
    await expect(readMenuImage(request(padded(81919)))).rejects.toMatchObject({status:400});
  });
  it.each([81920,81921])('rejects %s bytes regardless of dishonest Content-Length',async(size)=>{const req=request(padded(size));req.headers.set('content-length','1');await expect(readMenuImage(req)).rejects.toMatchObject({status:413});});
  it('rejects MIME spoofing, fake RIFF payload and truncated pixels',async()=>{
    await expect(readMenuImage(request(valid,'image/png'))).rejects.toMatchObject({status:415});
    await expect(readMenuImage(request(Buffer.from('fake webp')))).rejects.toMatchObject({status:400});
    const fake=Buffer.alloc(100);fake.write('RIFF');fake.writeUInt32LE(92,4);fake.write('WEBP',8);await expect(readMenuImage(request(fake))).rejects.toMatchObject({status:400});
    const truncated=Buffer.from(valid.subarray(0,valid.length-8));truncated.writeUInt32LE(truncated.length-8,4);await expect(readMenuImage(request(truncated))).rejects.toMatchObject({status:400});
  });
  it('rejects images whose decoded dimensions exceed1024',async()=>{const oversized=await sharp({create:{width:1025,height:2,channels:3,background:'#000'}}).webp().toBuffer();await expect(readMenuImage(request(oversized))).rejects.toMatchObject({status:400});});
});
