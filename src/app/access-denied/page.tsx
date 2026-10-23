import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

export default async function AccessDeniedPage({ searchParams }: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const setupFailed = reason === 'operator-role' || reason === 'auth-setup';
  return <main className="min-h-screen flex items-center justify-center p-6"><section className="max-w-md space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
    <UserButton />
    <h1 className="text-xl font-bold">{setupFailed ? 'Chưa hoàn tất cấu hình đăng nhập' : 'Tài khoản chưa được cấp quyền hoặc đã tạm nghỉ'}</h1>
    <p>{reason === 'operator-role'
      ? 'Database đang dùng ràng buộc vai trò cũ. Người triển khai cần cập nhật staff_profiles_role_check để chấp nhận operator, admin, staff và kitchen trong Supabase SQL Editor, rồi bấm Thử lại.'
      : reason === 'auth-setup'
        ? 'Không thể kiểm tra quyền lúc này. Kiểm tra kết nối và cấu hình Supabase / Clerk, rồi thử lại.'
        : 'Liên hệ Chủ quán hoặc người bàn giao hệ thống để được cấp tài khoản làm việc.'}</p>
    {setupFailed && <Link href="/operator" className="block text-amber-400">Thử lại đăng nhập</Link>}
    <Link href="/" className="text-amber-400">Về trang chủ</Link>
  </section></main>;
}
