# Artifacts Directory

Thư mục này lưu trữ tự động các kết quả sinh ra khi chạy Automation Test:
- `html-report/`: Báo cáo giao diện HTML của Playwright.
- `test-results/`: Screenshots khi lỗi, video quay lại phiên test và file trace.

Baseline được đối chiếu B21 (2026-10-23):

- Bộ canonical: `ux/git_baseline_9f986ac_2026-10-23T00-03-09-779Z/manifest.json`.
  Tám ảnh dựng lại từ Git9f986ac9413d89a80d7fb1668a1ce07ea1c83e05: dine-in
  menu/giỏ/progress/bill, takeaway menu/payment390px và staff/KDS1194×834.
  Manifest chứa SHA256 source/CSS/store/utils nguyên bản, lockfile Git và
  toolchain hiện dùng. Source lịch sử được extract vào .temp, không sửa src.
- Đây là baseline **reconstructed from Git**, không phải ảnh deployment cũ.
  Data/Clerk/Supabase là peer fixture đọc; mutations bị chặn, external network
  bị chặn, QR là fixture không thanh toán. Không dùng ảnh này chứng minh auth,
  RLS, tiền thật hoặc timestamp chụp trước khi đổi code. Các bộ thử khác cùng
  prefix không phải bộ canonical được dùng đối chiếu.
- Ảnh hiện tại: `ux/customer_menu_390.png`, `customer_cart_390.png`,
  `customer_progress_390.png`, `customer_bill_390.png`, `takeaway_menu_390.png`,
  `customer_bill_confirmation_430.png`, `takeaway_review_390.png`,
  `takeaway_manual_payment_390.png`, `staff_1194.png`, `kitchen_1194.png`.
  Fixture before/after cùng loại dữ liệu nhưng layout/trạng thái không phải mọi
  pixel đều đồng nhất; không báo pixel-diff hay kiểm thử người thật đã đạt.
- Tái tạo: `npm run test:ux:baseline`; script luôn tạo folder mới và chỉ xuất
  artifact sau khi đủ8ảnh, QR decode và không có pageerror. Chỉ chạy tại local,
  không bật source lịch sử trong ứng dụng hay thêm fallback giả vào src.
