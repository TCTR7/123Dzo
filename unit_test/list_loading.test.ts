import {describe,expect,it} from 'vitest';
import {readAll,listPage} from '@/lib/data/lists';
describe('List loading boundaries',()=>{
  it.each([undefined,[],['2'],'0','-2','1.5','1e3','1000001','999999999','bad'])('normalizes invalid page %s',value=>expect(listPage(value)).toBe(1));
  it('accepts bounded explicit page',()=>{expect(listPage('2')).toBe(2);expect(listPage('1000000')).toBe(1000000);});
  it('reads beyond1000 even when Data API caps each request to37 rows',async()=>{
    const all=Array.from({length:1007},(_,index)=>({id:String(index).padStart(5,'0')}));const cursors:(string|null)[]=[];
    const result=await readAll(async(after)=>{cursors.push(after);return{data:all.filter(row=>!after||row.id>after).slice(0,37),error:null};});
    expect(result.data).toEqual(all);expect(cursors.length).toBe(29);
  });
  it('throws rather than returning partial rows on network error or broken cursor',async()=>{
    await expect(readAll(async(after)=>after?{data:null,error:{message:'private'}}:{data:[{id:'first'}],error:null})).rejects.toThrow('đầy đủ');
    await expect(readAll(async()=>({data:[{id:'same'}],error:null}))).rejects.toThrow('Thứ tự');
  });
  it('accepts DB collation of mixed-case Clerk IDs without comparing in JavaScript',async()=>{
    let call=0;expect((await readAll(async()=>({data:call++===0?[{id:'user_a'},{id:'user_B'}]:[],error:null}))).data).toHaveLength(2);
  });
  it('bounds pathological scans instead of silently truncating',async()=>{
    let counter=0;await expect(readAll(async()=>({data:[{id:String(++counter)}],error:null}))).rejects.toThrow('phạm vi');expect(counter).toBe(200);
  });
});
