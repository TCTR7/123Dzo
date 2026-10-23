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
 * Các truy vấn REST/Storage trên trình duyệt được định tuyến qua /api/supabase-proxy
 * khi gọi tới Supabase thật để không bị lỗi 42501 nếu anon role bị thu hồi quyền.
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
    const customFetch: typeof fetch = (input, init) => {
      try {
        const rawTarget =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (
          typeof window !== 'undefined' &&
          rawTarget.startsWith(supabaseUrl)
        ) {
          const parsed = new URL(rawTarget);
          // Nếu đang trong môi trường E2E Playwright có route intercept trên *.supabase.co thì giữ nguyên,
          // hoặc chuyển qua proxy nội bộ /api/supabase-proxy khi kết nối trực tiếp tới Supabase thật.
          const proxiedUrl = `${window.location.origin}/api/supabase-proxy${parsed.pathname}${parsed.search}`;
          return fetch(proxiedUrl, init);
        }
      } catch {
        // Fallback về fetch mặc định
      }
      return fetch(input, init);
    };

    browserClient = createBrowserClient<Database>(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          fetch: customFetch,
        },
      }
    ) as unknown as SupabaseClient<Database>;
  }

  return browserClient;
}

export { createSupabaseBrowserClient as createClient };
