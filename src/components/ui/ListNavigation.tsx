import Link from 'next/link';
export function ListNavigation({ path, page, hasNext, params = {}, label }: { path: string; page: number; hasNext: boolean; params?: Record<string, string>; label: string }) {
  const href = (next: number) => `${path}?${new URLSearchParams({ ...params, page: String(next) })}`;
  return <nav aria-label={label} className="my-4 flex items-center gap-3 text-sm text-zinc-300 print:hidden">
    {page > 1 && <Link className="min-h-12 rounded-lg border border-zinc-700 px-4 py-3" href={href(page - 1)}>Trang trước</Link>}
    <span>{label} · Trang {page}</span>
    {hasNext && <Link className="min-h-12 rounded-lg border border-zinc-700 px-4 py-3" href={href(page + 1)}>Trang sau</Link>}
  </nav>;
}
