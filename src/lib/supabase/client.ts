import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

let browserClient: SupabaseClient<Database> | undefined;

function normalizeSupabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

/**
 * Khởi tạo Supabase Browser Client (Singleton trên trình duyệt) tích hợp kiểu Database
 * Sử dụng trong các Client Components ('use client') để truy vấn và lắng nghe Supabase Realtime.
 */
export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const supabaseUrl = normalizeSupabaseUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
