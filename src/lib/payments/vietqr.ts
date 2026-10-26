export interface PaymentSettings { bankBin: string; bankName: string; accountNumber: string; accountName: string }
const banks: Record<string,string> = { '970407':'Techcombank', '970422':'MB', '970436':'Vietcombank', '970415':'VietinBank', '970418':'BIDV', '970405':'Agribank', '970416':'ACB', '970423':'TPBank', '970432':'VPBank', '970403':'Sacombank', '970437':'HDBank', '970441':'VIB', '970443':'SHB', '970426':'MSB', '970448':'OCB' };
const encode = (s: string) => new TextEncoder().encode(s);
export function crc16(value: string) {
  let crc = 0xffff;
  for (const byte of encode(value)) { crc ^= byte << 8; for (let i=0;i<8;i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff; }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
function fields(value: string) {
  const bytes=encode(value), result: Record<string,string> = {}, decoder=new TextDecoder('utf-8',{fatal:true});
  for(let offset=0;offset<bytes.length;) {
    if(offset+4>bytes.length) throw Error('Mã QR không đầy đủ.');
    const tag=decoder.decode(bytes.slice(offset,offset+2)), size=decoder.decode(bytes.slice(offset+2,offset+4)), n=Number(size);
    if(!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(size) || !n || result[tag] !== undefined || offset+4+n>bytes.length) throw Error('Mã QR không hợp lệ.');
    result[tag]=decoder.decode(bytes.slice(offset+4,offset+4+n)); offset+=4+n;
  }
  return result;
}
const tlv=(tag:string,value:string) => tag + String(encode(value).length).padStart(2,'0') + value;
export function parseVietQr(value: string): PaymentSettings {
  if(value.length>1500 || !/6304[0-9A-Fa-f]{4}$/.test(value) || crc16(value.slice(0,-4)) !== value.slice(-4).toUpperCase()) throw Error('Mã QR bị lỗi hoặc không phải mã chuyển khoản ngân hàng.');
  const top=fields(value);
  if(top['00']!=='01' || top['53']!=='704' || top['58']!=='VN' || !top['38']) throw Error('Hãy chọn mã QR chuyển khoản tài khoản ngân hàng Việt Nam.');
  const merchant=fields(top['38']);
  if(merchant['00']!=='A000000727' || merchant['02']!=='QRIBFTTA' || !merchant['01']) throw Error('Chỉ nhận mã chuyển khoản vào tài khoản ngân hàng.');
  const account=fields(merchant['01']), bankBin=account['00'], accountNumber=account['01'];
  if(!/^\d{6}$/.test(bankBin || '') || !/^[a-zA-Z0-9]{1,34}$/.test(accountNumber || '')) throw Error('Không đọc được ngân hàng và số tài khoản.');
  return {bankBin,bankName:banks[bankBin] || 'Ngân hàng BIN ' + bankBin,accountNumber,accountName:top['59'] || ''};
}
export function isPaymentSettings(s: unknown): s is PaymentSettings {
  if(!s || typeof s !== 'object') return false;
  const v=s as Record<string,unknown>;
  return typeof v.bankBin==='string' && /^\d{6}$/.test(v.bankBin) && typeof v.accountNumber==='string' && /^[a-zA-Z0-9]{1,34}$/.test(v.accountNumber) && typeof v.bankName==='string' && v.bankName.length>0 && v.bankName.length<=100 && typeof v.accountName==='string' && v.accountName.trim().length>0 && v.accountName.length<=100 && !/[\x00-\x1f]/.test(v.accountName);
}
export function buildPaymentQr(s: PaymentSettings, amount: number, code: string) {
  if(!isPaymentSettings(s) || !Number.isSafeInteger(amount) || amount<=0 || amount>1e12 || !/^[a-zA-Z0-9 -]{1,25}$/.test(code)) throw Error('Chưa tạo được mã thanh toán.');
  const receiver=tlv('00',s.bankBin)+tlv('01',s.accountNumber);
  const merchant=tlv('00','A000000727')+tlv('01',receiver)+tlv('02','QRIBFTTA');
  const name=s.accountName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').replace(/[^a-zA-Z0-9 ]/g,'').slice(0,25).toUpperCase();
  const value=tlv('00','01')+tlv('01','12')+tlv('38',merchant)+tlv('53','704')+tlv('54',String(amount))+tlv('58','VN')+(name?tlv('59',name):'')+tlv('62',tlv('08',code))+'6304';
  return value+crc16(value);
}
