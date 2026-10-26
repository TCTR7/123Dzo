import type { OrderItemRow, StaffRole, TableSessionRow } from '@/types/database.types';
export const orderStatusLabel: Record<OrderItemRow['status'], string> = { QUEUED: 'Bếp đã nhận', COOKING: 'Bếp đang làm', READY: 'Đã xong', SERVED: 'Đã phục vụ', CANCELLED: 'Đã hủy' };
export const sessionStatusLabel: Record<TableSessionRow['status'], string> = { PENDING_PAYMENT: 'Chờ thanh toán', ACTIVE: 'Đang phục vụ', REQUEST_BILL: 'Khách gọi tính tiền', CLOSED: 'Đã thanh toán' };
export const staffRoleLabel: Record<StaffRole, string> = { operator: 'Người bàn giao', admin: 'Chủ quán', staff: 'Phục vụ', kitchen: 'Đầu bếp' };
