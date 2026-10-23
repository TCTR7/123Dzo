import 'server-only';
import { requiredSetting } from './public';
export function cronSecret(): string {
  const value = requiredSetting('CRON_SECRET', process.env.CRON_SECRET);
  if (value.length < 32) throw new Error('Invalid CRON_SECRET');
  return value;
}
export function pushSettings() {
  const publicKey = requiredSetting('NEXT_PUBLIC_VAPID_PUBLIC_KEY', process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const privateKey = requiredSetting('VAPID_PRIVATE_KEY', process.env.VAPID_PRIVATE_KEY);
  const subject = requiredSetting('VAPID_SUBJECT', process.env.VAPID_SUBJECT);
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(subject)) throw new Error('Invalid VAPID_SUBJECT');
  return { publicKey, privateKey, subject };
}
