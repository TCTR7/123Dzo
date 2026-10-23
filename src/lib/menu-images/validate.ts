import 'server-only';
import sharp from 'sharp';
import { MENU_IMAGE_MAX_BYTES, MENU_IMAGE_MAX_SIDE } from './limits';
export class ImageInputError extends Error {
  constructor(public readonly status: 400 | 413 | 415, message: string) { super(message); }
}
export async function readMenuImage(req: Request): Promise<Buffer> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/webp') throw new ImageInputError(415, 'Ảnh tải lên phải là WebP.');
  const reader = req.body?.getReader(); if (!reader) throw new ImageInputError(400, 'Thiếu dữ liệu ảnh.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size >= MENU_IMAGE_MAX_BYTES) { await reader.cancel(); throw new ImageInputError(413, 'Ảnh phải nhỏ hơn 80KB.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8)
    throw new ImageInputError(400, 'Nội dung ảnh WebP không hợp lệ.');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MENU_IMAGE_MAX_SIDE ** 2 });
    const meta = await image.metadata();
    if (meta.format !== 'webp' || !meta.width || !meta.height || meta.width > MENU_IMAGE_MAX_SIDE || meta.height > MENU_IMAGE_MAX_SIDE || (meta.pages ?? 1) !== 1)
      throw new Error('Invalid image dimensions or animation');
    await image.raw().toBuffer(); // metadata alone does not prove that the pixel payload decodes.
  } catch { throw new ImageInputError(400, 'Ảnh phải là WebP tĩnh, đọc được và tối đa 1024px mỗi chiều.'); }
  return bytes;
}
