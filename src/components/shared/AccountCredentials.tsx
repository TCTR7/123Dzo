'use client';
import { useState } from 'react';

export interface LoginCredentials { loginIdentifier: string; password: string; loginUrl: string }

export function AccountCredentials({ credentials }: { credentials: LoginCredentials }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Đăng nhập: ${credentials.loginUrl}\nTài khoản: ${credentials.loginIdentifier}\nMật khẩu khởi tạo: ${credentials.password}`);
      setFeedback('Đã sao chép');
    } catch { setFeedback('Không thể sao chép tự động. Hãy chọn thông tin bên dưới để copy.'); }
  }
  return <section className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
    <h3 className="font-bold text-emerald-300">Tài khoản vừa tạo</h3>
    <p className="break-all">Đăng nhập: {credentials.loginUrl}</p>
    <p className="break-all">Tài khoản: <strong>{credentials.loginIdentifier}</strong></p>
    <p className="break-all">Mật khẩu khởi tạo: <strong>{credentials.password}</strong></p>
    <button type="button" onClick={copy} className="min-h-12 rounded-lg bg-zinc-800 px-4 font-semibold">Copy thông tin tài khoản</button>
    <p role="status">{feedback}</p>
  </section>;
}
