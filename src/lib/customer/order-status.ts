import type { OrderItemStatus, TableSessionStatus } from '@/types/database.types';
export const itemStatusLabel:Record<OrderItemStatus,string>={QUEUED:'Chờ bếp nhận',COOKING:'Đang nấu',READY:'Đã sẵn sàng, chờ phục vụ',SERVED:'Đã lên bàn',CANCELLED:'Đã hủy'};
export function deriveTakeawayStatus(status:TableSessionStatus,items:readonly {status:OrderItemStatus;quantity:number}[],reviewRequired=false) {
  if (reviewRequired) return {kind:'CHECK',label:'Quán cần kiểm tra đơn. Không chuyển thêm tiền.'} as const;
  if (status==='CLOSED') return {kind:'COMPLETED',label:'Đơn đã hoàn tất'} as const;
  if (status==='PENDING_PAYMENT') return {kind:'PAYMENT',label:'Chờ xác nhận thanh toán'} as const;
  if (status!=='ACTIVE') return {kind:'CHECK',label:'Liên hệ quán để kiểm tra đơn'} as const;
  const active=items.filter(item=>item.quantity>0&&item.status!=='CANCELLED');
  if (!active.length) return {kind:'CHECK',label:'Liên hệ quán để kiểm tra đơn'} as const;
  return active.every(item=>item.status==='READY'||item.status==='SERVED')
    ? {kind:'READY',label:'Đơn đã chuẩn bị xong — bạn có thể đến nhận'} as const
    : {kind:'PREPARING',label:'Quán đang chuẩn bị đơn'} as const;
}
