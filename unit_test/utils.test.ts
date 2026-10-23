import { describe, it, expect, vi } from 'vitest';
import { enableSound } from '@/lib/audio/notifications';

vi.mock('browser-image-compression', () => ({
  default: vi.fn(async (file: File) => {
    // Trả về Blob giả lập kích thước 45KB (< 80KB)
    return new Blob([new Uint8Array(45 * 1024)], { type: 'image/webp' });
  }),
}));

import {
  cn,
  formatVND,
  compressMenuImageToWebP,
  playNotificationSound,
  getElapsedMinutes,
  formatDurationFromSeconds,
} from '@/lib/utils';

describe('Unit Test: src/lib/utils.ts (100% Coverage)', () => {
  describe('cn() - Tailwind Class Merger', () => {
    it('gộp các class Tailwind và loại bỏ xung đột chính xác', () => {
      expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
      expect(cn('text-red-500', false && 'text-blue-500', 'font-bold')).toBe(
        'text-red-500 font-bold'
      );
    });
  });

  describe('formatVND() - Định dạng tiền tệ VNĐ', () => {
    it('định dạng đúng số tiền nguyên dương sang chuẩn VNĐ', () => {
      const formatted = formatVND(150000);
      expect(formatted).toContain('150.000');
      expect(formatted).toContain('₫');
    });

    it('xử lý an toàn với giá trị 0 hoặc NaN/Infinity', () => {
      expect(formatVND(0)).toContain('0');
      expect(formatVND(Number.NaN)).toContain('0');
      expect(formatVND(Number.POSITIVE_INFINITY)).toContain('0');
    });
  });

  describe('compressMenuImageToWebP() - Nén ảnh thực đơn WebP < 80KB (Mục 10.1)', () => {
    it('chuyển đổi file ảnh sang định dạng .webp và đảm bảo dung lượng < 80KB', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1024, height: 768, close: vi.fn() })));
      const originalFile = new File(
        [new Uint8Array(500 * 1024)],
        'oc-huong-xao-bo-toi.jpg',
        { type: 'image/jpeg' }
      );

      const compressedFile = await compressMenuImageToWebP(originalFile);
      expect(compressedFile.name).toBe('oc-huong-xao-bo-toi.webp');
      expect(compressedFile.type).toBe('image/webp');
      expect(compressedFile.size).toBeLessThan(80 * 1024);
    });
  });

  describe('playNotificationSound() - Phát âm thanh cảnh báo (/sounds/ting-ting.wav)', () => {
    it('gọi Audio.play() an toàn và không crash nếu trình duyệt chặn Autoplay', async () => {
      const playMock = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal(
        'Audio',
        vi.fn().mockImplementation(function AudioMock() { return {
          preload: 'auto',
          volume: 1,
          play: playMock,
        }; })
      );

      await expect(
        playNotificationSound()
      ).resolves.toBeUndefined();
      expect(playMock).not.toHaveBeenCalled();
      await enableSound();
      await playNotificationSound();
      expect(playMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getElapsedMinutes() - Tính số phút chờ thực tế', () => {
    it('tính đúng số phút chênh lệch giữa 2 mốc ISO timestamp', () => {
      const start = '2026-10-21T10:00:00.000Z';
      const end = '2026-10-21T10:15:30.000Z';
      expect(getElapsedMinutes(start, end)).toBe(15);
    });

    it('trả về 0 nếu thời gian bắt đầu lớn hơn thời gian kết thúc hoặc chuỗi lỗi', () => {
      expect(
        getElapsedMinutes(
          '2026-10-21T10:20:00.000Z',
          '2026-10-21T10:10:00.000Z'
        )
      ).toBe(0);
      expect(getElapsedMinutes('invalid-date')).toBe(0);
    });
  });

  describe('formatDurationFromSeconds() - Đồng hồ đếm KDS (MM:SS)', () => {
    it('chuyển đổi số giây sang định dạng MM:SS có padding 2 chữ số', () => {
      expect(formatDurationFromSeconds(0)).toBe('00:00');
      expect(formatDurationFromSeconds(65)).toBe('01:05');
      expect(formatDurationFromSeconds(600)).toBe('10:00');
    });

    it('không trả về số âm khi đầu vào < 0', () => {
      expect(formatDurationFromSeconds(-45)).toBe('00:00');
    });
  });
});
