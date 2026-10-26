export const PHONE_USERNAME_ERROR = 'Nhập số di động Việt Nam, ví dụ 0912345678.';
export function normalizePhoneUsername(value: string): string | null {
  if (value.length > 40) return null;
  let phone = value.trim().replace(/[\s().-]/g, '');
  phone = phone.replace(/^(?:\+84|0084|84)/, '0');
  return /^0[35789]\d{8}$/.test(phone) ? phone : null;
}
