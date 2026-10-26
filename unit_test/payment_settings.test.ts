import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({actor:vi.fn(),upload:vi.fn(),download:vi.fn()}));
vi.mock('@/lib/auth/roles',()=>({getCurrentStaffProfile:m.actor,isManager:(r:string)=>['admin','operator'].includes(r)}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServiceRoleClient:()=>({storage:{from:()=>({upload:m.upload,download:m.download})}})}));
import {GET,POST} from '@/app/api/accounts/payment-settings/route';
import {readPaymentSettings} from '@/lib/payments/settings';
const qrText='00020101021238540010A00000072701240006970407011012345678900208QRIBFTTA53037045405420005802VN62160812DZOREFERENCE63044663';
const req=(body:object={},origin='https://pub.example')=>new Request('https://pub.example/api/accounts/payment-settings',{method:'POST',headers:{origin},body:JSON.stringify({qrText,accountName:'NGUYEN VAN A',confirmed:true,...body})});
beforeEach(()=>{m.actor.mockResolvedValue({role:'admin',is_active:true});m.upload.mockResolvedValue({error:null});m.download.mockResolvedValue({error:{statusCode:'404',message:'Object not found'}});});
describe('Shared receiving account',()=>{
  it.each(['staff','kitchen',null])('rejects %s before reading or saving',async role=>{m.actor.mockResolvedValue(role?{role,is_active:true}:null);expect((await GET()).status).toBe(403);expect((await POST(req())).status).toBe(403);expect(m.upload).not.toHaveBeenCalled();});
  it('rejects inactive owners and cross-origin changes',async()=>{expect((await POST(req({},'https://evil.example'))).status).toBe(403);m.actor.mockResolvedValue({role:'admin',is_active:false});expect((await POST(req())).status).toBe(403);});
  it('treats a missing settings file as unconfigured without a sample bank fallback',async()=>{expect(await readPaymentSettings()).toBeNull();});
  it('does not hide real storage failures',async()=>{m.download.mockResolvedValue({error:{statusCode:'500',message:'offline'}});expect((await GET()).status).toBe(503);});
  it('requires actual QR parsing and explicit confirmation, ignoring forged receiver fields',async()=>{
    expect((await POST(req({confirmed:false}))).status).toBe(400);expect(m.upload).not.toHaveBeenCalled();
    const r=await POST(req({bankBin:'999999',accountNumber:'fake'}));expect(r.status).toBe(200);
    const saved=JSON.parse(m.upload.mock.calls[0][1]);expect(saved).toMatchObject({bankBin:'970407',accountNumber:'1234567890',accountName:'NGUYEN VAN A'});
    expect(m.upload.mock.calls[0][0]).toBe('settings/payment.json');
  });
  it('permits retry after a failed save',async()=>{m.upload.mockResolvedValueOnce({error:{message:'offline'}});expect((await POST(req())).status).toBe(503);expect((await POST(req())).status).toBe(200);});
});
