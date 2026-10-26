import { createSupabaseServiceRoleClient } from '@/lib/supabase/server';
import { isPaymentSettings, type PaymentSettings } from './vietqr';
const path = 'settings/payment.json';
export async function readPaymentSettings(): Promise<PaymentSettings | null> {
  const r = await createSupabaseServiceRoleClient().storage.from('menu-images').download(path);
  if (r.error) {
    const e = r.error as { statusCode?: string | number; message: string };
    if (String(e.statusCode)==='404' || /object not found/i.test(e.message)) return null;
    throw Error('Chưa đọc được tài khoản nhận tiền.');
  }
  const data: unknown = JSON.parse(await r.data.text());
  if(!isPaymentSettings(data)) throw Error('Thông tin nhận tiền chưa hợp lệ.');
  return data;
}
export async function savePaymentSettings(value: PaymentSettings) {
  const r=await createSupabaseServiceRoleClient().storage.from('menu-images').upload(path,JSON.stringify(value),{contentType:'application/json',cacheControl:'0',upsert:true});
  if(r.error) throw Error('Chưa lưu được thông tin nhận tiền. Vui lòng thử lại.');
}
