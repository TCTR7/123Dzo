import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {menu,item,operationId} from './menu_fixtures';
const mocks=vi.hoisted(()=>({compress:vi.fn(),refresh:vi.fn(),from:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock('@/lib/supabase/client',()=>({createSupabaseBrowserClient:()=>({from:mocks.from})}));
vi.mock('@/lib/utils',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/utils')>(),compressMenuImageToWebP:mocks.compress}));
import {MenuManager} from '@/components/admin/MenuManager';
const old='https://legacy.test/menu.webp',uploaded=`https://project.test/storage/v1/object/public/menu-images/managed/${operationId}.webp`;
describe('Menu image UI lifecycle',()=>{
  let container:HTMLDivElement,root:Root;const fetchMock=vi.fn();
  function button(text:string){const control=[...container.querySelectorAll('button')].find(node=>node.textContent?.includes(text));if(!control)throw new Error(`Missing ${text}`);return control;}
  async function mount(){await act(async()=>root.render(createElement(MenuManager,{initialMenuItems:[{...menu,image_url:old}],ingredients:[],currentStaffId:'user_admin'})));await act(async()=>container.querySelector<HTMLButtonElement>('button[title="Chỉnh sửa món"]')!.click());}
  function select(){const input=container.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(input,'files',{configurable:true,value:[new File(['original'],'food.png',{type:'image/png'})]});input.dispatchEvent(new Event('change',{bubbles:true}));return input;}
  function submit(){container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
  beforeEach(()=>{vi.clearAllMocks();fetchMock.mockReset();mocks.compress.mockResolvedValue(new File(['compressed'],'food.webp',{type:'image/webp'}));vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(crypto,'randomUUID').mockReturnValue(operationId);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
  it('locks save during upload, ignores double selection and uses only the server confirmed URL',async()=>{
    let resolve!:(value:Response)=>void;fetchMock.mockReturnValue(new Promise<Response>(done=>{resolve=done;}));await mount();
    await act(async()=>{select();select();});expect(mocks.compress).toHaveBeenCalledOnce();expect(fetchMock).toHaveBeenCalledOnce();expect(button('Lưu món ăn').disabled).toBe(true);
    await act(async()=>resolve(new Response(JSON.stringify({data:{id:operationId,url:uploaded}}))));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{operationId,action:'UPDATE',menuItemId:menu.id}})));await act(async()=>submit());
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).item.image_url).toBe(uploaded);expect(mocks.from).not.toHaveBeenCalled();
  });
  it('keeps legacy image after upload failure and never applies an unconfirmed URL',async()=>{
    fetchMock.mockRejectedValueOnce(new Error('lost upload'));await mount();await act(async()=>select());expect(container.textContent).toContain('lost upload');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{operationId,action:'UPDATE',menuItemId:menu.id}})));await act(async()=>submit());expect(JSON.parse(fetchMock.mock.calls[1][1].body).item.image_url).toBe(old);
  });
  it('does not delete an upload on menu save rollback and keeps it available for correction',async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{id:operationId,url:uploaded}}))).mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'MENU_CHANGED',message:'Món vừa thay đổi'}}),{status:409}));
    await mount();await act(async()=>select());await act(async()=>submit());expect(container.querySelector('form')).not.toBeNull();expect(fetchMock).toHaveBeenCalledTimes(2);expect(container.textContent).toContain('Món vừa thay đổi');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({item:{image_url:uploaded},expected:{...item,image_url:old}});expect(mocks.from).not.toHaveBeenCalled();
  });
  it('offers clearing the image by null rather than deleting Storage directly',async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:{operationId,action:'UPDATE',menuItemId:menu.id}})));await mount();await act(async()=>button('Bỏ ảnh khỏi món').click());await act(async()=>submit());expect(JSON.parse(fetchMock.mock.calls[0][1].body).item.image_url).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
  });
});
