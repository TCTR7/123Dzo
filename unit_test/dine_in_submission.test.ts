vi.mock('next/navigation',()=>({useRouter:()=>({refresh:()=>{}})}));
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {sessionId,operationId,line,result} from './order_fixtures';
import type {MenuItemRow,TableSessionRow} from '@/types/database.types';
const mocks=vi.hoisted(()=>({channel:vi.fn(),removeChannel:vi.fn()}));
vi.mock('@/lib/supabase/client',()=>({createSupabaseBrowserClient:()=>mocks}));
import {DineInOrderView} from '@/components/customer/DineInOrderView';
import {useCartStore} from '@/lib/store/useCartStore';

const session:TableSessionRow={id:sessionId,session_token:'test-capability',session_type:'DINE_IN',table_id:null,
  assigned_staff_id:null,customer_name:null,customer_phone:null,status:'ACTIVE',payment_method:null,payment_code:null,
  total_amount:0,activated_at: null, opened_at:'2026-10-22T02:00:00Z',closed_at:null};
const menu:MenuItemRow={id:line.menu_item_id,name:'Test Food',category:'FOOD',station:'KITCHEN',price:100,cost_price:40,
  prep_time_minutes:10,image_url:null,is_available:true,linked_ingredient_id:null};

describe('Dine-in UI uses the production journal/API/cart flow',()=>{
  let container:HTMLDivElement,root:Root;
  const fetchMock=vi.fn();
  async function mount(initialSession = session){
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    await act(async()=>root.render(createElement(DineInOrderView,{
      initialSession,table:null,zone:null,initialMenuItems:[menu],initialSessionOrders:[],initialQueuePositions:{},
    })));
  }
  beforeEach(async()=>{
    vi.clearAllMocks();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);
    mocks.channel.mockImplementation(()=>{const channel={on:vi.fn(),subscribe:vi.fn()};channel.on.mockReturnValue(channel);channel.subscribe.mockReturnValue(channel);return channel;});
    useCartStore.setState({sessionToken:session.session_token,items:[],acceptedOperationIds:[],submissionTimestamps:[]});
    useCartStore.getState().addItem({menu_item_id:menu.id,name:menu.name,category:menu.category,station:menu.station,
      unit_price:100,image_url:null,note:line.note});
    await mount();
  });
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
  function button(text:string):HTMLButtonElement {
    const element=[...container.querySelectorAll('button')].find((item)=>item.textContent?.includes(text));
    if (!element) throw new Error(`Missing button ${text}`);return element;
  }
  async function openCart(){await act(async()=>button('Giỏ hàng đã chọn').click());}

  it('does not reopen ordering when a delayed snapshot still says ACTIVE after REQUEST_BILL', async () => {
    await act(async () => root.unmount()); container.remove(); vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { session: { id: session.id, status: 'ACTIVE', payment_method: null },
      table: null, zone: null, menu: [menu], items: [], queuePositions: {} } })));
    await mount({ ...session, status: 'REQUEST_BILL' });
    expect(button('Thêm').disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetchMock).toHaveBeenCalledOnce(); expect(button('Thêm').disabled).toBe(true);
  });

  it('double click sends one API request and clears accepted cart only after confirmation',async()=>{
    let resolve!:(value:Response)=>void;
    fetchMock.mockReturnValue(new Promise<Response>((done)=>{resolve=done;}));
    await openCart();
    const submit=button('Xác nhận Đặt món ngay');
    act(()=>{submit.click();submit.click();});
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    await act(async()=>{resolve(new Response(JSON.stringify({data:result})));});
    expect(useCartStore.getState().items).toHaveLength(0);
    expect(container.textContent).toContain('Quán đã nhận lượt gọi món');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/customer/orders');
  });

  it('reload after response loss restores pending and performs GET recovery, never a second POST',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('Response lost'));
    await openCart();await act(async()=>button('Xác nhận Đặt món ngay').click());
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    await act(async()=>root.unmount());container.remove();
    await mount();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:result})));
    await act(async()=>button('Kiểm tra lượt vừa gửi').click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('/api/customer/operation?');
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
    expect(useCartStore.getState().items).toHaveLength(0);
  });

  it('price rejection updates the quote for explicit review and does not clear or auto-submit the cart',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'PRICE_CHANGED',message:'Giá đã đổi, vui lòng xem lại.',quote:{menuItemId:menu.id,price:120}}}),{status:409}));
    await openCart();await act(async()=>button('Xác nhận Đặt món ngay').click());
    expect(useCartStore.getState().items[0].unit_price).toBe(120);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
    expect(container.querySelector('fieldset')?.disabled).toBe(false);
    expect(container.textContent).toContain('Giá đã đổi');expect(fetchMock).toHaveBeenCalledOnce();
  });
});
