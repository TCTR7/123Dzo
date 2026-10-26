import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemRow, OrderItemRow, TableSessionRow, TableRow } from '@/types/database.types';
const m=vi.hoisted(()=>({save:vi.fn(),update:vi.fn(),ids:[] as string[],fetch:vi.fn()}));
vi.mock('@clerk/nextjs',()=>({UserButton:()=>null}));
vi.mock('@/components/shared/OnboardingGuideModal',()=>({OnboardingGuideModal:()=>null}));
vi.mock('@/lib/use-app-events',()=>({useAppEvents:()=>({connected:true,alerts:[]})}));
vi.mock('@/lib/supabase/client',()=>({createSupabaseBrowserClient:()=>({from:()=>({update:(payload:unknown)=>{m.update(payload);return {in:(_key:string,ids:string[])=>{m.ids=ids;return {select:m.save};}};}})})}));
import { KitchenKdsBoard } from '@/components/kitchen/KitchenKdsBoard';
import { StaffAndTableManager } from '@/components/admin/StaffAndTableManager';
let root:Root,container:HTMLDivElement;
const orders=[
{id:'a',session_id:'s1',menu_item_id:'food1',station:'KITCHEN',status:'QUEUED',quantity:1,note:'Không cay',created_at:'2026-10-26T01:00:00Z'},
{id:'b',session_id:'s2',menu_item_id:'food2',station:'KITCHEN',status:'QUEUED',quantity:2,note:'',created_at:'2026-10-26T02:00:00Z'},
{id:'c',session_id:'s2',menu_item_id:'food1',station:'KITCHEN',status:'QUEUED',quantity:3,note:'Ít muối',created_at:'2026-10-26T03:00:00Z'},
{id:'unpaid',session_id:'s3',menu_item_id:'food1',station:'KITCHEN',status:'QUEUED',quantity:1,created_at:'2026-10-26T00:00:00Z'},
] as OrderItemRow[];
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);m.save.mockImplementation(async()=>({data:m.ids.map(id=>({...orders.find(o=>o.id===id),status:'READY'})),error:null}));vi.stubGlobal('fetch',m.fetch);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
const click=async(e:Element)=>act(async()=>{(e as HTMLButtonElement).click();});
async function kitchen(){await act(async()=>root.render(createElement(KitchenKdsBoard,{
  initialKitchenOrders:orders,
  initialActiveSessions:[{id:'s1',status:'ACTIVE',session_type:'DINE_IN',table_id:'t1'},{id:'s2',status:'ACTIVE',session_type:'TAKEAWAY',customer_name:'An'},{id:'s3',status:'PENDING_PAYMENT',session_type:'TAKEAWAY'}] as TableSessionRow[],
  tables:[{id:'t1',table_number:'Bàn 1'}] as TableRow[],
  initialMenuItems:[{id:'food1',name:'Ếch xào',is_available:true},{id:'food2',name:'Mực nướng',is_available:true}] as MenuItemRow[],
})));}
describe('Simple kitchen interactions',()=>{
  it('shows only paid orders and advances with one completion',async()=>{await kitchen();expect(container.querySelectorAll('article')).toHaveLength(3);await click(container.querySelector('article button')!);expect(m.ids).toEqual(['a']);expect(m.update).toHaveBeenCalledWith(expect.objectContaining({status:'READY'}));expect(container.querySelector('article')?.textContent).toContain('Mực nướng');});
  it('groups duplicates and preserves per-table notes',async()=>{await kitchen();await click(container.querySelector('input[type=checkbox]')!);expect(container.querySelectorAll('article')).toHaveLength(2);const first=container.querySelector('article')!;expect(first.textContent).toContain('Không cay');expect(first.textContent).toContain('Ít muối');await click(Array.from(first.querySelectorAll('button')).find(b=>b.textContent?.includes('Xong tất cả'))!);expect(m.ids).toEqual(['a','c']);});
  it('releases the button after a failure so the cook can retry',async()=>{await kitchen();m.save.mockResolvedValueOnce({data:null,error:{message:'Mất kết nối'}});await click(container.querySelector('article button')!);expect((container.querySelector('article button') as HTMLButtonElement).disabled).toBe(false);expect(container.querySelectorAll('article')).toHaveLength(3);await click(container.querySelector('article button')!);expect(container.querySelectorAll('article')).toHaveLength(2);});
});
describe('Numbered tables',()=>{
  it('allows adding the first table with only its number, without any zone field',async()=>{
    m.fetch.mockResolvedValue(new Response(JSON.stringify({id:'new',table_number:'Bàn 1',status:'AVAILABLE',zone_id:'internal'}),{headers:{'Content-Type':'application/json'}}));
    await act(async()=>root.render(createElement(StaffAndTableManager,{currentStaffRole:'admin',initialTables:[],initialStaff:[],initialActiveSessions:[]})));
    expect(container.textContent).not.toMatch(/khu vực/i);
    await click(Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.trim()==='Thêm bàn')!);
    const input=container.querySelector('input[type=number]') as HTMLInputElement;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'1');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toEqual({table_number:'Bàn 1'});
    expect(container.textContent).toContain('Bàn 1');expect(container.querySelector('[role=dialog]')).toBeNull();
  });
});
