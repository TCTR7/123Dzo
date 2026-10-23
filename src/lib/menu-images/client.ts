'use client';
import { isRecord, UUID } from '@/lib/orders/contracts';
import { MENU_IMAGE_MAX_BYTES } from './limits';
async function request(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { ...init, cache: 'no-store', signal: controller.signal });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) ? body.error : null;
      throw new Error(typeof error?.message === 'string' ? error.message : 'Chưa xác nhận thao tác ảnh.');
    }
    if (!isRecord(body)) throw new Error('Chưa xác nhận kết quả thao tác ảnh.');
    return body.data;
  } finally { clearTimeout(timer); }
}
export async function uploadMenuImage(file: File, id = crypto.randomUUID()): Promise<{ id: string; url: string }> {
  if (file.type !== 'image/webp' || !file.size || file.size >= MENU_IMAGE_MAX_BYTES || !UUID.test(id)) throw new Error('Ảnh phải là WebP nhỏ hơn 80KB.');
  const value = await request('/api/admin/menu-images', { method: 'POST', headers: { 'content-type': 'image/webp', 'x-upload-id': id }, body: file });
  if (!isRecord(value) || value.id !== id || typeof value.url !== 'string' || !value.url.startsWith('https://') || !value.url.endsWith(`/storage/v1/object/public/menu-images/managed/${id}.webp`))
    throw new Error('Chưa xác nhận ảnh tải lên. Vui lòng chọn lại ảnh.');
  return { id, url: value.url };
}
export async function cleanupMenuImages(): Promise<{ removed: number; failed: number }> {
  const value = await request('/api/admin/menu-images/cleanup', { method: 'POST' });
  if (!isRecord(value) || typeof value.removed !== 'number' || typeof value.failed !== 'number' || !Number.isInteger(value.removed) || !Number.isInteger(value.failed) ||
    value.removed < 0 || value.failed < 0 || value.removed + value.failed > 20) throw new Error('Chưa xác nhận kết quả dọn ảnh.');
  return { removed: value.removed, failed: value.failed };
}
