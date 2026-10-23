import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {operationId,zoneId,entityId,item} from './metadata_fixtures';
import type {IngredientRow,TableRow,ZoneRow} from '@/types/database.types';
const mocks=vi.hoisted(()=>({refresh:vi.fn(),from:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('@/lib/supabase/client',()=>({createSupabaseBrowserClient:()=>({from:mocks.from})}));
import {InventoryManager} from '@/components/admin/InventoryManager';
import {StaffAndTableManager} from '@/components/admin/StaffAndTableManager';
const ingredient:IngredientRow={...item,id:entityId,stock_quantity:10,unit_cost:12};
const zone:ZoneRow={id:zoneId,name:'Garden',created_at:'2026-10-22T02:00:00Z'};
const table:TableRow={id:'70000000-0000-4000-8000-000000000001',table_number:'Table 1',zone_id:zoneId,status:'AVAILABLE',current_session_id:null};
describe('Metadata admin integration with durable journal',()=>{
  let container:HTMLDivElement,root:Root;const fetchMock=vi.fn();
  async function mount(kind:'stock'|'tables'){
    await act(async()=>root.render(kind==='stock'?createElement(InventoryManager,{currentStaffId:'user_admin',initialIngredients:[ingredient],initialLogs:[],staffProfiles:[]}):
      createElement(StaffAndTableManager,{currentAdminId:'user_admin',initialZones:[zone],initialTables:[table],initialStaff:[],initialActiveSessions:[]})));
  }
  function button(text:string){const control=[...container.querySelectorAll('button')].find(node=>node.textContent?.includes(text));if(!control)throw new Error(`Missing ${text}`);return control;}
  function title(text:string){return container.querySelector<HTMLButtonElement>(`button[title="${text}"]`)!;}
  function submit(form:HTMLFormElement){form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
  function input(node:HTMLInputElement,value:string){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));}
  beforeEach(()=>{vi.clearAllMocks();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
  it('ingredient double-submit sends only metadata and never stock or unit cost',async()=>{
    let resolve!:(value:Response)=>void;fetchMock.mockReturnValue(new Promise<Response>(done=>{resolve=done;}));await mount('stock');
    await act(async()=>title('Chỉnh sửa định mức').click());
    act(()=>{submit(container.querySelector('form')!);submit(container.querySelector('form')!);});expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operationId,resource:'INGREDIENT',action:'UPDATE',id:entityId,item,expected:item});
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/metadata');
    await act(async()=>resolve(new Response(JSON.stringify({data:{operationId,resource:'INGREDIENT',action:'UPDATE',entityId}}))));
    expect(mocks.from).not.toHaveBeenCalled();expect(mocks.refresh).toHaveBeenCalledOnce();expect(container.querySelector('form')).toBeNull();
  });
  it('unknown ingredient edit closes modal and blocks stock until explicit GET recovery',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('lost'));await mount('stock');await act(async()=>title('Chỉnh sửa định mức').click());
    await act(async()=>submit(container.querySelector('form')!));expect(container.querySelector('form')).toBeNull();expect(button('Nhập kho / Hủy hỏng').disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{operationId,resource:'INGREDIENT',action:'UPDATE',entityId}})));
    await act(async()=>button('Kiểm tra thay đổi danh mục vừa gửi').click());expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
    expect(localStorage.getItem('123dzo-pending-metadata:user_admin')).toBeNull();
  });
  it('table editor sends name/zone expectation and no lifecycle state',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{operationId,resource:'TABLE',action:'UPDATE',entityId:table.id}})));await mount('tables');
    await act(async()=>title('Sửa bàn').click());await act(async()=>submit(container.querySelectorAll('form')[1]));
    const fields={table_number:table.table_number,zone_id:zoneId};expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operationId,resource:'TABLE',action:'UPDATE',id:table.id,item:fields,expected:fields});
    expect(mocks.from).not.toHaveBeenCalled();expect(container.querySelectorAll('form')).toHaveLength(1);
  });
  it('zone delete rejection leaves referenced tables and shows reason with no direct mutations',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({error:{code:'METADATA_REFERENCED',message:'Khu vực đang có bàn.'}}),{status:409}));await mount('tables');
    await act(async()=>title('Xóa khu vực').click());expect(container.textContent).toContain('Khu vực đang có bàn.');expect(container.textContent).toContain(table.table_number);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({resource:'ZONE',action:'DELETE',id:zoneId,item:null,expected:{name:'Garden'}});expect(mocks.from).not.toHaveBeenCalled();
  });
  it('unknown table edit exposes recovery outside modal and disables further deletes',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('lost'));await mount('tables');await act(async()=>title('Sửa bàn').click());await act(async()=>submit(container.querySelectorAll('form')[1]));
    expect(container.querySelectorAll('form')).toHaveLength(1);expect(title('Xóa khu vực').disabled).toBe(true);expect(title('Xóa bàn').disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{operationId,resource:'TABLE',action:'UPDATE',entityId:table.id}})));
    await act(async()=>button('Kiểm tra thay đổi danh mục vừa gửi').click());expect(fetchMock).toHaveBeenCalledTimes(2);expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
  });
  it('creates a zone only with a nonblank name and clears input after acknowledgment',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{operationId,resource:'ZONE',action:'CREATE',entityId:operationId}})));await mount('tables');
    await act(async()=>submit(container.querySelector('form')!));expect(fetchMock).not.toHaveBeenCalled();
    await act(async()=>input(container.querySelector<HTMLInputElement>('form input')!,' New zone '));await act(async()=>submit(container.querySelector('form')!));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operationId,resource:'ZONE',action:'CREATE',id:operationId,item:{name:'New zone'},expected:null});expect(container.querySelector<HTMLInputElement>('form input')!.value).toBe('');
  });
  it('renames a zone using its previous name as a concurrency expectation',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{operationId,resource:'ZONE',action:'UPDATE',entityId:zoneId}})));await mount('tables');
    await act(async()=>title('Đổi tên khu vực').click());await act(async()=>input(container.querySelector<HTMLInputElement>('form input')!,'Garden updated'));await act(async()=>submit(container.querySelector('form')!));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({resource:'ZONE',action:'UPDATE',id:zoneId,item:{name:'Garden updated'},expected:{name:'Garden'}});
  });
  it('creates a physical table with name/zone only, never a client-chosen status',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{operationId,resource:'TABLE',action:'CREATE',entityId:operationId}})));await mount('tables');
    await act(async()=>button('Thêm Bàn mới').click());await act(async()=>input(container.querySelector<HTMLInputElement>('input[placeholder^="VD: Bàn 01"]')!,'Table 2'));await act(async()=>submit(container.querySelectorAll('form')[1]));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operationId,resource:'TABLE',action:'CREATE',id:operationId,item:{table_number:'Table 2',zone_id:zoneId},expected:null});expect(container.querySelectorAll('form')).toHaveLength(1);
  });
  it('deletes an empty table through the metadata journal with its exact old mapping',async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{operationId,resource:'TABLE',action:'DELETE',entityId:table.id}})));await mount('tables');await act(async()=>title('Xóa bàn').click());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({operationId,resource:'TABLE',action:'DELETE',id:table.id,item:null,expected:{table_number:table.table_number,zone_id:zoneId}});expect(mocks.from).not.toHaveBeenCalled();
  });
});
