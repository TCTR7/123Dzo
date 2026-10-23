import { supabaseUrl as normalizeSupabaseUrl, requiredSetting } from '@/lib/config/public';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

let browserClient: SupabaseClient<Database> | undefined;


/**
 * Khởi tạo Supabase Browser Client (Singleton trên trình duyệt) tích hợp kiểu Database
 * Sử dụng trong các Client Components ('use client') để truy vấn và lắng nghe Supabase Realtime.
 */
export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const supabaseUrl = normalizeSupabaseUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const supabaseAnonKey = requiredSetting('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!supabaseAnonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable'
    );
  }

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      supabaseUrl,
      supabaseAnonKey
    ) as unknown as SupabaseClient<Database>;
  }

  return browserClient;
}

export { createSupabaseBrowserClient as createClient };
