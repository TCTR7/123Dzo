// VietQR account-transfer TLV, CRC16/CCITT-FALSE. ASCII-only fields avoid byte-length ambiguity.
export function crc16(text:string):string{
 let crc=0xffff;for(const byte of new TextEncoder().encode(text)){crc^=byte<<8;for(let n=0;n<8;n++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;}
 return crc.toString(16).toUpperCase().padStart(4,'0');
}
function field(id:string,value:string){if(!/^[\x20-\x7E]*$/.test(value)||value.length>99)throw new Error('Invalid QR field');return id+String(value.length).padStart(2,'0')+value;}
export function transferQr(bankId:string,accountNo:string,amount:number,code:string){
 if(!/^\d{6}$/.test(bankId)||!/^\d{6,19}$/.test(accountNo)||!Number.isSafeInteger(amount)||amount<=0||amount>1e15||!/^NU[A-Z0-9]{18}$/.test(code))return null;
 const account=field('00',bankId)+field('01',accountNo);
 const merchant=field('00','A000000727')+field('01',account)+field('02','QRIBFTTA');
 const payload=field('00','01')+field('01','12')+field('38',merchant)+field('53','704')+field('54',String(amount))+field('58','VN')+field('62',field('08',code))+'6304';
 return payload+crc16(payload);
}
