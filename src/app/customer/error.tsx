'use client';
import { CustomerShell } from '@/components/customer/CustomerShell';
export default function CustomerError({reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <CustomerShell><section role="alert" className="p-6 space-y-4"><h1 className="text-2xl font-bold">Chưa kết nối được với quán</h1>
  <p>Chưa thể tải thông tin mới. Giỏ trên thiết bị vẫn được giữ. Nếu bạn vừa gửi món hoặc thanh toán, hãy kiểm tra kết quả trước khi thực hiện lại.</p>
  <button type="button" onClick={reset} className="min-h-12 px-4 rounded-xl bg-amber-400 text-zinc-950 font-bold">Thử tải lại</button>
  <p>Bạn có thể nhờ nhân viên tại quán kiểm tra giúp.</p></section></CustomerShell>;
}
