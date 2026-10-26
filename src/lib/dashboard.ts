import type { TableSessionRow } from '@/types/database.types';
export function localDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function shiftDate(date: string, days: number) { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function reportRange(start?: string, end?: string, today = localDate()) {
  const valid = (s?: string): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  return valid(start) && valid(end) && start <= end && end <= today && start >= '2000-01-01' ? { start, end } : { start: shiftDate(today, -27), end: today };
}
export function weekdayVisits(sessions: Pick<TableSessionRow, 'opened_at' | 'session_type' | 'status'>[], start: string, end: string) {
  const rows = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'].map(label => ({ label, days: 0, dineIn: 0, takeaway: 0, average: 0 }));
  for (let d = start; d <= end; d = shiftDate(d, 1)) rows[new Date(d + 'T00:00:00Z').getUTCDay()].days++;
  for (const s of sessions) {
    const d = localDate(new Date(s.opened_at));
    if (d < start || d > end || !['ACTIVE', 'REQUEST_BILL', 'CLOSED'].includes(s.status)) continue;
    const row = rows[new Date(d + 'T00:00:00Z').getUTCDay()];
    if (s.session_type === 'DINE_IN') row.dineIn++; else row.takeaway++;
  }
  rows.forEach(r => { r.average = r.days ? (r.dineIn + r.takeaway) / r.days : 0; });
  return [...rows.slice(1), rows[0]];
}
