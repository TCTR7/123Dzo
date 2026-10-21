# 📋 Automation Test & QA Review Checklist (123Dzô)

Tài liệu đối chiếu chất lượng kiểm thử tự động theo `AGENTS.md` và `docs/PRO_SPEC.md`:

- [x] **Admin Auth (`features/admin_auth`)**: Kiểm tra phân quyền RBAC trên `/admin`, `/kitchen`, `/staff`.
- [x] **Admin Menu (`features/admin_menu`)**: Kiểm tra CRUD thực đơn, nén ảnh WebP `< 80KB` và gạt nút hết hàng `86ing`.
- [x] **Admin Inventory (`features/admin_inventory`)**: Kiểm tra cảnh báo tồn kho đỏ và nhập/xuất kho (`inventory_logs`).
- [x] **Admin Staff (`features/admin_staff`)**: Kiểm tra quản lý khu vực (`zones`), bàn nhậu (`tables`) và nhân sự.
- [x] **Admin Bills (`features/admin_bills`)**: Kiểm tra danh sách bàn chờ tính tiền (`REQUEST_BILL`) và in nhiệt K80.
- [x] **Admin Reports (`features/admin_reports`)**: Kiểm tra 4 SQL Views KPI & biểu đồ Recharts.
- [x] **Customer Dine-in (`features/customer_dine_in`)**: Kiểm tra quét QR `/customer/order/[token]`, chặn bàn `CLOSED`, chia tiền Campuchia.
- [x] **Customer Takeaway (`features/customer_takeaway`)**: Kiểm tra đặt mang về `/customer/takeaway` và VietQR.
- [x] **Kitchen KDS (`features/kitchen_kds`)**: Kiểm tra gom món trùng (`Batch Cooking`), hàng đợi `FIFO` và `Wake Lock`.
- [x] **Staff Portal (`features/staff_portal`)**: Kiểm tra mở bàn sinh QR, chuyển bàn, trả bia thừa (`RETURN_BEER`).
- [x] **UI Quality (`features/ui_quality`)**: Kiểm tra giao diện chuẩn PWA, tương phản cao và tốc độ phản hồi.
