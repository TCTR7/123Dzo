'use client';
import {useRef,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {transferQr} from '@/lib/takeaway/vietqr';
import {formatVND} from '@/lib/utils';
export function PaymentInstructions({bank,amount,code}:{bank:{bankId:string;accountNo:string;accountName:string}|null;amount:number;code:string}){
 const [message,setMessage]=useState<string|null>(null),[saving,setSaving]=useState(false),qrNode=useRef<HTMLDivElement>(null);
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setMessage('Đã sao chép.');}catch{setMessage('Chưa sao chép được. Bạn có thể chọn và sao chép phần chữ.');}}
 async function saveQr(){if(saving)return;setSaving(true);let url:string|undefined;
  try{const svg=qrNode.current?.querySelector('svg');if(!svg)throw new Error('Missing QR');url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('QR decode'));image.src=url!;});
   const canvas=document.createElement('canvas');canvas.width=660;canvas.height=660;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');context.fillStyle='white';context.fillRect(0,0,660,660);context.drawImage(image,30,30,600,600);const link=document.createElement('a');link.download='chuyen-khoan-'+code+'.png';link.href=canvas.toDataURL('image/png');link.click();setMessage('Đã yêu cầu lưu ảnh QR. Kiểm tra mục tải xuống của trình duyệt.');
  }catch{setMessage('Chưa lưu được ảnh QR. Bạn có thể chụp màn hình mã hoặc sao chép thông tin chuyển khoản.');}finally{if(url)URL.revokeObjectURL(url);setSaving(false);}
 }
 if(!bank)return <p role="alert">Chưa có tài khoản nhận tiền được quán xác minh. Gọi quán trước khi chuyển tiền.</p>;
 const qr=transferQr(bank.bankId,bank.accountNo,amount,code);
 return <section className="space-y-3 rounded-xl border border-amber-500 p-4"><h2 className="text-xl font-bold">Chuyển khoản và chờ quán xác nhận</h2>
  <p>Kiểm tra đúng tên người nhận trên ứng dụng ngân hàng. Quán xác nhận thủ công sau khi nhận đủ tiền; không chuyển lại nếu đang chờ.</p>
  <p>Ngân hàng: {bank.bankId==='970407'?'Techcombank':bank.bankId}</p><p className="break-all">Số tài khoản: <strong>{bank.accountNo}</strong></p><p>Chủ tài khoản: {bank.accountName}</p><p>Số tiền: <strong>{formatVND(amount)}</strong></p><p className="break-all">Nội dung: <strong>{code}</strong></p>
  <div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void copy(bank.accountNo)} className="min-h-12 border rounded-xl px-3">Sao chép số tài khoản</button><button type="button" onClick={()=>void copy(String(amount))} className="min-h-12 border rounded-xl px-3">Sao chép số tiền</button><button type="button" onClick={()=>void copy(code)} className="min-h-12 border rounded-xl px-3">Sao chép nội dung</button></div>
  {message&&<p role="status">{message}</p>}
  {qr&&<details><summary className="min-h-12 cursor-pointer py-3">Hiện QR để quét bằng máy khác</summary><div ref={qrNode} className="p-4 bg-white w-fit rounded-xl"><QRCodeSVG value={qr} size={220} title="Mã chuyển khoản cho đơn này"/></div><button type="button" disabled={saving} onClick={()=>void saveQr()} className="min-h-12 mt-3 px-3 border rounded-xl">{saving?'Đang tạo ảnh…':'Lưu ảnh QR'}</button></details>}
 </section>;
}
