import { getHomeByRole } from './roles';
import type { StaffRole } from '@/types/database.types';
export function internalDestination(value?: string, origin?: string): string | null {
  if (!value || /[\\\x00-\x20]/.test(value)) return null;
  try {
    const base = origin || 'https://local.invalid';
    const url = new URL(value, base);
    if (url.origin !== new URL(base).origin || !/^\/(operator|admin|staff|kitchen)(\/|$)/.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch { return null; }
}
export function roleDestination(role: StaffRole, value?: string) {
  const path = internalDestination(value);
  if (path && (role === 'operator' || role === 'admin' && !path.startsWith('/operator') || role === 'staff' && /^\/staff(\/|\?|$)/.test(path) || role === 'kitchen' && /^\/kitchen(\/|\?|$)/.test(path))) return path;
  return getHomeByRole(role);
}
