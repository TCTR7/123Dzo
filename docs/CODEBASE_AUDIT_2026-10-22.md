# Ghi nhận Full Codebase Audit — 123Dzô

Ngày lưu: 2026-10-22 (Asia/Bangkok).
Nguồn: kết quả review và chạy test trong cuộc hội thoại trước khi lưu tài liệu này.
Trạng thái: các phát hiện chưa được sửa hoặc nghiệm thu lại.

## Phạm vi và giới hạn

Đã đối chiếu AGENTS.md, docs/PRD_SPEC.md, schema/seed, types, Auth/RBAC,
pages/API, components, store, utilities và bộ test. AGENTS.md tham chiếu
docs/PRO_SPEC.md nhưng file thực tế là docs/PRD_SPEC.md.
Không kiểm tra trực tiếp policy/Clerk/database đang triển khai. Không sửa code
ứng dụng, chạy seed hay áp migration trong audit.

## Kết luận

Chưa sẵn sàng Production. TypeScript và unit test pass chưa chứng minh được
tính an toàn của phân quyền, thanh toán, bill và tồn kho.

## Các phát hiện ưu tiên

- **AUD-01 / P0 — Mặc định cấp Admin.** src/middleware.ts:67;
  src/lib/supabase/sync-staff.ts:40,81. Thiếu role hoặc lỗi đồng bộ dẫn tới
  quyền admin. Page/layout không chặn isActive=false. Cần deny-by-default,
  cấp quyền nhân sự có chủ đích và thống nhất nguồn role Clerk/DB.
- **AUD-02 / P0 — Thiếu RLS và bảo vệ nghiệp vụ ở DB.** supabase/schema.sql;
  src/lib/supabase/client.ts:35. Schema không khai báo RLS/policy và browser
  client chưa nối danh tính Clerk. Client trực tiếp ghi giá, món, bill, kho,
  nhân sự. Middleware Next.js không bảo vệ API Supabase. Cần RLS, quyền
  views/RPC phù hợp và server/RPC có xác thực, transaction, snapshot từ DB.
  Mức khai thác ở deployment phụ thuộc grants/policy ngoài repository.
- **AUD-03 / P0 — Chọn đơn bằng trường ngoài phần ký.**
  src/app/api/webhooks/payment/route.ts:127,179. PayOS xác minh data nhưng
  ưu tiên payment_code ngoài data để tìm phiên. Cần parser riêng cho provider,
  chỉ dùng dữ liệu đã xác thực, kiểm tra thành công/chiều tiền/tài khoản nhận
  và chống replay bằng định danh giao dịch. Thay đổi schema phải cập nhật spec.
- **AUD-04 / P1 — Thanh toán không nguyên tử.** payment/route.ts:237–318.
  ACTIVE được ghi trước món/kho/log; retry bỏ qua phần dang dở. Lỗi DB bị
  nhầm là idempotent. Có thể ghi lại QUEUED sau khi bếp đã nhận nấu.
  Cần transaction khóa phiên và chỉ commit toàn bộ khi thành công.
- **AUD-05 / P1 — Chốt bill từ dữ liệu bị cắt.**
  src/app/(auth-protected)/admin/bills/page.tsx:25–26 tải 500 món cũ nhất;
  staff/page.tsx:45–46 tải 300 món mới nhất toàn quán. BillsManager.tsx:332
  và StaffDashboard.tsx:838 ghi tổng từ tập con. DineInOrderView.tsx:476 còn
  cộng vào tổng state cũ. Cần tính tổng theo phiên trong DB, khóa phiên khi chốt.
- **AUD-06 / P1 — Mất cập nhật tồn kho.** DineInOrderView.tsx:427;
  StaffDashboard.tsx:466; InventoryManager.tsx:332. Read-modify-write từ state,
  Math.max(0, stock-quantity), ghi stock/log riêng gây lệch tồn và nhật ký.
  Cần cập nhật số học có kiểm tra đủ tồn trong cùng transaction.
- **AUD-07 / P1 — Đổi trạng thái không kiểm tra trạng thái cũ tại DB.**
  StaffDashboard.tsx:809; KitchenKdsBoard.tsx:406,448. Staff có thể hủy món
  đã chuyển COOKING từ màn hình cũ; bếp có thể ghi đè món đã hủy.
  Cần expected-state condition, quyền actor và timestamp do server/DB thực thi.
- **AUD-08 / P1 — Push/audio chưa hoàn chỉnh.** Khách anonymous gọi notify
  nhưng middleware yêu cầu login. Thiếu đăng ký SW/subscription và nhận push
  ở client. Webhook READY đồ uống chưa gửi push. notify/route.ts:117 dùng
  setTimeout không bền vững. public/sounds/ting-ting.mp3 chỉ 16 byte.
- **AUD-09 / P1 — Tài khoản nhận tiền giả fallback.**
  TakeawayOrderView.tsx:54–59. Thiếu env vẫn sinh QR với số mặc định.
  Cần khóa thanh toán khi chưa cấu hình hợp lệ.

## Cảnh báo bổ sung

- DineInOrderView.tsx:178 thêm món QUEUED vào queue realtime mà không kiểm tra
  phiên đã thanh toán; KDS có lọc phiên riêng.
- schema.sql chỉ publish order_items/table_sessions, chưa publish menu_items
  dù client cần cập nhật 86ing.
- KitchenKdsBoard.tsx:184 callback đóng trên sessionMap cũ, effect chỉ phụ
  thuộc supabase; bàn mới có thể không phát âm thanh món mới.
- Mở/chuyển/đóng bàn có nhiều request rời nhau, chưa khóa bàn/phiên.
- AdminKpiDashboard.tsx:65 không đổi peakHours khi lọc thời gian.
- Admin page bỏ qua lỗi truy vấn, dùng KPI mặc định bằng 0.
- Rate limit chỉ nằm trên trình duyệt; chưa bảo vệ theo phiên ở server.
- useCartStore.updateNote cập nhật mọi dòng cùng menu_item_id.
- Một số nút chỉ 36px; kiểm tra ảnh dùng >80KB cho phép đúng 80KB.
- Thiếu service worker và icon mà manifest tham chiếu.
- seed.sql có dữ liệu demo, token cố định và upsert reset tồn/trạng thái;
  không dùng lại trên dữ liệu vận hành. Ví dụ bill VIP 986.000 khác tổng
  chi tiết 978.000. Không coi seed là dữ liệu đối soát production.
- Service-role client fallback anon key che giấu cấu hình thiếu.

## Những điểm đã triển khai

- Các bảng/cột/union được kiểm tra khớp schema/type/spec; không thấy any
  tường minh trong src. Có ép kiểu runtime cần thận trọng.
- Năm kênh Realtime có removeChannel cleanup.
- KDS có Wake Lock và xin lại khi visibilitychange.
- Các luồng tạo món có copy giá bán/giá vốn; nấu/xong/phục vụ có timestamp.
  Dữ liệu vẫn cần được bảo vệ tại server/DB.
- Dashboard dùng năm vw_kpi_* và RPC, không tải toàn bộ order_items để tổng hợp.

## Kiểm thử đã thực hiện

```text
npx tsc --noEmit
Exit code: 0; không có diagnostics.

npm run test:unit
business_rules: 6 passed
cart_store: 6 passed
utils: 9 passed
webhook_payment: 4 passed
api_routes: 2 passed
Test Files: 5 passed (5)
Tests: 27 passed (27)
Duration: 7.18s

vitest run --coverage
MISSING DEPENDENCY: @vitest/coverage-v8
```

Đây là log audit trước, không phải một lần chạy mới ngày lưu tài liệu.
Chưa đo được tỷ lệ coverage; chưa chạy Playwright. Không dùng HTML report cũ
làm kết quả mới. tsconfig loại trừ unit_test/automation_test.

business_rules test lại hàm tự viết trong test, không gọi production logic.
Coverage config chỉ bao gồm src/lib/**/*.ts. Thiếu test Auth/RLS, inactive,
concurrency, partial failure và webhook giả mạo/replay.

POM có BasePage và module page objects nhưng nhiều test chỉ kiểm tra URL,
chấp nhận cả admin/sign-in hoặc 500. Test takeaway không thực hiện đặt món;
test localStorage tự ghi rồi đọc. Browser route mocks không thay thế SSR
queries. Fixture có cột sai cancelled_by_staff_id/returned_quantity và chưa
mô phỏng đầy đủ filter/cardinality. Một số locator đã lệch UI.

## Cổng nghiệm thu

Phase 1–5 đều chưa được duyệt Production. Thứ tự: P0 → transaction bill/kho/
thanh toán → push/audio → integration test DB/RLS và E2E theo từng role.
Đọc thêm CUSTOMER_UX_REVIEW_2026-10-22.md cho review trải nghiệm tiếp theo.
