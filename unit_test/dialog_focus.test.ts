import {act,createElement,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AccessibleDialog} from '@/components/ui/AccessibleDialog';
function Fixture(){const [open,setOpen]=useState(false);return createElement('div',null,createElement('input',{'aria-label':'Prior field'}),createElement('button',{onClick:()=>setOpen(true)},createElement('span',null,'Open dialog')),createElement(AccessibleDialog,{open,title:'Dialog focus',onClose:()=>setOpen(false),children:'Content'}));}
describe('Native modal restores the actual pointer or keyboard opener',()=>{
 let host:HTMLDivElement,root:Root;
 beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(Fixture)));});
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
 const close=async()=>act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')!.click());
 it('restores a pointer-clicked trigger even when WebKit leaves focus on an earlier input',async()=>{
  const input=host.querySelector('input')!,trigger=host.querySelector('button')!;input.focus();await act(async()=>{trigger.querySelector('span')!.dispatchEvent(new Event('pointerdown',{bubbles:true}));trigger.click();});await close();expect(document.activeElement).toBe(trigger);
 });
 it('keyboard activity clears an old pointer target and restores the focused trigger',async()=>{
  const input=host.querySelector('input')!,trigger=host.querySelector('button')!;input.dispatchEvent(new Event('pointerdown',{bubbles:true}));trigger.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await act(async()=>trigger.click());await close();expect(document.activeElement).toBe(trigger);
 });
 it('removes pointer and keyboard capture handlers on unmount',async()=>{
  const remove=vi.spyOn(document,'removeEventListener');await act(async()=>root.render(null));expect(remove).toHaveBeenCalledWith('pointerdown',expect.any(Function),true);expect(remove).toHaveBeenCalledWith('keydown',expect.any(Function),true);
 });
});
