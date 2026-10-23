import imageCompression, { type Options as ImageCompressionOptions } from 'browser-image-compression';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MENU_IMAGE_MAX_BYTES, MENU_IMAGE_MAX_SIDE } from '@/lib/menu-images/limits';

/**
 * Gộp class Tailwind CSS an toàn, tránh xung đột style (chuẩn shadcn/ui)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Định dạng số tiền sang chuẩn tiền tệ Việt Nam Đồng (VNĐ)
 * Ví dụ: 150000 -> "150.000 ₫"
 */
export function formatVND(amount: number): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(safeAmount);
}

/**
 * Nén ảnh thực đơn phía Client sang định dạng WebP với dung lượng < 80KB
 * Tuân thủ nghiêm ngặt Mục 10.1 trong PRD_SPEC.md và AGENTS.md
 */
export async function compressMenuImageToWebP(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
    throw new Error('Chọn ảnh JPEG, PNG hoặc WebP, dung lượng tối đa 10MB.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 16000000) {
      throw new Error('Ảnh quá lớn. Chọn ảnh tối đa 4096px mỗi chiều và 16 triệu điểm ảnh.');
    }
  } finally { bitmap.close(); }

  const options: ImageCompressionOptions = {
    maxSizeMB: 0.075, // ~76.8KB (đảm bảo nghiêm ngặt < 80KB)
    maxWidthOrHeight: MENU_IMAGE_MAX_SIDE,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.8,
  };

  const compressedBlob = await imageCompression(file, options);

  // Nếu sau lần nén đầu tiên vẫn nhỉnh hơn 80KB, ép chất lượng thêm 1 bước nữa
  let finalBlob: Blob = compressedBlob;
  if (compressedBlob.size >= MENU_IMAGE_MAX_BYTES) {
    finalBlob = await imageCompression(file, {
      ...options,
      maxSizeMB: 0.065,
      maxWidthOrHeight: 800,
      initialQuality: 0.65,
    });
  }

  if (!finalBlob.size || finalBlob.size >= MENU_IMAGE_MAX_BYTES || finalBlob.type !== 'image/webp') {
    throw new Error('Ảnh sau nén phải là WebP nhỏ hơn 80KB. Vui lòng chọn ảnh khác.');
  }

  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const webpFileName = `${baseName}.webp`;

  return new File([finalBlob], webpFileName, {
    type: 'image/webp',
    lastModified: Date.now(),
  });
}

/**
 * Phát âm thanh cảnh báo (/sounds/ting-ting.wav) cho màn hình Bếp (/kitchen) và Nhân viên (/staff)
 * Tuân thủ Mục 10.3 trong PRD_SPEC.md
 */
export async function playNotificationSound(): Promise<void> {
  const { playEnabledSound } = await import('@/lib/audio/notifications');
  await playEnabledSound();
}

/**
 * Tính số phút chênh lệch giữa một mốc thời gian ISO và thời điểm hiện tại (hoặc mốc kết thúc)
 */
export function getElapsedMinutes(
  startTimeIso: string,
  endTimeIso?: string | null
): number {
  const startMs = new Date(startTimeIso).getTime();
  const endMs = endTimeIso ? new Date(endTimeIso).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((endMs - startMs) / 60000));
}

/**
 * Định dạng thời gian chờ dạng "MM:SS" hoặc "X phút" phục vụ KDS & Nhân viên chạy bàn
 */
export function formatDurationFromSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
