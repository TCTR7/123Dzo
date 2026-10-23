'use client';
import { useEffect, useState } from 'react';
import { LIST_PAGE_SIZE } from '@/lib/data/lists';
export function useListPage<T>(items: T[], filterKey: string) {
  const [selected, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filterKey]);
  const pages = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE)), page = Math.min(selected, pages);
  return { pageItems: items.slice((page - 1) * LIST_PAGE_SIZE, page * LIST_PAGE_SIZE), page, pages, setPage };
}
export function LocalListNavigation({ page, pages, setPage, label }: { page: number; pages: number; setPage: (page: number) => void; label: string }) {
  if (pages <= 1) return null;
  return <nav aria-label={label} className="my-3 flex items-center gap-3 text-sm text-zinc-300">
    <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)} className="min-h-12 rounded-lg border border-zinc-700 px-4 disabled:opacity-40">Trang trước</button>
    <span>{label} · {page}/{pages}</span>
    <button type="button" disabled={page === pages} onClick={() => setPage(page + 1)} className="min-h-12 rounded-lg border border-zinc-700 px-4 disabled:opacity-40">Trang sau</button>
  </nav>;
}
