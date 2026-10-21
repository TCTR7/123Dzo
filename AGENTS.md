# 🤖 AI AGENTS WORKFLOW & CODING GUIDELINES (123Dzô Project)

Tài liệu này định nghĩa quy tắc làm việc, tiêu chuẩn kỹ thuật và quy trình kiểm thử dành cho các AI Coding Agents (**Antigravity** - Builder và **Codex** - Reviewer) tham gia vào dự án **123Dzô**.

---

## 📌 1. NGUỒN CHÂN LÝ DUY NHẤT (SINGLE SOURCE OF TRUTH)
Trước khi thực hiện bất kỳ việc tạo file, viết code hay review nào, **BẮT BUỘC** phải đọc kỹ file:
👉 **`docs/PRO_SPEC.md`**

* **Tuyệt đối không tự ý bịa thêm bảng (tables), đổi tên cột (columns), hoặc thay đổi trạng thái (enums)** đã được quy định tại **Mục 5, Mục 11 và Mục 12** trong `docs/PRO_SPEC.md`.
* Mọi cấu trúc thư mục phải tuân thủ tuyệt đối **Mục 13** trong `docs/PRO_SPEC.md`.

---

## 🛠️ 2. HƯỚNG DẪN DÀNH CHO ANTIGRAVITY (BUILDER AGENT)

Khi triển khai tính năng cho dự án **123Dzô**, Antigravity phải tuân thủ nghiêm ngặt các quy tắc kỹ thuật và thứ tự ưu tiên sau:

### 2.1. Thứ tự triển khai từng giai đoạn (Implementation Phases)
Không viết tràn lan toàn bộ ứng dụng cùng lúc. Hãy thực hiện và kiểm tra theo từng Phase:
1. **Phase 1 (Foundation & Database):** Khởi tạo `supabase/schema.sql`, `src/types/database.types.ts`, cấu hình Supabase Client/Server (`src/lib/supabase/`) và Clerk Middleware (`src/middleware.ts`).
2. **Phase 2 (Admin Core):** Xây dựng `/admin/menu`, `/admin/inventory` (có nén ảnh WebP `< 80KB`), và quản lý bàn/khu vực.
3. **Phase 3 (Staff & Dine-in QR Flow):** Xây dựng `/staff` (Sơ đồ bàn, Mở bàn sinh `session_token` QR động, Trả bia thừa, Chuyển bàn) và `/t/[token]` (Khách gọi món tại bàn, Chia bill Campuchia, Xem vị trí hàng đợi Realtime).
4. **Phase 4 (Kitchen KDS & Web Push):** Xây dựng `/kitchen` (Chế độ Gom món trùng `Batch Cooking` & Hàng đợi `FIFO`, giữ sáng màn hình `Wake Lock API`) và API bắn thông báo đẩy (`/api/push/notify`) kèm âm thanh cho đúng nhân viên phụ trách bàn.
5. **Phase 5 (Takeaway VietQR & Analytics Dashboard):** Xây dựng `/mang-ve` kết hợp Webhook thanh toán (`/api/webhooks/payment`) và Dashboard đánh giá KPI cuối tháng tại `/admin` bằng `Recharts` + PostgreSQL Views.

### 2.2. Quy tắc Code bắt buộc (Strict Coding Standards)
* **Next.js 15 App Router:**
  * Mặc định dùng **Server Components** để fetch dữ liệu ban đầu. Chỉ thêm `'use client'` ở các component cần tương tác (Giỏ hàng Zustand, Lắng nghe Supabase Realtime, Biểu đồ Recharts, Nút bấm KDS).
  * Lưu ý trong Next.js 15: `params` và `searchParams` trong `page.tsx` / `route.ts` là **Promise** (bắt buộc phải `await params`).
* **Supabase & Realtime:**
  * Mọi kết nối `supabase.channel(...)` trong `useEffect` bắt buộc phải có hàm dọn dẹp `return () => { supabase.removeChannel(channel) }` để tránh rò rỉ kết nối (vượt quá giới hạn 200 peak connections của gói Free).
* **Logic đặc thù Quán nhậu (Không được quên):**
  * Khi tạo `order_items`: Luôn copy `price` và `cost_price` từ `menu_items` sang `unit_price` và `unit_cost_price` (Snapshot Price).
  * Khi món có `station === 'BAR_INSTANT'` (Bia, nước ngọt, khăn lạnh): Không bao giờ đẩy vào hàng đợi `QUEUED` của Bếp, mà phải set thẳng `status = 'READY'`, `ready_at = NOW()` và gọi thông báo cho nhân viên phụ trách bàn.
  * Khi Bếp hoặc Nhân viên đổi trạng thái món: Bắt buộc cập nhật đúng các cột mốc thời gian (`cooking_started_at`, `ready_at`, `served_at`, `served_by_staff_id`) để phục vụ tính KPI cuối tháng.

---

## 🔍 3. HƯỚNG DẪN DÀNH CHO CODEX (REVIEWER & QA AGENT)

Khi được yêu cầu Review code do Antigravity viết, **Codex** không sửa code theo cảm tính mà phải đối chiếu từng dòng code với `docs/PRO_SPEC.md` theo **6 tiêu chí kiểm tra (Audit Checklist)** dưới đây:

### 3.1. Kiểm tra tính toàn vẹn Schema & TypeScript (Schema Alignment)
* [ ] Tên bảng và tên cột trong các câu lệnh `.from('...').select('...')` có khớp 100% với **Mục 12** của `docs/PRO_SPEC.md` và `database.types.ts` không?
* [ ] Có bất kỳ kiểu `any` nào bị lọt vào code TypeScript không?

### 3.2. Kiểm tra Lỗ hổng Nghiệp vụ & Chống phá hoại (Security & Anti-Fraud)
* [ ] **Tại `/t/[token]`:** Đã kiểm tra trạng thái `table_sessions.status === 'ACTIVE'` trước khi cho phép khách thêm món vào `order_items` chưa? (Nếu bàn đã `CLOSED` hoặc `PENDING_PAYMENT` thì phải chặn hoàn toàn).
* [ ] **Tại `/mang-ve`:** Đơn mang về có bị lọt vào màn hình Bếp trước khi Webhook `/api/webhooks/payment` xác nhận thành công không?
* [ ] **Phân quyền (RBAC):** Nhân viên (`staff`) có bị cấp nhầm quyền xóa món đang nấu (`COOKING`) hoặc đã bưng (`SERVED`) không? (Theo Mục 7: chỉ `admin` mới được hủy món đã nấu và phải có `cancel_reason`).

### 3.3. Kiểm tra Độ chính xác của Dữ liệu KPI & Timestamps
* [ ] Khi Bếp bấm "Nhận nấu" (đơn lẻ hoặc gộp mẻ `batch_id`), cột `cooking_started_at` có được ghi nhận không?
* [ ] Khi Bếp bấm "Hoàn thành", cột `ready_at` có được ghi nhận không?
* [ ] Khi Nhân viên bấm "Đã phục vụ", cả 2 cột `served_at` và `served_by_staff_id` có được cập nhật đầy đủ không?
* [ ] Các thống kê trên Dashboard `/admin` có đang dùng **SQL Views / RPC** trên Supabase không, hay đang kéo toàn bộ bảng về trình duyệt để cộng bằng JavaScript (vi phạm Mục 10.4)?

### 3.4. Kiểm tra Hiệu năng gói Free & Trải nghiệm thực tế (UX/Performance)
* [ ] Các kênh Supabase Realtime có bị quên `removeChannel` khi unmount component không?
* [ ] Upload ảnh ở `/admin/menu` đã đi qua hàm nén ảnh WebP `< 80KB` trước khi đẩy lên Supabase Storage chưa?
* [ ] Màn hình `/kitchen` đã tích hợp `navigator.wakeLock` để chống tắt màn hình máy tính bảng chưa?
* [ ] Nút đặt món của khách đã có cơ chế chống bấm đúp (Debounce / Disable while submitting) chưa?

### 3.5. Định dạng Báo cáo Review của Codex
Khi trả kết quả review, Codex phải xuất ra theo cấu trúc:
1. **🚨 Lỗi Nghiêm trọng (Critical Bugs / Lệch Spec):** Chỉ rõ tên file, số dòng, nguyên nhân lệch với `docs/PRO_SPEC.md` và đoạn code sửa lại.
2. **⚠️ Cảnh báo Hiệu năng / Realtime (Warnings):** Các vấn đề về rò rỉ kết nối, thiếu index SQL hoặc trải nghiệm UX trên điện thoại.
3. **✅ Đánh giá Mức độ hoàn thành Phase:** Xác nhận Phase hiện tại đã đạt chuẩn để chuyển sang Phase tiếp theo hay chưa.