import { NextResponse } from 'next/server';
import { getCurrentStaffProfile, isManager } from '@/lib/auth/roles';
import { readPaymentSettings, savePaymentSettings } from '@/lib/payments/settings';
import { parseVietQr } from '@/lib/payments/vietqr';
const reply=(body: unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function manager() { const a=await getCurrentStaffProfile();return a?.is_active && isManager(a.role); }
export async function GET() {
  if(!await manager())return reply({error:'Không có quyền xem thông tin nhận tiền.'},403);
  try{return reply({settings:await readPaymentSettings()});}catch{return reply({error:'Chưa tải được thông tin nhận tiền. Hãy thử lại.'},503);}
}
export async function POST(req: Request) {
  if(!await manager())return reply({error:'Không có quyền đổi tài khoản nhận tiền.'},403);
  if(req.headers.get('origin') && req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Yêu cầu không hợp lệ.'},403);
  let settings;
  try {
    const raw=await req.text();if(raw.length>8192)throw Error('Thông tin quá dài.');
    const body: unknown=JSON.parse(raw);
    if(!body || typeof body!=='object')throw Error('Thông tin không hợp lệ.');
    const v=body as Record<string,unknown>;
    if(typeof v.qrText!=='string' || typeof v.accountName!=='string' || !v.accountName.trim() || v.accountName.length>100 || /[\x00-\x1f]/.test(v.accountName) || v.confirmed!==true)throw Error('Kiểm tra và xác nhận ngân hàng, tài khoản, tên người nhận.');
    settings={...parseVietQr(v.qrText),accountName:v.accountName.trim()};
  }catch(e){return reply({error:e instanceof Error?e.message:'Thông tin không hợp lệ.'},400);}
  try{await savePaymentSettings(settings);return reply({settings});}catch{return reply({error:'Chưa lưu được. Vui lòng thử lại.'},503);}
}
