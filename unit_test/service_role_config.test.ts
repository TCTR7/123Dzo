// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';

describe('Service-role client configuration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co/rest/v1/');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects a missing service key even when an anon key exists', () => {
    expect(() => createSupabaseServiceRoleClient()).toThrow('Missing SUPABASE_SERVICE_ROLE_KEY');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only service key', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '   ');
    expect(() => createSupabaseServiceRoleClient()).toThrow('Missing SUPABASE_SERVICE_ROLE_KEY');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('uses only the service key and disables persistent auth', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', ' test-service-key ');
    createSupabaseServiceRoleClient();
    expect(createClient).toHaveBeenCalledWith('https://test.supabase.co', 'test-service-key', {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });
});
