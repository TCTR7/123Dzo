import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { Beer } from 'lucide-react';

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4">
      <div className="mb-6 flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
          <Beer className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-amber-400">123Dzô • Nội Bộ</h1>
          <p className="text-xs text-zinc-400">
            Đăng nhập dành cho Quản lý, Bếp & Nhân viên phục vụ
          </p>
        </div>
      </div>

      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/admin"
      />

      <Link
        href="/"
        className="mt-6 text-xs text-zinc-400 hover:text-amber-400 transition-colors"
      >
        ← Quay về Trang chủ 123Dzô
      </Link>
    </div>
  );
}
