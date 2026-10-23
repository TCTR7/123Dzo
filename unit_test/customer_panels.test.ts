import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {MenuCatalog} from '@/components/customer/MenuCatalog';
import {OrderProgress} from '@/components/customer/OrderProgress';
import {BillPanel} from '@/components/customer/BillPanel';
import {TakeawayBrowseView} from '@/components/customer/TakeawayBrowseView';
import {customerStoreConfig,recipientInput} from '@/lib/customer/customer-config';
import {useTakeawayCartStore} from '@/lib/store/useCartStore';
import {result,line} from './order_fixtures';
vi.mock('next/link',()=>({default:({children,...props}:{children:unknown})=>createElement('a',props,children as string)}));
const menu={id:line.menu_item_id,name:'A long menu name without an image',category:'FOOD' as const,station:'KITCHEN' as const,price:100,prep_time_minutes:10,image_url:null,is_available:true};
describe('Customer components use plain labels, complete totals and explicit empty/error states',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.unstubAllEnvs();});
 const render=async(node:ReturnType<typeof createElement>)=>act(async()=>root.render(node));
 it('menu exposes a named search and never lets an unavailable dish be added',async()=>{
  const add=vi.fn();await render(createElement(MenuCatalog,{items:[menu,{...menu,id:'soldout',is_available:false}],onAdd:add}));
  const buttons=[...host.querySelectorAll('button')].filter(node=>node.getAttribute('aria-label')?.startsWith('Thêm '));
  expect(buttons[1].disabled).toBe(true);await act(async()=>buttons[0].click());expect(add).toHaveBeenCalledWith(menu);
  expect(host.querySelector('input[type=search]')?.closest('label')?.textContent).toContain('Tìm món');
  await render(createElement(MenuCatalog,{items:[],onAdd:add,error:'Connection unavailable'}));expect(host.querySelector('[role=alert]')?.textContent).toContain('Connection unavailable');expect(host.textContent).not.toContain('Quán chưa có món');
 });
 it('keeps served and cancelled history collapsed, never invents a countdown or serving event',async()=>{
  const source=result.items[0];
  await render(createElement(OrderProgress,{menu:[menu],positions:{[source.id]:2},items:[{...source,status:'COOKING'},{...source,id:'served',status:'SERVED'},{...source,id:'cancelled',status:'CANCELLED',cancel_reason:'Customer changed mind'}]}));
  expect(host.querySelectorAll('article')).toHaveLength(1);expect(host.querySelectorAll('details')).toHaveLength(2);
  expect(host.textContent).toContain('Thời gian nấu thường khoảng 10 phút');expect(host.textContent).not.toContain('Sắp ra đĩa');
  await render(createElement(OrderProgress,{menu:[menu],positions:{},items:[{...source,status:'READY'}]}));expect(host.textContent).toContain('chờ nhân viên');expect(host.textContent).not.toContain('đang bưng');
 });
 it('shows the full bill total before optional details, does not rely on an item limit',async()=>{
  const items=Array.from({length:510},(_,i)=>({...result.items[0],id:String(i),quantity:1,unit_price:100}));
  await render(createElement(BillPanel,{items,menu:[menu],total:51000}));expect(host.querySelector('details')?.open).toBe(false);expect(host.querySelectorAll('li')).toHaveLength(510);expect(host.textContent).toContain('51.000');
 });
 it('takeaway preview is browse-only and never creates a session or fake QR',async()=>{
  const request=vi.fn();vi.stubGlobal('fetch',request);useTakeawayCartStore.setState({items:[],sessionToken:null});
  await render(createElement(TakeawayBrowseView,{menu:[menu],store:{name:'123Dzô',address:'',phone:'',hours:'',verified:false}}));
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label^="Thêm "]')!.click());
  const cart=[...host.querySelectorAll('button')].find(node=>node.textContent?.startsWith('Xem giỏ mang về'))!;await act(async()=>cart.click());
  await act(async()=>[...host.querySelectorAll('button')].find(node=>node.textContent==='Xem lại và thông tin nhận')!.click());
  expect([...host.querySelectorAll('button')].find(node=>node.textContent==='Thanh toán chưa mở')?.disabled).toBe(true);expect(request).not.toHaveBeenCalled();expect(host.querySelector('svg')).toBeNull();
 });
});
describe('Verified customer information',()=>{
 afterEach(()=>vi.unstubAllEnvs());
 it('does not show unverified address/contact fields',()=>{
  vi.stubEnv('NEXT_PUBLIC_STORE_INFO_VERIFIED','false');vi.stubEnv('NEXT_PUBLIC_STORE_ADDRESS','Unverified place');expect(customerStoreConfig().address).toBe('');
 });
 it('validates recipient names and Vietnamese mobile formats without deleting input',()=>{
  expect(recipientInput(' An  Nguyen ','+84 912 345 678')).toMatchObject({name:'An Nguyen',phone:'0912345678',nameError:null,phoneError:null});
  expect(recipientInput('A','123').nameError).toBeTruthy();expect(recipientInput('A','123').phoneError).toBeTruthy();
 });
});
