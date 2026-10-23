import { UUID, isRecord } from '@/lib/orders/contracts';
export interface MenuImage { id: string; path: string; url: string; state: 'UPLOADING' | 'READY' }
export function parseMenuImage(value: unknown): MenuImage | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id) || value.path !== `managed/${value.id}.webp` ||
    typeof value.url !== 'string' || value.url.length > 2048 || !value.url.startsWith('https://') ||
    !value.url.endsWith(`/storage/v1/object/public/menu-images/${value.path}`) || (value.state !== 'UPLOADING' && value.state !== 'READY')) return null;
  return { id: value.id, path: value.path, url: value.url, state: value.state };
}
