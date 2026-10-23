# 🤖 AI AGENTS WORKFLOW & CODING GUIDELINES (123Dzô Project)

Tài liệu này định nghĩa quy tắc làm việc, tiêu chuẩn kỹ thuật và ranh giới phạm vi dành cho các AI Coding Agents (**Antigravity** - Builder và **Codex** - Reviewer) tham gia vào dự án **123Dzô**.

---

## 📌 1. NGUỒN CHÂN LÝ DUY NHẤT & ĐỐI TƯỢNG PHỤC VỤ (SINGLE SOURCE OF TRUTH)
Trước khi thực hiện bất kỳ việc tạo file, viết code hay review nào, **BẮT BUỘC** phải đọc kỹ file:
👉 **`docs/PRD_SPEC.md`**

* **Quy mô mục tiêu:** Quán nhậu bình dân quy mô nhỏ (**dưới 10 nhân viên**, vài chục bàn). Thiết kế phải **Gọn nhẹ – Nhanh – Bấm là chạy ngay – Dễ bảo trì**.
* **5 Mục cốt lõi duy nhất của Chủ quán (`/admin`):**
  1. **Dashboard KPI (`/admin`):** Doanh thu, lợi nhuận, giờ vàng, hiệu suất Bếp & Nhân viên.
  2. **Thu ngân & Hóa đơn (`/admin/bills`):** Duyệt chuyển khoản đơn mang về (`PENDING_PAYMENT` -> `ACTIVE`), chốt bill đóng bàn, in nhiệt K80.
  3. **Thực đơn (`/admin/menu`):** Thêm/Sửa/Xóa món trực tiếp, nén ảnh WebP `< 80KB`, gạt nút hết món (`86ing`).
  4. **Kho & Xuất nhập (`/admin/inventory`):** Quản lý nguyên liệu/bia (`ingredients`) và phiếu Nhập/Hủy kho (`inventory_logs`).
  5. **Bàn & Nhân sự (`/admin/staff`):** Quản lý Khu vực (`zones`), Bàn (`tables`), và tạo tài khoản Nhân sự (`staff_profiles` + Clerk Backend API).
* **Phân hệ Bàn giao dành riêng cho Operator (`/operator`) & Hướng dẫn sử dụng (Onboarding Modal):**
  * Vai trò `operator` có toàn quyền cao hơn cả Chủ quán (`admin`), dùng trang `/operator` để kiểm tra thông tin hệ thống & `version` bản build, tạo tài khoản Chủ quán (`admin`), và xuất **Phiếu Bàn Giao (PNG / PDF)** gồm QR đăng nhập Chủ quán + QR Đặt mang về cố định (`/customer/takeaway`).
  * Hệ thống có **Popup Hướng dẫn sử dụng & Cài đặt App (PWA)** tự động bật sau khi đăng nhập lần đầu và có nút mở lại trên thanh Header chung (tách biệt với 5 mục `/admin`).
* **Tuyệt đối không tự ý bịa thêm bảng (tables), đổi tên cột (columns), thêm trạng thái (enums), hoặc viết thêm các PL/pgSQL RPC phức tạp** ngoài **8 bảng cốt lõi ở Mục 12** và **5 Views/RPC KPI ở Mục 11** trong `docs/PRD_SPEC.md`.
* Mọi cấu trúc thư mục phải tuân thủ tuyệt đối **Mục 13** trong `docs/PRD_SPEC.md`.
* Mọi task khi thực hiện phải qua bước Kiểm soát overthinking và công việc không thiết yếu: tuân thủ tuyệt đối trong `docs/FOCUSED_EXECUTION_GUIDE_EN.md`.

---

## 🚫 2. CÁC HÀNH VI OVER-ENGINEERING BỊ NGHIÊM CẤM (STRICT ANTI-BLOAT RULES)

Để tránh làm dự án phình to và đi chệch hướng, **CẢ ANTIGRAVITY VÀ CODEX TUYỆT ĐỐI KHÔNG ĐƯỢC**:
1. **Không tạo sổ cái thao tác (`private.operation_requests`) hay khóa nút bấm bằng `localStorage` journal:** Khi bấm Thêm/Sửa/Xóa, chỉ disable nút trong lúc đang chờ HTTP/Supabase response (`isSubmitting`). Nếu lỗi thì hiện thông báo lỗi và cho phép bấm lại ngay, tuyệt đối không khóa chết giao diện bắt "đối soát lượt trước".
2. **Không nhét CRUD vào Stored Procedures (PL/pgSQL RPC):** Các thao tác Thêm/Sửa/Xóa món ăn, bàn, khu vực, nhân sự, xuất nhập kho, mở/đóng bàn phải thực hiện trực tiếp bằng Supabase JS (`supabase.from('...').select/insert/update/delete`) trong Next.js API / Server Actions. Chỉ giữ lại 5 Views & 5 RPC tính toán báo cáo KPI ở `supabase/schema.sql`.
3. **Không vẽ thêm trang quản trị kỹ thuật ngoài 5 mục cốt lõi:** Cấm tạo thêm các trang như `/admin/release` (Đối soát dữ liệu), `/admin/notifications` (Quản lý job thông báo), `/admin/payments` tách rời khỏi `/admin/bills`.
4. **Không tự ghi thêm "Amendment" vào `docs/PRD_SPEC.md` hoặc sinh thêm các file tài liệu kế hoạch/audit phụ trong `docs/`** khi chưa có yêu cầu trực tiếp từ người dùng.

---

## 🛠️ 3. HƯỚNG DẪN DÀNH CHO ANTIGRAVITY (BUILDER AGENT)

### 3.1. Thứ tự triển khai & Hoàn thiện (Implementation Phases)
1. **Phase 1 (Foundation & Database):** Giữ `supabase/schema.sql` gọn sạch (~600 dòng với 8 bảng + 5 KPI Views/RPC), `src/types/database.types.ts`, cấu hình Supabase (`src/lib/supabase/`) và Clerk Middleware (`src/middleware.ts`).
2. **Phase 2 (Admin 5 Mục Cốt Lõi):** Hoàn thiện `/admin` (KPI Dashboard), `/admin/bills` (Hóa đơn), `/admin/menu` (Thực đơn + nén ảnh WebP `< 80KB`), `/admin/inventory` (Kho), `/admin/staff` (Khu vực, Bàn & Nhân sự).
3. **Phase 3 (Staff & Dine-in QR Flow):** Xây dựng `/staff` (Sơ đồ bàn, Mở bàn sinh `session_token` QR động, Trả bia thừa, Chuyển bàn) và `/customer/order/[token]` (Khách gọi món tại bàn, Chia bill Campuchia, Xem vị trí hàng đợi Realtime).
4. **Phase 4 (Kitchen KDS & Web Push):** Xây dựng `/kitchen` (Chế độ Gom món trùng `Batch Cooking` & Hàng đợi `FIFO`, giữ sáng màn hình `Wake Lock API`) và API bắn thông báo đẩy (`/api/push/notify`) kèm âm thanh cho đúng nhân viên phụ trách bàn.
5. **Phase 5 (Takeaway VietQR & Analytics Dashboard):** Xây dựng `/customer/takeaway` kết hợp Webhook thanh toán (`/api/webhooks/payment`) và Dashboard đánh giá KPI cuối tháng tại `/admin` bằng `Recharts` + PostgreSQL Views.

### 3.2. Quy tắc Code bắt buộc (Strict Coding Standards)
* **Next.js 15 App Router:**
  * Mặc định dùng **Server Components** để fetch dữ liệu ban đầu. Chỉ thêm `'use client'` ở các component cần tương tác.
  * Lưu ý trong Next.js 15: `params` và `searchParams` trong `page.tsx` / `route.ts` là **Promise** (bắt buộc phải `await params`).
* **Supabase & Realtime:**
  * Mọi kết nối `supabase.channel(...)` trong `useEffect` bắt buộc phải có hàm dọn dẹp `return () => { supabase.removeChannel(channel) }` để tránh rò rỉ kết nối.
* **Logic đặc thù Quán nhậu (Không được quên):**
  * Khi tạo `order_items`: Luôn copy `price` và `cost_price` từ `menu_items` sang `unit_price` và `unit_cost_price` (Snapshot Price).
  * Khi món có `station === 'BAR_INSTANT'` (Bia, nước ngọt, khăn lạnh): Không đẩy vào hàng đợi `QUEUED` của Bếp, mà set thẳng `status = 'READY'`, `ready_at = NOW()` và gọi thông báo cho nhân viên phụ trách bàn.
  * Khi Bếp hoặc Nhân viên đổi trạng thái món: Bắt buộc cập nhật đúng các cột mốc thời gian (`cooking_started_at`, `ready_at`, `served_at`, `served_by_staff_id`) để phục vụ tính KPI cuối tháng.

---

## 🔍 4. HƯỚNG DẪN DÀNH CHO CODEX (REVIEWER & QA AGENT)

Khi được yêu cầu Review code, **Codex** phải đóng vai trò bảo vệ sự đơn giản và tính thực tế cho **quán nhậu nhỏ < 10 nhân viên**, đối chiếu với `docs/PRD_SPEC.md` theo các tiêu chí sau (tuyệt đối **không** đề xuất kiến trúc enterprise phức tạp):

### 4.1. Kiểm tra tính toàn vẹn Schema & TypeScript (Schema Alignment)
* [ ] Tên bảng và tên cột trong các câu lệnh `.from('...').select('...')` có khớp 100% với **8 bảng tại Mục 12** của `docs/PRD_SPEC.md` và `database.types.ts` không? (Không truy vấn các cột không tồn tại như `activated_at` hay `stock_export_log_id`).
* [ ] Có bất kỳ kiểu `any` nào bị lọt vào code TypeScript không?

### 4.2. Kiểm tra Nghiệp vụ Cốt lõi (Core Business Rules)
* [ ] **Tại `/customer/order/[token]`:** Đã kiểm tra trạng thái `table_sessions.status === 'ACTIVE'` trước khi cho phép khách thêm món vào `order_items` chưa?
* [ ] **Tại `/customer/takeaway`:** Đơn mang về có ở trạng thái `PENDING_PAYMENT` trước khi xác nhận thanh toán không?
* [ ] **Phân quyền (RBAC):** Nhân viên (`staff`) chỉ hủy được món `QUEUED`; chỉ `admin` mới được hủy món đã `COOKING` hoặc `SERVED` (kèm `cancel_reason`).

### 4.3. Kiểm tra Độ chính xác của Dữ liệu KPI & Timestamps
* [ ] Khi Bếp bấm "Nhận nấu" (đơn lẻ hoặc gộp mẻ `batch_id`), cột `cooking_started_at` có được ghi nhận không?
* [ ] Khi Bếp bấm "Hoàn thành", cột `ready_at` có được ghi nhận không?
* [ ] Khi Nhân viên bấm "Đã phục vụ", cả 2 cột `served_at` và `served_by_staff_id` có được cập nhật đầy đủ không?
* [ ] Các thống kê trên Dashboard `/admin` có đang dùng **5 SQL Views / 5 RPC** trên Supabase không?

### 4.4. Kiểm tra Trải nghiệm thực tế (UX/Performance)
* [ ] Các nút Thêm / Sửa / Xóa ở `/admin/menu`, `/admin/inventory`, `/admin/staff`, `/admin/bills` có bấm ăn ngay mà không bị khóa chết bởi `localStorage` không?
* [ ] Các kênh Supabase Realtime có `removeChannel` khi unmount component không?
* [ ] Upload ảnh ở `/admin/menu` đã nén WebP `< 80KB` trước khi đẩy lên Supabase Storage chưa?
* [ ] Màn hình `/kitchen` đã tích hợp `navigator.wakeLock` chưa?

### 4.5. Định dạng Báo cáo Review của Codex
Khi trả kết quả review, Codex phải xuất ra ngắn gọn, đúng trọng tâm:
1. **🚨 Lỗi Nghiêm trọng (Critical Bugs / Lệch Spec 8 bảng gốc):** Chỉ rõ tên file, số dòng, nguyên nhân lệch với `docs/PRD_SPEC.md` và đoạn code sửa lại đơn giản nhất.
2. **⚠️ Cảnh báo Hiệu năng / UX:** Các vấn đề về rò rỉ kết nối Realtime hoặc nút bấm bị kẹt.
3. **✅ Đánh giá Mức độ hoàn thành:** Xác nhận tính năng đã hoạt động mượt mà cho quán nhỏ hay chưa (Không đẻ thêm yêu cầu ngoài phạm vi `docs/PRD_SPEC.md`).
