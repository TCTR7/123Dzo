'use client';
interface Props { pending: boolean; busy: boolean; error: string | null; recover: () => Promise<boolean> }
export function ItemActionFeedback({pending,busy,error,recover}:Props) {
  return <>
    {pending&&<div role="status" className="rounded-xl border border-amber-500 p-4 space-y-2">
      <p>Có thao tác món chưa xác nhận. Kiểm tra lượt này trước khi làm tiếp.</p>
      <button type="button" disabled={busy} onClick={()=>void recover()} className="min-h-12 px-4 rounded-lg bg-amber-500 text-zinc-950 disabled:opacity-50">{busy?'Đang kiểm tra...':'Kiểm tra thao tác món vừa gửi'}</button>
    </div>}
    {error&&<p role="alert" className="text-red-300">{error}</p>}
  </>;
}
