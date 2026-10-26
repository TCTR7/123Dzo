import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

export default async function AccessDeniedPage({ searchParams }: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const setupFailed = reason === 'operator-role' || reason === 'auth-setup';
  return <main className="min-h-screen flex items-center justify-center p-6"><section className="max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6">
    <UserButton />
    <h1 className="text-xl font-bold">{setupFailed ? 'Chưa hoàn tất cấu hình đăng nhập' : 'Tài khoản chưa được cấp quyền hoặc đã tạm nghỉ'}</h1>
    <p>{reason === 'operator-role'
      ? 'Quán chưa hoàn tất thiết lập tài khoản. Vui lòng nhờ người bàn giao kiểm tra rồi thử lại.'
      : reason === 'auth-setup'
        ? 'Chưa kết nối được tài khoản. Vui lòng thử lại hoặc nhờ người bàn giao kiểm tra.'
        : 'Liên hệ Chủ quán hoặc người bàn giao hệ thống để được cấp tài khoản làm việc.'}</p>
    {setupFailed && <Link href="/operator" className="block text-amber-800">Thử lại đăng nhập</Link>}
    <Link href="/" className="text-amber-800">Về trang chủ</Link>
  </section></main>;
}
