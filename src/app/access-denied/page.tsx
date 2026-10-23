import Link from 'next/link';

interface AccessDeniedPageProps {
  searchParams: Promise<{ reason?: string | string[] }>;
}

export default async function AccessDeniedPage({ searchParams }: AccessDeniedPageProps) {
  const { reason } = await searchParams;
  const unavailable = reason === 'unavailable';

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold">
          {unavailable ? 'Chưa thể kiểm tra quyền truy cập' : 'Tài khoản chưa có quyền truy cập'}
        </h1>
        <p className="text-base text-zinc-300">
          {unavailable
            ? 'Hệ thống đang gặp sự cố khi xác minh tài khoản. Vui lòng thử lại sau.'
            : 'Vui lòng liên hệ quản lý để được cấp quyền hoặc kích hoạt lại tài khoản nhân viên.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="inline-flex min-h-12 items-center rounded-lg border border-zinc-600 px-4">
            Về trang chủ
          </Link>
          {unavailable && (
            <Link href="/admin" className="inline-flex min-h-12 items-center rounded-lg bg-amber-500 px-4 text-zinc-950">
              Thử lại
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
