import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database.types';
import {
  instantDemoFetch,
  isPlaceholderSupabaseUrl,
} from './demo-fallback';

const FALLBACK_SUPABASE_URL = 'https://placeholder-project.supabase.co';
const FALLBACK_SUPABASE_KEY = 'placeholder-anon-key';

/**
 * Khởi tạo Supabase Server Client tích hợp kiểu Database cho Next.js 15 App Router
 * Lưu ý Next.js 15: cookies() trả về Promise nên bắt buộc dùng await cookies().
 */
export async function createSupabaseServerClient(): Promise<
  SupabaseClient<Database>
> {
  const cookieStore = await cookies();
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const isPlaceholder = isPlaceholderSupabaseUrl(rawUrl);
  const supabaseUrl = !isPlaceholder && rawUrl ? rawUrl : FALLBACK_SUPABASE_URL;
  const supabaseAnonKey =
    rawKey && rawKey.length > 0 ? rawKey : FALLBACK_SUPABASE_KEY;

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: isPlaceholder ? { fetch: instantDemoFetch } : undefined,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Được gọi từ Server Component (chỉ đọc cookie), có thể bỏ qua an toàn
        }
      },
    },
  }) as unknown as SupabaseClient<Database>;
}

/**
 * Khởi tạo Supabase Service Role Client (Admin privileges) tích hợp kiểu Database
 * Dùng cho các tác vụ hệ thống phía Server như Webhook thanh toán (/api/webhooks/payment)
 * hoặc gửi Web Push Notification (/api/push/notify).
 */
export function createSupabaseServiceRoleClient(): SupabaseClient<Database> {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const isPlaceholder = isPlaceholderSupabaseUrl(rawUrl);
  const supabaseUrl = !isPlaceholder && rawUrl ? rawUrl : FALLBACK_SUPABASE_URL;
  const serviceRoleKey =
    rawKey && rawKey.length > 0 ? rawKey : FALLBACK_SUPABASE_KEY;

  return createSupabaseJsClient<Database>(
    supabaseUrl,
    serviceRoleKey,
    {
      global: isPlaceholder ? { fetch: instantDemoFetch } : undefined,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  ) as unknown as SupabaseClient<Database>;
}

export {
  createSupabaseServerClient as createClient,
  createSupabaseServiceRoleClient as createServiceRoleClient,
};
