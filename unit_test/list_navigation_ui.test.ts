import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LocalListNavigation,useListPage} from '@/components/ui/LocalListNavigation';
function Fixture({filter='all'}:{filter?:string}){const items=Array.from({length:60},(_,index)=>({id:index})).filter(row=>filter==='all'||row.id===59);const page=useListPage(items,filter);return createElement('div',null,createElement('p',null,page.pageItems.map(row=>row.id).join(',')),createElement(LocalListNavigation,{...page,label:'Test list'}));}
describe('Catalog pagination UI',()=>{
  let container:HTMLDivElement,root:Root;
  beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
  afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
  it('reaches records after25 and50 then resets when a filter narrows the list',async()=>{
    await act(async()=>root.render(createElement(Fixture)));expect(container.querySelector('p')?.textContent?.split(',')).toHaveLength(25);
    await act(async()=>container.querySelectorAll('button')[1].click());expect(container.querySelector('p')?.textContent).toMatch(/^25,/);
    await act(async()=>container.querySelectorAll('button')[1].click());expect(container.querySelector('p')?.textContent).toMatch(/^50,/);expect(container.querySelectorAll('button')[1].disabled).toBe(true);
    await act(async()=>root.render(createElement(Fixture,{filter:'last'})));expect(container.querySelector('p')?.textContent).toBe('59');expect(container.querySelector('nav')).toBeNull();
  });
});
