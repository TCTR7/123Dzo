import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
  instantDemoFetch,
  isPlaceholderSupabaseUrl,
} from './demo-fallback';

let browserClient: SupabaseClient<Database> | undefined;

const FALLBACK_SUPABASE_URL = 'https://placeholder-project.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY = 'placeholder-anon-key';

/**
 * Khởi tạo Supabase Browser Client (Singleton trên trình duyệt) tích hợp kiểu Database
 * Sử dụng trong các Client Components ('use client') để truy vấn và lắng nghe Supabase Realtime.
 */
export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const isPlaceholder = isPlaceholderSupabaseUrl(rawUrl);
  const supabaseUrl = !isPlaceholder && rawUrl ? rawUrl : FALLBACK_SUPABASE_URL;
  const supabaseAnonKey =
    rawKey && rawKey.length > 0 ? rawKey : FALLBACK_SUPABASE_ANON_KEY;

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
      global: isPlaceholder ? { fetch: instantDemoFetch } : undefined,
    }) as unknown as SupabaseClient<Database>;
  }

  return browserClient;
}

export { createSupabaseBrowserClient as createClient };
