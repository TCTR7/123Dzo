export const LIST_PAGE_SIZE = 25;
export function listPage(value: string | string[] | undefined): number {
  return typeof value === 'string' && /^[1-9]\d{0,6}$/.test(value) && Number(value) <= 1000000 ? Number(value) : 1;
}
export async function readAll<T extends { id: string }>(fetchPage: (after: string | null) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[] }> {
  const rows: T[] = [], seen = new Set<string>(); let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const result = await fetchPage(cursor);
    if (result.error || !result.data) throw new Error('Không tải được danh sách đầy đủ. Vui lòng thử lại.');
    if (!result.data.length) return { data: rows };
    for (const row of result.data) {
      if (!row.id || seen.has(row.id)) throw new Error('Thứ tự danh sách thay đổi. Vui lòng tải lại.');
      cursor = row.id; seen.add(row.id); rows.push(row);
    }
  }
  throw new Error('Danh sách vượt phạm vi tải. Cần thu hẹp bộ lọc.');
}
