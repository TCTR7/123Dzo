'use client';
import { useEffect,useId,useRef,type ReactNode } from 'react';
export function AccessibleDialog({open,title,onClose,locked=false,children}:{open:boolean;title:string;onClose:()=>void;locked?:boolean;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),titleId=useId(),closeRef=useRef(onClose),pointerOpener=useRef<HTMLElement|null>(null);
  closeRef.current=onClose;
  useEffect(()=>{
    if(open)return;
    // WebKit does not focus a clicked button. Remember its semantic trigger
    // before React opens the modal; keyboard navigation uses activeElement.
    const remember=(event:PointerEvent)=>{pointerOpener.current=event.target instanceof Element?event.target.closest<HTMLElement>('button,a[href],[role="button"]'):null;};
    const keyboard=()=>{pointerOpener.current=null;};
    document.addEventListener('pointerdown',remember,true);document.addEventListener('keydown',keyboard,true);
    return()=>{document.removeEventListener('pointerdown',remember,true);document.removeEventListener('keydown',keyboard,true);};
  },[open]);
  useEffect(()=>{
    const node=ref.current;if (!open||!node) return;
    const prior=pointerOpener.current?.isConnected?pointerOpener.current:document.activeElement instanceof HTMLElement?document.activeElement:null;
    node.showModal();
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return ()=>{node.close();document.body.style.overflow=overflow;if (prior?.isConnected) prior.focus();};
  },[open]);
  return open?<dialog ref={ref} aria-labelledby={titleId} onCancel={event=>{event.preventDefault();if(!locked)closeRef.current();}}
    onKeyDown={event=>{
      if(event.key!=='Tab')return;
      const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')].filter(node=>!node.matches(':disabled')&&node.tabIndex>=0&&node.getClientRects().length>0);
      const first=controls[0],last=controls[controls.length-1];
      if(!first){event.preventDefault();event.currentTarget.focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }}
    className="customer-app rounded-2xl border border-zinc-700 bg-zinc-900 text-zinc-100 w-[calc(100%_-_2rem)] max-w-[600px] max-h-[90dvh] p-0 backdrop:bg-black/80">
    <div className="p-4 space-y-4 overflow-y-auto max-h-[90dvh]">
      <header className="flex gap-3 items-start justify-between"><h2 id={titleId} className="text-xl font-bold">{title}</h2>
        <button type="button" aria-label="Đóng" disabled={locked} onClick={onClose} className="min-h-12 min-w-12 rounded-xl border border-zinc-600">×</button></header>
      {locked&&<p role="status">Đang kiểm tra yêu cầu. Vui lòng chờ kết quả trước khi đóng.</p>}{children}
    </div></dialog>:null;
}
