'use client';
import { useEffect, useState } from 'react';
import { isRecord } from '@/lib/orders/contracts';
import { parseSessionBill, type SessionBill } from './bill-contract';
export function useSessionBill(sessionId: string | null, revision: unknown) {
  const [data, setData] = useState<SessionBill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setData(null); setError(null); setLoading(Boolean(sessionId));
    if (!sessionId) return;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/staff/bill?${new URLSearchParams({ sessionId })}`, { cache: 'no-store', signal: controller.signal });
        const payload: unknown = await response.json();
        const bill = response.ok && isRecord(payload) ? parseSessionBill(payload.data) : null;
        if (!bill || bill.sessionId !== sessionId) throw new Error('Bill unavailable');
        if (active) setData(bill);
      } catch { if (active) setError('Chưa tải đủ chi tiết bill. Vui lòng tải lại trước khi chốt hoặc in.'); }
      finally { clearTimeout(timer); if (active) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [sessionId, revision]);
  return { data: data?.sessionId === sessionId ? data : null, error, loading: sessionId !== null && (loading || (data?.sessionId !== sessionId && !error)) };
}
