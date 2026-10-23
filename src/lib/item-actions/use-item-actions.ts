'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { pendingItemAction, submitItemAction, acknowledgeItemAction } from './client';
import type { ItemCommand } from './contracts';
export function useItemActions(actor: string | null | undefined) {
  const router=useRouter(), lock=useRef(false);
  const [busy,setBusy]=useState(false), [pending,setPending]=useState(false), [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    setPending(false);setError(null);
    if (!actor) return;
    try {setPending(pendingItemAction(actor)!==null);} catch(error) {setPending(true);setError(error instanceof Error?error.message:'Không đọc được thao tác món.');}
  },[actor]);
  async function run(command?: ItemCommand) {
    if (!actor||lock.current||(command&&pending)) return false;
    lock.current=true;setBusy(true);setError(null);
    try {
      const result=await submitItemAction(actor,command);
      acknowledgeItemAction(actor,result.operationId);router.refresh();return true;
    } catch(error) {
      setError(error instanceof Error?error.message:'Chưa xác nhận thao tác món.');router.refresh();return false;
    } finally {
      try {setPending(pendingItemAction(actor)!==null);} catch {setPending(true);}
      lock.current=false;setBusy(false);
    }
  }
  return {run,busy,pending,error,blocked:!actor||busy||pending};
}
