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
 * Client Components use REST/Storage only through the authorized Next.js proxy.
 * Live updates arrive separately through the scoped SSE endpoint /api/events.
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
          // Never send browser CRUD directly to the database with an anon key.
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
