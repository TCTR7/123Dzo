import imageCompression, { type Options as ImageCompressionOptions } from 'browser-image-compression';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
  const MAX_SIZE_BYTES = 80 * 1024; // 80KB

  const options: ImageCompressionOptions = {
    maxSizeMB: 0.075, // ~76.8KB (đảm bảo nghiêm ngặt < 80KB)
    maxWidthOrHeight: 1024,
    useWebWorker: true,
    fileType: 'image/webp',
    initialQuality: 0.8,
  };

  const compressedBlob = await imageCompression(file, options);

  // Nếu sau lần nén đầu tiên vẫn nhỉnh hơn 80KB, ép chất lượng thêm 1 bước nữa
  let finalBlob: Blob = compressedBlob;
  if (compressedBlob.size > MAX_SIZE_BYTES) {
    finalBlob = await imageCompression(file, {
      ...options,
      maxSizeMB: 0.065,
      maxWidthOrHeight: 800,
      initialQuality: 0.65,
    });
  }

  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const webpFileName = `${baseName}.webp`;

  return new File([finalBlob], webpFileName, {
    type: 'image/webp',
    lastModified: Date.now(),
  });
}

/**
 * Phát âm thanh cảnh báo (/sounds/ting-ting.mp3) cho màn hình Bếp (/kitchen) và Nhân viên (/staff)
 * Tuân thủ Mục 10.3 trong PRD_SPEC.md
 */
export async function playNotificationSound(
  soundUrl: string = '/sounds/ting-ting.mp3'
): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const audio = new Audio(soundUrl);
    audio.preload = 'auto';
    audio.volume = 1.0;
    await audio.play();
  } catch (error) {
    // Fallback hoặc trình duyệt chặn Autoplay khi chưa có tương tác người dùng
    console.warn('Không thể phát âm thanh thông báo:', error);
  }
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
