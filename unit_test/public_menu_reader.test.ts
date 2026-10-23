// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({client:vi.fn(),from:vi.fn(),select:vi.fn(),order:vi.fn(),limit:vi.fn(),gt:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:mocks.client}));
import {readPublicMenu} from '@/lib/data/public-menu';

describe('Public menu server projection and complete catalog',()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.client.mockReturnValue({from:mocks.from});mocks.from.mockReturnValue({select:mocks.select});mocks.select.mockReturnValue({order:mocks.order});mocks.order.mockReturnValue({limit:mocks.limit});});
 it('uses safe fields only, follows short pages to empty and sorts the complete catalog',async()=>{
  mocks.limit.mockReturnValue({gt:mocks.gt,then:(resolve:(value:unknown)=>void)=>resolve({data:[{id:'a',name:'Zebra'}],error:null})});
  mocks.gt.mockResolvedValueOnce({data:[{id:'b',name:'An'}],error:null}).mockResolvedValueOnce({data:[],error:null});
  expect(await readPublicMenu()).toEqual([{id:'b',name:'An'},{id:'a',name:'Zebra'}]);
  expect(mocks.from).toHaveBeenCalledWith('menu_items');
  expect(mocks.select).toHaveBeenCalledWith('id,name,category,station,price,prep_time_minutes,image_url,is_available');
  expect(mocks.gt.mock.calls).toEqual([['id','a'],['id','b']]);
  expect(mocks.order).toHaveBeenCalledWith('id',{ascending:true});
 });
 it('reports an unavailable catalog instead of returning a successful partial or empty menu',async()=>{
  mocks.limit.mockResolvedValue({data:null,error:{message:'private connection details'}});
  await expect(readPublicMenu()).rejects.toThrow('Không tải được danh sách đầy đủ');
 });
});
