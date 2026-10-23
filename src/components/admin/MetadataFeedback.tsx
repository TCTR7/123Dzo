'use client';
export function MetadataFeedback({ pending, busy, error, recover }: {
  pending: boolean; busy: boolean; error: string | null; recover: () => Promise<boolean>;
}) {
  return <div aria-live="polite" className="space-y-2">
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {pending && <div className="rounded-xl border border-amber-600 bg-amber-950/30 p-3 text-sm text-amber-200">
      <p>Chưa xác nhận thay đổi danh mục. Kiểm tra lượt vừa gửi trước khi thao tác tiếp.</p>
      <button type="button" disabled={busy} onClick={() => void recover()} className="mt-2 min-h-12 rounded-lg bg-amber-500 px-4 font-semibold text-zinc-950 disabled:opacity-50">
        {busy ? 'Đang kiểm tra...' : 'Kiểm tra thay đổi danh mục vừa gửi'}
      </button>
    </div>}
  </div>;
}
