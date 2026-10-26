import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth/roles', () => ({ getHomeByRole: (r:string) => r === 'operator' ? '/operator' : r === 'admin' ? '/admin' : '/' + r }));
import { internalDestination, roleDestination } from '@/lib/auth/navigation';
import { normalizePhoneUsername } from '@/lib/auth/phone-username';
import { reportRange, localDate, weekdayVisits } from '@/lib/dashboard';
import { parseVietQr, buildPaymentQr, crc16 } from '@/lib/payments/vietqr';
const reference='00020101021238540010A00000072701240006970407011012345678900208QRIBFTTA53037045405420005802VN62160812DZOREFERENCE63044663';
describe('Restored account and entry flows',()=>{
  it.each(['0912345678','+84 912 345 678','0084912345678','84-912-345-678'])('normalizes %s without SMS',s=>expect(normalizePhoneUsername(s)).toBe('0912345678'));
  it.each(['1234','email@example.com','090000','+441234567890'])('rejects invalid login %s',s=>expect(normalizePhoneUsername(s)).toBeNull());
  it.each(['https://evil.example/admin','//evil.example/admin','/api/customer/orders','/sign-in','/customer/takeaway','/admin\\evil'])('rejects unsafe or non-staff return destination %s',s=>expect(internalDestination(s)).toBeNull());
  it('returns to an authorized destination and otherwise goes to the role home',()=>{
    expect(roleDestination('staff','/admin')).toBe('/staff');
    expect(roleDestination('operator','/admin/bills')).toBe('/admin/bills');
    expect(roleDestination('kitchen','/staff')).toBe('/kitchen');
    expect(internalDestination('https://quanmih.example/admin','https://quanmih.example')).toBe('/admin');
  });
});
describe('Useful sales summaries',()=>{
  it('uses Vietnam dates and validates the selected range',()=>{
    expect(localDate(new Date('2026-10-25T18:00:00Z'))).toBe('2026-10-26');
    expect(reportRange('2026-02-30','2026-10-26','2026-10-26')).toEqual({start:'2026-09-29',end:'2026-10-26'});
    expect(reportRange('2026-10-26','2026-10-01','2026-10-26')).toEqual({start:'2026-09-29',end:'2026-10-26'});
  });
  it('counts visits and excludes unpaid orders, including empty weekdays in the average',()=>{
    const rows=weekdayVisits([
      {opened_at:'2026-10-18T18:00:00Z',session_type:'DINE_IN',status:'CLOSED'},
      {opened_at:'2026-10-19T10:00:00Z',session_type:'TAKEAWAY',status:'ACTIVE'},
      {opened_at:'2026-10-19T10:00:00Z',session_type:'TAKEAWAY',status:'PENDING_PAYMENT'},
    ],'2026-10-19','2026-10-26');
    expect(rows[0]).toMatchObject({days:2,dineIn:1,takeaway:1,average:1}); expect(rows[6].average).toBe(0);
  });
});
describe('Receiving-account QR',()=>{
  it('decodes an independent bank QR and validates its checksum',()=>{
    expect(crc16('123456789')).toBe('29B1');
    expect(parseVietQr(reference)).toMatchObject({bankBin:'970407',accountNumber:'1234567890',accountName:''});
    expect(()=>parseVietQr(reference.slice(0,-1)+'0')).toThrow();
  });
  it('uses the actual order amount and memo instead of the uploaded QR amount/memo',()=>{
    const next=buildPaymentQr({...parseVietQr(reference),accountName:'NGUYEN VAN A'},135000,'DZOORDER');
    expect(next).toContain('5406135000');expect(next).toContain('DZOORDER');expect(next).not.toContain('DZOREFERENCE');expect(parseVietQr(next).accountNumber).toBe('1234567890');
  });
  it.each([0,-1,1.5,NaN])('does not create a payment QR for invalid amount %s',n=>expect(()=>buildPaymentQr({...parseVietQr(reference),accountName:'A'},n,'DZO')).toThrow());
});
