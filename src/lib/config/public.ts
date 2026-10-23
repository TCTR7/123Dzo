export function requiredSetting(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`Missing ${name}`);
  if (/your[-_]|placeholder|change[-_]?me|example\.com/i.test(trimmed)) throw new Error(`Invalid ${name}`);
  return trimmed;
}
export function supabaseUrl(value: string | undefined): string {
  const name = 'NEXT_PUBLIC_SUPABASE_URL'; const text = requiredSetting(name, value);
  try {
    const url = new URL(text);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash ||
      !['', '/', '/rest/v1', '/rest/v1/'].includes(url.pathname)) throw new Error('Invalid URL');
    return url.origin;
  } catch { throw new Error(`Invalid ${name}`); }
}
