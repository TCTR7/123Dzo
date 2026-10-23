import { supabaseUrl as normalizeSupabaseUrl, requiredSetting } from '@/lib/config/public';
import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/types/database.types';


/**
 * Khởi tạo Supabase Server Client tích hợp kiểu Database cho Next.js 15 App Router
 * Lưu ý Next.js 15: cookies() trả về Promise nên bắt buộc dùng await cookies().
 */
export async function createSupabaseServerClient(): Promise<
  SupabaseClient<Database>
> {
  const cookieStore = await cookies();
  const supabaseUrl = normalizeSupabaseUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const supabaseAnonKey = requiredSetting('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable'
    );
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
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
  const supabaseUrl = normalizeSupabaseUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const serviceRoleKey = requiredSetting('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY environment variable'
    );
  }

  return createSupabaseJsClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as unknown as SupabaseClient<Database>;
}

export {
  createSupabaseServerClient as createClient,
  createSupabaseServiceRoleClient as createServiceRoleClient,
};
