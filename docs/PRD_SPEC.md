# 🍻 TÀI LIỆU ĐẶC TẢ NGHIỆP VỤ & KỸ THUẬT TOÀN DIỆN (PRD & TECH SPEC)

**Tên dự án:** Hệ thống Quản lý Quán nhậu, Gọi món QR & Điều phối Bếp thời gian thực (Smart POS & KDS PWA)  
**Phiên bản:** 2.19 (Durable public request limits, 2026-10-23)
**Trạng thái:** Đã chốt nghiệp vụ & Kiến trúc dữ liệu  

---

## 1. TỔNG QUAN & MỤC ĐÍCH DỰ ÁN (PROJECT OVERVIEW)

### 1.1. Bối cảnh & Nỗi đau thực tế (Pain Points)
Các quán nhậu truyền thống thường gặp 5 vấn đề lớn khi vận hành:
1. **Quá tải nhân sự chạy bàn:** Khách gọi thêm bia, thêm mồi hoặc gọi tính tiền nhưng nhân viên không nghe thấy hoặc quên ghi.
2. **Mù mờ thông tin giữa Bếp và Khách:** Khách không biết món mình gọi đã được nấu chưa hay bị quên đơn; Bếp thì nấu lẻ tẻ từng đĩa giống nhau cho các bàn khác nhau gây tốn gas, tốn thời gian.
3. **Rủi ro phá hoại khi dùng QR tĩnh:** Các hệ thống gắn QR cố định trên bàn dễ bị kẻ gian chụp ảnh mã QR về nhà đặt đơn ảo để phá quán.
4. **Thất thoát nguyên liệu & tiền bạc:** Khó kiểm soát lượng bia trả lại, xuất nhập kho nguyên liệu tươi sống và đối soát chuyển khoản ngân hàng.
5. **Thiếu số liệu đánh giá cuối tháng:** Chủ quán không biết chính xác món nào lãi nhiều, bia nào bán chạy, đầu bếp nấu nhanh hay chậm, nhân viên nào chăm chỉ hay lơ là.

### 1.2. Mục tiêu giải pháp (Project Goals)
Xây dựng một ứng dụng **Web kết hợp PWA (Progressive Web App)** duy nhất cho cả 4 đối tượng (Admin, Nhân viên, Bếp, Khách hàng) với chi phí vận hành hạ tầng **0 đồng/tháng** (tối ưu trên Free Tier của các nền tảng SaaS):
* **An toàn tuyệt đối:** Chặn 100% đơn ảo bằng cơ chế **QR Động theo phiên (Dine-in)** và **Thanh toán VietQR trước 100% (Takeaway)**.
* **Minh bạch thời gian thực (Realtime):** Khách biết món của mình đang xếp thứ mấy trong bếp; Đầu bếp gom được các món trùng nhau để nấu 1 mẻ; Nhân viên nhận thông báo đẩy (Push Notification) có âm thanh ngay khi món chín.
* **Đo lường hiệu suất tự động (Data-Driven KPI):** Ghi nhận tự động mọi mốc thời gian (Timestamps) và giá lịch sử (Snapshot Prices) để xuất Dashboard đánh giá Doanh thu, Món bán chạy, Hiệu suất Bếp và Nhân viên vào cuối tháng.

---

## 2. TỪ ĐIỂN THUẬT NGỮ DỰ ÁN (GLOSSARY)
Mọi thành viên và AI Agent thống nhất sử dụng các khái niệm sau trong giao tiếp và đặt tên biến:

* **`Zone` (Khu vực):** Phân khu trong quán (VD: Khu Sân vườn, Khu Trong nhà, Phòng VIP) để phân công nhân viên phụ trách.
* **`Table` (Bàn vật lý):** Bàn thật trong quán (Bàn 1, Bàn 2...), thuộc về một `Zone`.
* **`Table Session` (Phiên nhậu):** Một lượt khách ngồi vào bàn (từ lúc Mở bàn đến lúc Thanh toán xong) hoặc một đơn đặt mang về. Mã QR của khách gắn với `Table Session`, không gắn cố định với `Table`.
* **`Order Item` (Món gọi):** Đơn vị nhỏ nhất để Bếp chế biến (Ví dụ: "1 đĩa Ếch xào sả ớt của Bàn 5"). Hệ thống quản lý trạng thái và đo lường thời gian theo từng `Order Item`.
* **`Batch Cooking` (Nấu gộp mẻ):** Việc đầu bếp gom nhiều `Order Item` giống nhau của các bàn khác nhau để chế biến trong 1 lần chảo (gắn chung `batch_id`).
* **`Station` (Trạm xử lý):** Phân loại món ăn sẽ chạy về đâu: `KITCHEN` (Món nấu -> Chạy vào màn hình Bếp) hoặc `BAR_INSTANT` (Bia, nước ngọt, khăn lạnh -> Báo thẳng cho nhân viên chạy bàn tự lấy).

---

## 3. CÁC VẤN ĐỀ CỐT LÕI & GIẢI PHÁP NGHIỆP VỤ (CORE SOLUTIONS)

### 3.1. Chống phá hoại khi Khách gọi món không cần đăng nhập
Hệ thống chia làm 2 luồng độc lập hoàn toàn:

* **Luồng 1 - Khách ngồi tại bàn (Dine-in):**
  * Không dán QR gọi món cố định trên bàn.
  * Khi khách vào bàn, Nhân viên phụ trách khu vực bấm **"Mở bàn"** trên PWA Nhân viên -> Hệ thống tạo `table_sessions` mới (`session_type = 'DINE_IN'`) và sinh ra một đường dẫn chứa `session_token` ngẫu nhiên (VD: `/customer/order/k9x2m8p1`) dưới dạng **Mã QR động**.
  * Nhân viên đưa màn hình điện thoại (hoặc phiếu in nhiệt) cho khách quét. Khách đầu tiên quét xong có thể bấm *"Hiện mã QR bàn"* trên máy mình cho bạn nhậu cùng bàn quét theo để vào chung giỏ hàng.
  * Khi bàn thanh toán xong, `session_token` lập tức chuyển sang trạng thái `CLOSED` và vô hiệu hóa vĩnh viễn.

* **Luồng 2 - Khách đặt từ xa / Mang về (Takeaway):**
  * Sử dụng 1 mã QR / Đường dẫn tĩnh duy nhất (`/customer/takeaway`).
  * Khách chọn món, nhập Tên + Số điện thoại -> Hệ thống tạo `table_sessions` (`session_type = 'TAKEAWAY'`, `status = 'PENDING_PAYMENT'`) và sinh mã **VietQR động**.
  * Đơn hàng ở trạng thái `PENDING_PAYMENT` **không** hiển thị ở màn hình Bếp.
  * Chỉ khi khách chuyển khoản thành công, hệ thống nhận Webhook từ cổng thanh toán (PayOS/SePay) sau 2-5 giây thì đơn mới tự động chuyển sang `ACTIVE`, các món ăn chuyển sang `QUEUED` và đẩy vào hàng đợi của Bếp.

### 3.2. Phân công Nhân viên theo Bàn & Định tuyến Thông báo (Targeted Notification)
* Đầu ca làm việc, nhân viên được phân công theo Khu vực (`Zone`) hoặc nhận bàn trực tiếp khi bấm "Mở bàn" (`assigned_staff_id`).
* Khi Bếp bấm **"Nấu xong"** một món của Bàn 5 -> Hệ thống kiểm tra `assigned_staff_id` của Bàn 5 và **chỉ gửi Web Push Notification** đến đúng điện thoại của nhân viên đang phụ trách Bàn 5.
* **Cơ chế chống sót việc (Fallback):** Nếu sau **2 phút** kể từ khi món chín (`ready_at`) mà nhân viên phụ trách chưa bấm *"Đã bưng ra"* (`served_at IS NULL`), hệ thống gửi thông báo lần 2 cho toàn bộ nhân viên trong cùng Khu vực (`Zone`) để hỗ trợ bưng hộ.
* **Ghi nhận người bưng thực tế:** Ai là người bấm nút *"Đã bưng ra"* thì lưu ID người đó vào cột `served_by_staff_id` để cuối tháng tính KPI chạy bàn công bằng.

---

## 4. DANH SÁCH USER STORIES THEO VAI TRÒ

### 4.1. Khách hàng (Customer - Không cần đăng nhập)
* **US-C01 (Gọi món tại bàn):** Quét mã QR từ nhân viên để vào thẳng thực đơn của bàn mình và đặt món ngay mà không cần tạo tài khoản hay chọn lại số bàn.
* **US-C02 (Chia sẻ phiên gọi món):** Hiển thị lại mã QR của bàn mình trên điện thoại để bạn nhậu ngồi cùng bàn quét và cùng chọn món vào chung 1 hóa đơn.
* **US-C03 (Theo dõi tiến độ Bếp):** Thấy từng món ăn của mình đang xếp ở **vị trí thứ mấy** trong hàng đợi bếp, món nào bếp **đang nấu**, và **ước lượng bao nhiêu phút nữa** sẽ hoàn thành.
* **US-C04 (Yêu cầu thanh toán):** Xem tổng tiền tạm tính theo thời gian thực và bấm nút *"Gọi tính tiền"* (chọn Tiền mặt hoặc Chuyển khoản QR) ngay trên PWA để nhân viên mang bill ra.
* **US-C05 (Đặt mang về):** Chọn món qua link `/customer/takeaway`, thanh toán trước qua mã VietQR tự động và theo dõi trên màn hình xem khi nào bếp nấu xong để canh giờ ghé quán lấy đồ.

### 4.2. Nhân viên phục vụ (Waitstaff - Đăng nhập qua Clerk)
* **US-S01 (Quản lý khu vực & Mở bàn):** Nhận bàn theo khu vực đầu ca và bấm "Mở bàn" khi có khách vào để lấy mã QR động cho khách.
* **US-S02 (Order hộ khách):** Tự bấm chọn món thêm vào bàn giúp những khách hàng lớn tuổi không quen dùng điện thoại.
* **US-S03 (Nhận thông báo món chín & Đồ uống):** Điện thoại rung và kêu thông báo ngay khi: (1) Bếp nấu xong món của bàn mình quản lý, hoặc (2) Khách ở bàn đó gọi thêm Bia/Nước ngọt/Khăn lạnh (`BAR_INSTANT`).
* **US-S04 (Chuyển bàn / Trả bia thừa / Chuyển quyền quản lý):** Đổi số bàn cho khách khi khách đổi chỗ ngồi, trừ lại số lon bia khách không uống hết, hoặc bàn giao bàn cho đồng nghiệp khác khi đổi ca.

### 4.3. Đầu bếp (Kitchen / KDS - Đăng nhập qua Clerk trên Tablet)
* **US-K01 (Xem hàng đợi & Gom món trùng):** Màn hình tự động gom nhóm các món giống nhau đang chờ của nhiều bàn (VD: *"Ếch xào sả ớt - Tổng: 3 đĩa [Bàn 1, Bàn 4, Mang về #2]"*) để bấm **"Nấu gộp cả 3"** trong một lần đứng bếp.
* **US-K02 (Cập nhật trạng thái 1 chạm):** Bấm 1 nút khi bắt đầu nấu (`COOKING`) và bấm 1 nút khi đã gắp ra đĩa xong (`READY`) để gọi nhân viên vào bưng và cập nhật tiến độ cho khách.
* **US-K03 (Báo hết món nhanh - 86ing):** Khi nguyên liệu trong bếp vừa hết, gạt nút *"Tạm hết hàng"* của món đó ngay trên màn hình bếp để menu của khách lập tức khóa món đó lại.

### 4.4. Quản trị viên / Chủ quán (Admin & Cashier - Đăng nhập qua Clerk)
* **US-A01 (Quản lý Thực đơn & Định lượng):** Thêm/sửa/xóa món ăn, cài đặt giá vốn (`cost_price`), giá bán (`price`), thời gian nấu chuẩn (`prep_time_minutes`), và phân loại trạm xử lý (`KITCHEN` hay `BAR_INSTANT`).
* **US-A02 (Quản lý Kho & Hóa đơn Xuất/Nhập):** Tạo phiếu nhập hàng (bia, thịt, hải sản...), phiếu xuất/hủy hàng hỏng và theo dõi tồn kho tự động trừ khi bán hàng.
* **US-A03 (Quản lý Nhân sự & Phân quyền):** Thêm tài khoản nhân viên, phân vai trò (`admin`, `staff`, `kitchen`) và xem lịch sử thao tác.
* **US-A04 (Thu ngân & In hóa đơn):** Nhận thông báo khi bàn bấm tính tiền, đối soát tiền mặt/chuyển khoản và bấm in bill nhiệt đóng phiên bàn.
* **US-A05 (Xem Dashboard & Đánh giá KPI cuối tháng):** Xem biểu đồ doanh thu, lợi nhuận ròng, bảng xếp hạng mồi bén/bia chạy, đánh giá tốc độ nấu của Bếp và độ nhạy bén của từng Nhân viên.

---

## 5. VÒNG ĐỜI TRẠNG THÁI DỮ LIỆU (STATE MACHINE)

### 5.1. Trạng thái của một Phiên bàn (`table_sessions.status`)
* `PENDING_PAYMENT` : Chỉ dùng cho đơn Mang về khi khách vừa tạo đơn nhưng chưa chuyển khoản xong.
* `ACTIVE` : Bàn đang mở (hoặc đơn mang về đã thanh toán xong), khách có thể gọi món và theo dõi bếp.
* `REQUEST_BILL` : Khách tại bàn đã bấm yêu cầu thanh toán trên PWA, chờ nhân viên kiểm tra bia thừa và chốt bill.
* `CLOSED` : Đã thanh toán xong, bàn trống trở lại, mã QR của phiên này bị vô hiệu hóa hoàn toàn.

### 5.2. Trạng thái của một Món ăn (`order_items.status`) & Mốc thời gian (Timestamps)
```text
[Khách/NV đặt món] (Lưu: created_at)
       │
       ├─── (Nếu là Đồ uống/Lấy ngay: station = BAR_INSTANT) ──────────────┐
       │                                                                   ▼
       ▼ (Nếu là Món nấu: station = KITCHEN)                        [ 3. READY ] (Lưu: ready_at)
[ 1. QUEUED ] (Đang xếp hàng chờ bếp - Tính số thứ tự chờ ở đây)     (Báo NV bưng ra)
       │                                                                   │
       ▼ (Bếp bấm "Nhận nấu" đơn lẻ hoặc "Nấu gộp mẻ")                     ▼ (NV bấm "Đã giao")
[ 2. COOKING ] (Lưu: cooking_started_at)                            [ 4. SERVED ] (Lưu: served_at)
       │
       └────── (Bếp bấm "Hoàn thành") ─────────────────────────────────────▲
```
*(Ghi chú: Trạng thái `CANCELLED` lưu thêm `cancelled_at`, `cancelled_by` và `cancel_reason`. Chỉ Nhân viên/Admin được hủy khi `status = 'QUEUED'`. Nếu đã sang `COOKING` hoặc `SERVED`, chỉ Admin mới có quyền hủy).*

### 5.3. Công thức tính "Vị trí hàng đợi" hiển thị cho Khách
Với một món `X` của khách đang ở trạng thái `QUEUED`:
* **Vị trí chờ** = (Tổng số `order_items` của toàn quán có `status = 'QUEUED'` VÀ `station = 'KITCHEN'` VÀ `created_at < X.created_at`) + 1.

---

## 6. CÁC TRƯỜNG HỢP ĐẶC BIỆT CẦN XỬ LÝ (EDGE CASES)

1. **Khách gọi Bia / Nước ngọt / Khăn lạnh (`BAR_INSTANT`):** Tuyệt đối không đẩy vào màn hình của Đầu bếp. Hệ thống kiểm tra `menu_items.station == 'BAR_INSTANT'` thì gán thẳng `status = 'READY'`, `ready_at = NOW()` và bắn thông báo cho Nhân viên phụ trách bàn đó tự lấy mang ra.
2. **Trả lại bia thừa cuối buổi:** Nhân viên vào chi tiết bill, chọn chức năng *"Trả đồ uống"*, nhập số lượng trả (VD: gọi 24 lon, trả 6 lon -> cập nhật `quantity = 18` trong `order_items`, cộng trả 6 lon vào tồn kho `ingredients` và ghi log `inventory_logs`).
3. **Khách đổi bàn:** Nhân viên bấm *"Chuyển bàn"* từ Bàn 2 sang Bàn 15. Hệ thống cập nhật `table_id = 15` trong bảng `table_sessions`. Mã QR khách đang cầm vẫn giữ nguyên hiệu lực, và các món đang nấu trong bếp tự động đổi nhãn hiển thị sang "Bàn 15".
4. **Chống lệch báo cáo khi thay đổi giá Menu (Snapshot Price):** Khi tạo `order_items`, bắt buộc phải copy `price` và `cost_price` từ bảng `menu_items` sang cột `unit_price` và `unit_cost_price` của bảng `order_items`. Cuối tháng tính doanh thu/lợi nhuận phải tính trên cột của `order_items` để việc Admin tăng/giảm giá menu vào giữa tháng không làm sai lệch hóa đơn cũ.
5. **Đặt món trùng lặp do bấm nhầm (Debounce & Rate Limit):** Chặn nút "Đặt món" ngay khi bấm (Disable button) và giới hạn mỗi phiên không gửi quá 2 lượt đặt món trong vòng 10 giây.

---

## 7. MA TRẬN PHÂN QUYỀN (RBAC MATRIX)

| Tính năng / Hành động | Khách (Token) | Phục vụ (`staff`) | Đầu bếp (`kitchen`) | Admin (`admin`) |
| :--- | :---: | :---: | :---: | :---: |
| Xem Menu & Đặt món thêm vào bàn | ✅ (Khi phiên mở) | ✅ | ❌ | ✅ |
| Mở bàn mới & Tạo mã QR phiên | ❌ | ✅ | ❌ | ✅ |
| Xem hàng đợi Bếp & Bấm Nấu / Xong | ❌ | ❌ | ✅ | ✅ |
| Bấm "Báo hết món tạm thời" (86ing) | ❌ | ❌ | ✅ | ✅ |
| Hủy món đang chờ (`QUEUED`) | ❌ | ✅ | ❌ | ✅ |
| Hủy món đang nấu/đã nấu (`COOKING`/`SERVED`) | ❌ | ❌ | ❌ | ✅ (Cần lý do) |
| Chuyển bàn / Trả lại bia thừa | ❌ | ✅ | ❌ | ✅ |
| Chốt thanh toán & Đóng phiên bàn | ❌ (Chỉ gửi yêu cầu) | ✅ | ❌ | ✅ |
| Quản lý Kho, Nhập xuất hàng, Sửa giá Menu | ❌ | ❌ | ❌ | ✅ |
| Xem Dashboard Doanh thu & KPI cuối tháng | ❌ | ❌ | ❌ | ✅ |

---

## 8. CÔNG NGHỆ SỬ DỤNG & KIẾN TRÚC (TECH STACK)

### Amendment Auth foundation — 2026-10-22

Người dùng đã yêu cầu bắt đầu triển khai master plan. Phần amendment này chốt
A-01 và phần server configuration của A-02; các bổ sung schema/payment/return
khác của M-01 chưa được triển khai hoặc coi là hoàn tất.

- Clerk xác thực user ID. `staff_profiles.role` và `is_active` là nguồn quyền
  nghiệp vụ; Clerk metadata không được cấp hoặc ghi đè quyền DB.
- Đăng nhập/đăng ký không tự insert/upsert nhân sự. Chưa có profile, role không
  hợp lệ hoặc inactive đều bị chặn. Lỗi Clerk/DB/config phải fail closed.
- Middleware chỉ kiểm tra đăng nhập; từng protected page phải kiểm tra role
  và active **trước khi tạo data client/fetch**. Layout không thay thế guard
  của page vì layout và page có thể thực thi song song.
- Page admin chỉ admin; staff cho staff/admin; kitchen cho kitchen/admin.
  Role khác được chuyển tới trang mặc định của role DB. Không có quyền tới
  `/access-denied`; không có phiên đăng nhập tới `/sign-in`.
- `/access-denied` là trang công khai không trả dữ liệu nội bộ, phân biệt
  chưa được cấp quyền với tạm thời chưa xác minh được. Không tự mở quyền
  khi Supabase hoặc Clerk lỗi.
- API tự kiểm tra quyền, không dựa riêng middleware. Lỗi auth JSON dùng
  401/403/503 tương ứng chưa đăng nhập/không đủ quyền/dịch vụ chưa khả dụng.
- Push subscribe chỉ staff/admin active, chỉ ghi vào user ID từ Clerk; không
  chấp nhận staffId của tài khoản khác. Notify tạm giữ caller staff/kitchen/
  admin active cho các luồng hiện tại; M-12 chuyển sang internal outbox.
- Service-role client chỉ ở server, bắt buộc `SUPABASE_SERVICE_ROLE_KEY`,
  không fallback anon. Không cache role/active qua các request.
- Bootstrap admin phải do người vận hành xác minh Clerk user ID và cấp
  profile có chủ đích; không có quy tắc user đầu tiên mặc định admin.
- Các luồng ghi trực tiếp browser và RLS hiện hữu chưa được bảo vệ bởi
  amendment này; tiếp tục M-04…M-14 trước khi dùng production.

Cấu trúc bổ sung được phép cho phần auth: `src/lib/auth/staff-guard.ts`,
`src/app/access-denied/page.tsx`, tests auth trong `unit_test/`, tài liệu
inventory/contracts/progress/runbook trong `docs/`. Không thêm bảng/cột/enum
DB trong đợt Auth foundation.

Cho phép cấu hình `tsconfig.test.json` và script `typecheck:tests` kiểm tra
TypeScript của src + unit_test. Mocks auth/DB chỉ dùng trong test, không runtime.

### Amendment Admin staff API — 2026-10-22

- `POST /api/admin/staff` chỉ admin active; JSON cùng Origin với ứng dụng,
  tối đa 8KiB. Input `{ action: 'create' | 'update', profile, expected }`.
  Profile chỉ gồm id, full_name, role, assigned_zone_id, is_active. Không nhận
  actor, push_subscription hoặc field khác. Expected=null khi tạo; khi sửa
  phải là snapshot profile trước sửa để chống ghi đè dữ liệu cũ.
- Tạo profile xác minh Clerk user tồn tại và không banned/locked qua Backend
  API. Lỗi Clerk không được bỏ qua; không tự tạo user trong Clerk.
- `public.fn_admin_save_staff(p_actor_id text, p_profile jsonb, p_expected jsonb)`
  trả tập bản ghi profile không có push_subscription. Expected=null là create;
  snapshot có giá trị là update. Không thêm bảng/cột/enum.
- Function khóa ghi staff_profiles trong transaction, kiểm tra lại actor admin
  active, expected snapshot và bảo vệ ít nhất một admin active. Hai admin
  đồng thời tự bỏ quyền không được khiến quán mất mọi admin.
- Function SECURITY DEFINER, search_path cố định, bảng qualified; chỉ
  service_role được EXECUTE. Thu hồi INSERT/UPDATE/DELETE/TRUNCATE staff_profiles
  khỏi PUBLIC/anon/authenticated, kể cả các column-level grants hiện có.
  Push subscribe phía server vẫn được ghi riêng subscription như trước.
- Gán người phụ trách một bàn không tự đổi khu vực mặc định của nhân viên;
  sửa khu vực là thao tác riêng qua API nhân sự. Chuyển bàn/session vẫn M-08.
- Lỗi: 400 malformed/invalid; 401/403 auth/origin; 404 target/Clerk user không
  tồn tại; 409 duplicate/stale/last-admin; 413 quá lớn; 415 sai Content-Type;
  422 Clerk user banned/locked; 503 dependency lỗi.
- File mới được phép: `src/app/api/admin/staff/route.ts`,
  `src/lib/auth/staff-profile.ts`, `src/lib/api/read-json.ts`, migration trong
  `supabase/migrations/`, integration SQL/Python runner trong `integration_test/`.
  schema.sql giữ bản bootstrap tương đương migration. Test PostgreSQL dùng
  cluster local tạm riêng, không dùng connection string của app/production.

| Thành phần | Công nghệ lựa chọn | Mục đích & Lý do sử dụng |
| :--- | :--- | :--- |
| **Framework chính** | **Next.js 15 (App Router) + TypeScript** | Chung 1 codebase cho cả Frontend, PWA và API Webhook. |
| **Giao diện & Biểu đồ** | **Tailwind CSS + shadcn/ui + Recharts** | Dựng UI cảm ứng nhanh, dùng `Recharts` vẽ biểu đồ phân tích doanh thu/KPI. |
| **Quản lý State** | **Zustand** | Lưu giỏ hàng tạm của khách trên trình duyệt (`localStorage`). |
| **PWA Engine** | **`@serwist/next`** | Cài đặt ứng dụng ra màn hình chính, lưu đệm (cache) ảnh menu giúp tải siêu tốc. |
| **Xác thực (Auth)** | **Clerk (`@clerk/nextjs`)** | Xác minh danh tính; quyền `admin`, `staff`, `kitchen` và active lấy từ `staff_profiles` theo amendment Auth foundation. |
| **Database & Realtime** | **Supabase (PostgreSQL)** | Lưu trữ dữ liệu, chạy SQL Views cho Dashboard và dùng **Supabase Realtime** đồng bộ tức thì. Region: **Singapore (`ap-southeast-1`)**. |
| **Thông báo đẩy** | **`web-push` (VAPID)** | Gửi thông báo có âm thanh về điện thoại nhân viên ngay cả khi khóa màn hình. |
| **Thanh toán QR** | **PayOS** (hoặc **SePay**) | Tạo mã VietQR động và bắn Webhook xác nhận tiền về tài khoản sau 2-5 giây. |
| **Tiện ích bổ trợ** | **`qrcode.react`, `browser-image-compression`** | Vẽ mã QR tại bàn và nén ảnh menu xuống < 80KB chuẩn WebP trước khi upload. |

---

## 9. SƠ ĐỒ ĐỊNH TUYẾN MÀN HÌNH & API (ROUTING MAP)

### 9.1. Giao diện Người dùng (Pages)
* **Phân hệ Khách hàng (Public - Bảo vệ bằng Session Token):**
  * `/customer/order/[session_token]` : Màn hình gọi món, xem giỏ hàng, xem vị trí bếp & gọi tính tiền của khách tại bàn.
  * `/customer/takeaway` : Màn hình đặt món mang về, thanh toán VietQR và tra cứu tiến độ đơn bằng SĐT.
* **Phân hệ Nội bộ (Protected bởi Clerk Middleware):**
  * `/staff` : Sơ đồ bàn theo khu vực, mở bàn tạo QR, nhận thông báo bưng món, chuyển bàn, trả bia.
  * `/kitchen` : Màn hình KDS cho máy tính bảng tại bếp (Cột Gom món trùng & Cột Thứ tự thời gian).
  * `/admin` : Dashboard KPI & Doanh thu (Mặc định), Quản lý Menu (`/admin/menu`), Quản lý Kho (`/admin/inventory`), Quản lý Nhân sự (`/admin/staff`), Lịch sử Hóa đơn (`/admin/bills`).

### 9.2. Các API Endpoints cốt lõi (Next.js Route Handlers)
* `POST /api/webhooks/payment` : Nhận Webhook từ PayOS/SePay khi khách chuyển khoản thành công -> Kích hoạt đơn mang về hoặc gạch nợ hóa đơn tại bàn.
* `POST /api/push/subscribe` : Lưu `PushSubscription` của thiết bị nhân viên vào bảng `staff_profiles`.
* `POST /api/push/notify` : Bắn thông báo Web Push có âm thanh đến đúng nhân viên phụ trách bàn khi món chuyển sang `READY`.
* `GET /api/cron/keep-alive` : Endpoint nhẹ để GitHub Actions ping mỗi 3 ngày chống ngủ đông (Auto-Pause) cho Supabase Free Tier.

---

## 10. YÊU CẦU PHI CHỨC NĂNG & KỸ THUẬT (NON-FUNCTIONAL REQUIREMENTS)

1. **Tối ưu hình ảnh Menu:** Ảnh món ăn khi Admin tải lên phải nén tự động phía Client về định dạng **WebP**, dung lượng **< 80KB/ảnh**.
2. **Giữ sáng màn hình Bếp (Screen Wake Lock API):** Trên giao diện `/kitchen`, tích hợp `navigator.wakeLock.request('screen')` để máy tính bảng của đầu bếp không tự tắt màn hình.
3. **Âm thanh cảnh báo (Audio Feedback):** Màn hình `/kitchen` (khi có đơn mới) và `/staff` (khi có món chín) phải phát âm thanh `ting-ting.wav` rõ ràng.
4. **Tối ưu hiệu năng Dashboard:** Tuyệt đối không kéo hàng chục nghìn dòng `order_items` về Frontend để cộng bằng JavaScript. Bắt buộc sử dụng **PostgreSQL Views / RPC Functions** trên Supabase để tính toán ở tầng Database và chỉ trả về kết quả tổng hợp cho biểu đồ Recharts.

---

## 11. HỆ THỐNG BÁO CÁO & ĐÁNH GIÁ HIỆU SUẤT CUỐI THÁNG (ANALYTICS & KPI DASHBOARD)

Trang `/admin` cung cấp bộ lọc theo khoảng thời gian (Hôm nay / Tuần này / Tháng này / Tùy chọn ngày) và hiển thị 4 nhóm chỉ số đánh giá toàn diện:

### 11.1. Đánh giá Tài chính (Doanh thu & Lợi nhuận ròng)
* **Tổng Doanh thu (Gross Revenue):** Tổng tiền của các `table_sessions` có `status = 'CLOSED'` (Tách biểu đồ tròn: Tiền mặt vs Chuyển khoản QR; Tại bàn vs Mang về).
* **Giá vốn hàng bán (COGS):** `SUM(unit_cost_price * quantity)` của các `order_items` có `status = 'SERVED'`.
* **Chi phí hao hụt kho (Wastage Cost):** Tổng giá trị các phiếu xuất hủy hàng hỏng (`type = 'WASTAGE'`) trong bảng `inventory_logs`.
* **Lợi nhuận ròng ước tính (Net Profit):** `Tổng Doanh thu - Giá vốn hàng bán - Chi phí hao hụt kho`.
* **Biểu đồ Khung giờ vàng (Peak Hours Heatmap):** Thống kê số lượng món được đặt theo từng khung giờ trong ngày (dựa vào `EXTRACT(HOUR FROM created_at)`) để chủ quán biết giờ nào cần tăng cường nhân viên.

### 11.2. Đánh giá Thực đơn (Món đắt hàng & Bia tiêu thụ)
* **Top Mồi Bén (Best-selling Food):** Xếp hạng các món có `category = 'FOOD'` theo số lượng bán ra (`SUM(quantity)`) và theo tổng lãi gộp mang về (`SUM((unit_price - unit_cost_price) * quantity)`).
* **Top Bia & Đồ uống (Beverage Analytics):** Xếp hạng số lượng lon/két tiêu thụ thực tế của từng loại bia (`category = 'BEER'`) sau khi đã trừ đi lượng bia trả lại, giúp chủ quán làm việc với đại lý bia.
* **Cảnh báo Món ế (Slow-moving Items):** Danh sách 5 món có số lượng gọi thấp nhất trong tháng để chủ quán cân nhắc xóa khỏi thực đơn.

### 11.3. Đánh giá Hiệu suất Đầu bếp (Kitchen KPI)
Chỉ tính trên các món có `station = 'KITCHEN'` và `status = 'SERVED'`:
* **Thời gian chờ chế biến trung bình (Queue Wait Time):** `AVG(cooking_started_at - created_at)`. (Đo xem bếp có để đơn bị ứ đọng lâu trước khi bắt đầu nấu không).
* **Thời gian nấu thực tế trung bình (Actual Cook Time):** `AVG(ready_at - cooking_started_at)` so sánh trực tiếp với cột `prep_time_minutes` chuẩn của món đó.
  * *Đánh giá:* Nếu `Actual Cook Time <= prep_time_minutes` -> **Đạt chuẩn (Màu xanh)**. Nếu trễ quá 30% -> **Cảnh báo chậm (Màu đỏ)**.
* **Tỷ lệ Nấu gộp mẻ (Batch Cooking Efficiency):** `(Số món có batch_id IS NOT NULL / Tổng số món bếp đã nấu) * 100%`. Tỷ lệ này càng cao chứng tỏ bếp biết tận dụng tính năng gom món để tiết kiệm gas và thời gian.
* **Số món bị hủy do bếp làm chậm:** Đếm số món có `status = 'CANCELLED'` mà thời gian chờ trước khi hủy `(cancelled_at - created_at) > 15 phút`.

### 11.4. Đánh giá Hiệu suất Nhân viên chạy bàn (Waitstaff KPI)
Bảng xếp hạng từng nhân viên (nhóm theo `staff_profiles.id`) dựa trên 4 chỉ số công bằng:
* **Số bàn đã mở & Chăm sóc:** `COUNT(table_sessions.id)` nơi `assigned_staff_id = staff.id`.
* **Tổng doanh thu bàn phụ trách:** `SUM(table_sessions.total_amount)` của các bàn nhân viên đó quản lý.
* **Số lượt bưng món thực tế (Active Serving Count):** `COUNT(order_items.id)` nơi `served_by_staff_id = staff.id` (Ghi nhận công sức thực tế cả khi nhân viên này chạy đi bưng hộ bàn của đồng nghiệp khác).
* **Tốc độ phản ứng khi món chín (Pickup Speed - Quan trọng nhất):** `AVG(served_at - ready_at)` của các món nhân viên đó bưng.
  * *Đánh giá:* Trung bình dưới 90 giây là **Xuất sắc**; từ 90 giây – 3 phút là **Bình thường**; trên 3 phút là **Chậm trễ**.

---

## 12. ĐẶC TẢ CƠ SỞ DỮ LIỆU CHUẨN (SUPABASE DATABASE SCHEMA)

### Amendment operation ledger — 2026-10-22 (M-05a)

Theo master plan đã cho phép triển khai, bổ sung `private.operation_requests`
để kết quả thao tác commit cùng transaction nghiệp vụ. Không thêm enum business.

- `id uuid PK DEFAULT gen_random_uuid()`, `scope_key text NOT NULL` (1–256),
  `operation_id uuid NOT NULL`, `action text NOT NULL` (1–80),
  `request_hash text NOT NULL` (SHA256 hex64), `session_id uuid nullable FK
  table_sessions ON DELETE RESTRICT`, `actor_id text nullable FK staff_profiles
  ON DELETE RESTRICT`, `result jsonb nullable`, `created_at timestamptz NOT NULL
  DEFAULT clock_timestamp()`, `completed_at timestamptz nullable`.
- UNIQUE(scope_key,operation_id); index created_at và (session_id,created_at),
  actor_id. Result chỉ JSON object DTO tối thiểu ≤16KiB, không capability/PII.
  Fingerprint canonical JSONB; không lưu request thô. Scope phải do wrapper RPC
  suy ra từ identity/capability đã xác minh, không tin chuỗi scope của browser.
- RLS enabled, không policy công khai; revoke schema/table/function khỏi
  PUBLIC/anon/authenticated/service_role. Private schema không expose qua API
  hoặc realtime. Chỉ function owner của RPC nghiệp vụ được gọi helpers.
- `private.begin_operation(scope,operation_id,action,request,session,actor)`
  trả `{ replay:false }` nếu claim mới hoặc `{ replay:true,result }` khi hoàn
  tất trước đó. Cùng key khác request/action/session/actor trả SQLSTATE 22000.
  Scope khác được dùng cùng operation ID. Request object ≤32KiB, không secrets.
- `private.complete_operation(scope,operation_id,result)` lưu result và DB time;
  kết quả đã lưu bất biến. Deferred constraint trigger chặn COMMIT nếu còn
  claim chưa complete. SQL rollback phải rollback cả thay đổi nghiệp vụ và claim.
- Hai request cùng key được serialize bằng unique constraint/row lock. Helper
  không tạo transaction qua nhiều HTTP call. Wrapper phải xác thực lại trước
  cả lần replay; không public endpoint đọc ledger trong đợt này.
- Chưa tự xóa ledger. Trước production M-16 chốt retention theo action/retry
  horizon; xóa quá sớm khiến request cũ có thể chạy lại. Payment event/outbox,
  rate limit và create takeaway recovery vẫn scope task riêng, chưa hoàn tất.
- File bổ sung: `supabase/migrations/202610220002_operation_ledger.sql`,
  `integration_test/operation_rpc_test.py`; bootstrap schema và Database private
  types phải đồng bộ. Không tự áp migration vào DB của ứng dụng.

### Amendment dine-in transaction — 2026-10-22 (M-05b/c, M-06)

- `POST /api/customer/orders`, `GET /api/customer/operation`: capability trong
  header `x-session-token`, không query string. Staff dùng `/api/staff/orders`
  và `/api/staff/operation`, xác thực staff/admin active; actor lấy từ guard.
  POST cùng Origin, JSON≤32KiB. GET no-store; không trả token/cost/PII.
- POST `{sessionId uuid, operationId uuid, lines:[{menu_item_id uuid, quantity
  integer1…99, note string≤500, expected_price finite number≥0}]}`, 1…30 dòng.
  Strict allowlist; trim note, normalize integer/price trước fingerprint.
- `fn_submit_dine_in_order(session_id, session_token nullable, actor_id nullable,
  operation_id, lines jsonb)` SECURITY DEFINER service_role-only. Guest có token,
  staff có actor; không nhận cả hai. DB kiểm actor active staff/admin và khóa
  session; chỉ DINE_IN, mới nhận món khi ACTIVE. REQUEST_BILL chỉ được đọc lại
  kết quả đã commit; CLOSED/PENDING_PAYMENT bị chặn kể cả replay khách.
- Khóa theo thứ tự session → staff identity shared → menu IDs shared tăng dần
  → ingredient IDs tăng dần; đọc lại giá/cost/station/availability tại DB.
  Giá khác expected_price phải rollback và trả PRICE_CHANGED kèm quote mới,
  khách xem lại rồi mới gửi request mới. Snapshot không nhận từ client.
- Tối đa 2 lượt đặt mới thành công trong rolling10s mỗi session, tính trên
  ledger completed_at, gồm cả khách và staff. Replay không tiêu quota; lỗi không
  ghi claim. Kiểm tra dưới session lock, không phụ thuộc đồng hồ trình duyệt.
- Kho linked chỉ tự trừ khi BAR_INSTANT và category BEER/DRINK/OTHER, mapping
  1:1 đúng đơn vị. FOOD có linked_ingredient_id hoặc linked KITCHEN bị chặn
  INVENTORY_MAPPING_INVALID để người vận hành xác minh; không đoán 1đĩa=1kg.
  Gộp lượng tiêu thụ theo ingredient, đủ tồn mới trừ; ghi EXPORT_SALE quantity
  âm, total_cost=quantity×ingredient.unit_cost hiện tại. Lỗi rollback toàn lượt.
- KITCHEN QUEUED; BAR_INSTANT READY+ready_at DB clock. Total phiên tính từ toàn
  bộ order_items không CANCELLED, không cộng vào state hoặc danh sách bị limit.
  Ledger trả DTO tối thiểu items (không unit_cost_price/actor IDs), sessionId,
  operationId và totalAmount. Replay trả nguyên kết quả; UI không dùng replay
  để ghi lùi trạng thái món đã tiến triển.
- `fn_get_dine_in_operation` cùng auth/scope; khóa session để chờ lượt đang ghi,
  trả kết quả hoặc null. Không tạo món. Scope do DB suy ra, không client chọn.
- Bổ sung `private.notification_outbox`: id uuid PK default gen_random_uuid(),
  dedupe_key text UNIQUE NOT NULL, session_id uuid nullable FK RESTRICT,
  order_item_id uuid nullable FK RESTRICT, kind text NOT NULL (1…80), payload
  jsonb NOT NULL object≤4KiB (chỉ IDs), available_at timestamptz NOT NULL,
  attempts int NOT NULL default0 CHECK≥0, locked_until timestamptz nullable,
  delivered_at timestamptz nullable, last_error text nullable≤1000,
  created_at timestamptz NOT NULL default clock_timestamp(). Index
  (available_at,locked_until) WHERE delivered_at IS NULL; session_id/order_item_id.
  RLS/no grants như operation ledger. Mỗi món tạo một event ORDER_READY hoặc
  KITCHEN_ORDER_CREATED trong transaction. Worker/fallback/retry/push M-12 chưa
  triển khai; không báo người dùng rằng push đã gửi chỉ vì event được ghi.
- Migration0003 nâng giới hạn result của ledger từ16KiB lên64KiB để lưu đủ
  30 dòng và ghi chú; request vẫn≤32KiB. Giới hạn cũ được thay bằng constraint
  và helper complete mới, giữ nguyên migration0002 để có lịch sử nâng cấp.
- Browser lưu pending {operationId,sessionId,lines} để reload/retry cùng payload;
  không lưu token mới/secret. Có pending phải đối soát trước, không thay payload
  hoặc tạo operation mới khi kết quả chưa biết. Chỉ bỏ journal sau kết quả đã
  xác nhận hoặc lỗi business chắc chắn rollback; 5xx/network giữ nguyên.
- Thư mục được phép thêm: `src/lib/orders/`, `src/app/api/customer/{orders,operation}`,
  `src/app/api/staff/{orders,operation}`, migration0003 và integration order tests.
  Không thu hồi toàn bộ order table grants trong batch khi takeaway/transition
  còn dùng caller cũ; AUD-02 vẫn mở đến khi chuyển hết callers và RLS M-04.

### 12.5. Amendment M-07a — Phiếu kho thủ công (2026-10-22)

- Không thêm bảng/cột/enum. Chỉ admin đang active được tạo IMPORT/WASTAGE
  qua `/api/admin/inventory` POST; GET đối soát theo operationId và actor hiện tại.
  API cùng Origin, JSON≤8KiB; actor lấy từ guard, không lấy từ body.
- `fn_admin_record_inventory(p_actor_id text,p_operation_id uuid,p_input jsonb)`
  và `fn_admin_get_inventory_operation(p_actor_id text,p_operation_id uuid)` chỉ
  service_role được EXECUTE; SECURITY DEFINER, search_path pg_catalog, timeout5s.
  DB kiểm lại admin active, khóa cùng operation khi POST/GET, ledger scope
  manual-inventory:<actor>. Replay giữ nguyên kết quả; đổi payload cùng key bị từ chối.
- Input đúng 5 trường: ingredientId uuid, type IMPORT|WASTAGE, quantity số dương
  ≤1e6 tối đa3 số lẻ, unitCost số0…1e9 tối đa2 số lẻ cho IMPORT/null cho WASTAGE,
  note chuỗi≤500 (bắt buộc lý do WASTAGE). Không nhận stock/total/created_by.
- Khóa ingredient FOR UPDATE; IMPORT cộng quantity, cập nhật unit_cost theo giá
  nhập kể cả0; WASTAGE trừ quantity, giữ unit_cost và tính giá từ DB lúc khóa.
  total_cost=abs(quantity_change)×giá vốn, làm tròn2 chữ số tại DB; không clamp
  tồn âm. Tồn/giá vốn dữ liệu cũ không hữu hạn/âm hoặc giá vốn>1e9 thì chặn để kiểm tra.
  Cập nhật số học, inventory_logs và ledger hoàn tất cùng một transaction.
- Result chỉ operationId, ingredientId, logId, quantityChange,totalCost; không dùng
  snapshot cũ để ghi lùi tồn hiển thị khi recovery. Client lưu payload/key trước
  POST, giữ journal khi 5xx/mất phản hồi, GET trước retry, đóng băng phiếu pending.
  Sau xác nhận tải lại dữ liệu hiện tại; không tự gửi lại bằng operation mới.
- UI không cho sửa tồn/giá vốn trong form danh mục; tạo nguyên liệu tồn0/giá vốn0,
  sau đó nhập kho có log. EXPORT_SALE/RETURN_BEER chỉ hiển thị trong lịch sử,
  không tạo thủ công. Ingredient metadata API/RLS toàn bộ và return transaction
  vẫn thuộc M-14/M-04/M-07b; không coi batch này đóng lỗ hổng base-table grants.
- Cho phép thêm `src/lib/inventory/`, `src/app/api/admin/inventory/`, migration0004,
  unit/component và integration tests tương ứng theo cấu trúc Mục13.

### 12.6. Amendment M-07b — Trả bia và provenance kho (2026-10-22)

- Chốt phương án master A-05: trả một phần giảm quantity; trả hết quantity=0,
  giữ status/timestamps/served_by, không DELETE/CANCELLED. Quantity CHECK≥0;
  mọi queue, KPI lượt phục vụ/average/sản lượng bỏ quantity0; bill tiền bằng0.
- Thêm `order_items.stock_export_log_id uuid nullable REFERENCES inventory_logs(id)
  ON DELETE RESTRICT`, index FK. Order transaction lưu liên kết tới EXPORT_SALE
  gốc (kể cả nhiều dòng cùng ingredient); DTO không trả field này. Không backfill
  liên kết lịch sử bằng suy đoán tên/menu hiện tại. Bản ghi cũ thiếu provenance
  bị chặn trả tự động để quản lý đối soát. Không thêm bảng/enum khác.
- POST/GET `/api/staff/returns`, chỉ staff/admin active; POST cùng Origin JSON≤8KiB.
  POST đúng `{sessionId,operationId,orderItemId,quantity,expectedQuantity,confirmedUnused}`;
  IDs uuid, quantity/expectedQuantity integer1…99, quantity≤expectedQuantity,
  confirmedUnused phải true sau nhân viên xác nhận hàng còn nguyên/chưa dùng.
  Không nhận giá/ingredient/status/actor/total. GET sessionId+operationId.
- `fn_return_beer(p_actor_id text,p_session_id uuid,p_operation_id uuid,p_input jsonb)`
  và `fn_get_beer_return_operation(p_actor_id text,p_session_id uuid,p_operation_id uuid)`
  SECURITY DEFINER/service-only, pg_catalog search_path/lock_timeout5s.
  Khóa session → actor shared → item → menu shared → export log shared → ingredient;
  session DINE_IN ACTIVE/REQUEST_BILL. Staff được đối soát kết quả đã commit
  trên CLOSED; không tạo return mới. Scope beer-return:<session>:<actor> + ledger.
- Chỉ BAR_INSTANT, category BEER/DRINK, status READY/SERVED, số lượng còn lại>0,
  export log phải đúng type EXPORT_SALE/quantity âm và đủ lượng; ingredient lấy
  từ export gốc, không từ mapping menu mới. Kiểm expectedQuantity dưới item lock:
  hai người cùng snapshot không được cùng trả. Replay trước expected/menu checks.
- Trong cùng transaction: giảm item.quantity, cộng số học tồn ingredient, log
  RETURN_BEER dương, total_cost=quantity×order_items.unit_cost_price snapshot
  (không giá nhập hiện tại), tổng phiên tính toàn bộ items không CANCELLED,
  ledger và outbox SESSION_UPDATED. Lỗi rollback toàn bộ; tồn/snapshot không hữu
  hạn hoặc âm phải chặn. Không tạo WASTAGE hoặc thay unit_cost lúc return.
- Result tối thiểu sessionId/operationId/orderItemId/remainingQuantity/totalAmount;
  replay result bất biến, UI refresh staff page có server guard để lấy trạng thái
  hiện tại; không ghi snapshot cũ đè lên quantity mới. Journal theo actor lưu trước
  POST, GET trước retry; 5xx/network giữ key/payload, không auto retry.
- Thư mục thêm `src/lib/returns/`, `src/app/api/staff/returns/`, migration0005,
  return integration/unit/component tests. M-04 vẫn phải khóa base grants sau
  khi các caller khác chuyển API; M-13 còn cần hoàn thiện KPI tài chính toàn bộ.

### 12.7. Amendment M-08 — Vòng đời bàn (2026-10-22)

- `fn_session_action(actor,token,operation,action,input)` service-only SECURITY
  DEFINER/pg_catalog/lock_timeout5s. Staff/admin active dùng OPEN/TRANSFER/HANDOVER/
  REQUEST_BILL/CLOSE; khách chỉ REQUEST_BILL bằng capability header. Không trộn
  actor/token. GET đối soát qua fn_get_session_action_operation; staff đối soát
  CLOSED được, khách CLOSED bị thu hồi quyền. Không tự dựa Clerk metadata.
- API `/api/staff/sessions`, `/api/customer/bill` POST/GET, JSON≤8KiB cùng Origin.
  Body `{operationId,action,input}` allowlist: OPEN{tableId}; TRANSFER{sessionId,
  expectedTableId,targetTableId}; HANDOVER{sessionId,expectedAssignedStaffId nullable,
  assignedStaffId}; REQUEST_BILL{sessionId,paymentMethod}; CLOSE{sessionId,
  paymentMethod,expectedTotal,confirmedReceived:true}. PaymentMethod CASH/VIETQR.
  GET staff chỉ operationId; khách sessionId+operationId và x-session-token.
- Ledger staff scope session-action:staff:<actor>; khách session-action:customer:
  <session>. Cùng operation dùng chung lock cho POST/GET. Result chỉ action,
  operationId/sessionId/tableId/status/totalAmount, không capability/PII. OPEN
  claim chưa có session_id nên giữ NULL, result chứa session ID sau tạo.
- OPEN khóa bàn AVAILABLE/current_session_id NULL, chặn active session mồ côi;
  tạo session/token ngẫu nhiên mạnh server và gắn bàn trong một transaction.
  TRANSFER khóa session và hai bàn tăng dần UUID, kiểm expectedTableId và bàn
  đích trống; giữ token/assignment, bàn giao khác là thao tác HANDOVER có expected
  assignment và kiểm người nhận active staff/admin. Chỉ DINE_IN chưa CLOSED.
- REQUEST_BILL chỉ ACTIVE→REQUEST_BILL, tính tổng toàn bộ non-CANCELLED items
  và ghi outbox. Request khác khi đã REQUEST_BILL trả conflict, không đổi phương
  thức âm thầm. Replay cùng key trả kết quả gốc. Mọi order API chặn lúc request bill.
- CLOSE cho ACTIVE/REQUEST_BILL DINE_IN, nhân viên xác nhận thực tế đã nhận đủ
  CASH hoặc tự đối chiếu khoản VIETQR; không coi checkbox là webhook đã xác minh.
  Tính tổng DB, so expectedTotal và chặn món quantity>0 còn ngoài SERVED/CANCELLED.
  Bàn phải trỏ đúng session mới giải phóng, CLOSED/closed_at/payment_method/total
  cùng commit. Takeaway close thuộc M-10; không tự đóng từ trạng thái thanh toán.
- Mỗi action ghi SESSION_UPDATED outbox cùng ledger/transaction. UI giữ journal
  theo actor hoặc capability scope, không tạo key mới khi unknown, refresh trạng
  thái hiện tại sau xác nhận. Kết quả replay không ghi lùi assignment/table/status.
  Metadata table CRUD vẫn M-14; base grants còn M-04. Chưa bật provider thanh toán.
- Chi tiết bill qua GET `/api/staff/bill?sessionId=...` → `fn_get_session_bill(actor,
  session)` service-only SECURITY DEFINER; kiểm role/active, session FOR SHARE,
  tổng và toàn bộ items trong cùng snapshot/khóa phiên, không limit300/500.
  JSON chỉ sessionId/status/totalAmount/closedAt và DisplayOrderItem không cost/
  actor/provenance. UI chống phản hồi sai phiên, timeout/abort cleanup, báo lỗi
  tải; chặn in/chốt khi detail chưa tải xong. CLOSED có stored total lệch chi tiết
  bị chặn để quản lý đối soát, không sửa doanh thu đã thu bằng read API. List tổng
  vẫn cần phân trang M-14.
- Thêm `src/lib/sessions/`, API thư mục trên và staff/bill, migration0006/0007
  và tests tương ứng. Không expose bill này cho khách ngoài capability route.

### 12.8. Amendment M-11 — State transitions nguyên tử (2026-10-22)

- POST/GET `/api/staff/item-actions` cho staff/kitchen/admin active. POST cùng
  Origin, JSON≤32KiB: `{operationId,action,items,reason}`; action START/READY/
  SERVE/CANCEL, 1…100 items đúng `{id,sessionId,expectedStatus,expectedQuantity}`.
  UUID duy nhất, quantity int1…99; CANCEL/SERVE một dòng, CANCEL reason trim1…500,
  action khác reason=''. Không nhận actor/timestamp/batch ID/giá từ browser.
- `fn_transition_order_items(actor,operation,command)` và
  `fn_get_item_action_operation(actor,operation)` SECURITY DEFINER/service-only,
  fixed pg_catalog/lock_timeout5s. Scope item-action:<actor>, cùng operation lock
  cho POST/GET, ledger commit với items/tổng/outbox. Auth hiện tại kiểm cả replay.
  Khóa session IDs tăng dần → actor shared → item IDs tăng dần; kiểm đủ mọi dòng,
  session ACTIVE/REQUEST_BILL, quantity>0 và expected status/quantity khớp. Không
  xử lý PENDING_PAYMENT/CLOSED hoặc resurrect CANCELLED; một conflict rollback mẻ.
- START kitchen/admin: KITCHEN QUEUED→COOKING, tất cả cùng menu, không có mốc
  cooking/ready/served trước đó; batch_id DB sinh khi>1 dòng, ghi cooking_started_at
  DB clock. READY kitchen/admin: KITCHEN COOKING→READY, cooking_started_at hợp lệ,
  ghi ready_at; SERVE staff/admin: READY→SERVED, ready_at hợp lệ, served_at và
  served_by_staff_id lấy DB/actor. Không sửa note/quantity/created_at/snapshot giá.
  Chặn timestamp tương lai/không theo thứ tự, không reset mốc do replay.
- Staff CANCEL chỉ QUEUED; admin CANCEL QUEUED/COOKING/READY/SERVED cần reason;
  kitchen không cancel. CANCEL ghi cancelled_at/by/reason, giữ lịch sử mốc cũ,
  tính lại full session total từ mọi non-CANCELLED item. Phiên CLOSED không hủy.
  Không hoàn ingredient, không ghi WASTAGE lần hai cho lượng đã EXPORT_SALE.
  Chi phí món hủy sau chuẩn bị/xuất kho là tổn thất từ snapshot, M-13 phải tính
  COGS/loss đó trong KPI, không bỏ chi phí và không trừ kho thêm lần nữa.
- Result bất biến chỉ operationId/action/batchId/items[{id,sessionId,fromStatus,
  status}], không cost/capability. Lookup dùng fromStatus để kiểm lại quyền admin
  cho cancel đã nấu, kể cả actor đổi role sau commit. READY tạo ORDER_READY event
  từng item; action khác SESSION_UPDATED theo session, cùng transaction.
- Browser journal theo actor lưu trước POST, GET trước retry, giữ key/payload
  khi unknown, ref chặn double click; refresh trạng thái hiện tại sau xác nhận,
  không ghi result replay cũ đè state. Staff/admin không còn tự cộng bill khi hủy;
  KDS không gọi push trực tiếp, outbox worker vẫn M-12; 86ing còn M-14.
- Thêm `src/lib/item-actions/`, API trên, cancel dialog staff, migration0008 và
  unit/component/integration tests. Không đổi bảng/cột/enum; M-04 còn base grants.

AI Agent sử dụng chính xác tên bảng và tên cột dưới đây khi tạo Migration SQL và viết truy vấn TypeScript:

1. **`zones` (Khu vực bàn):**
   * `id` (uuid, PK), `name` (text - VD: "Sân vườn"), `created_at` (timestamptz).
2. **`staff_profiles` (Hồ sơ nhân sự - Đồng bộ với Clerk):**
   * `id` (text, PK - chính là `clerk_user_id`), `full_name` (text), `role` (text: `'admin' | 'staff' | 'kitchen'`), `assigned_zone_id` (uuid, FK -> `zones.id`), `push_subscription` (jsonb - lưu token Web Push), `is_active` (boolean).
3. **`tables` (Bàn vật lý):**
   * `id` (uuid, PK), `table_number` (text - VD: "Bàn 05"), `zone_id` (uuid, FK -> `zones.id`), `status` (text: `'AVAILABLE' | 'OCCUPIED'`), `current_session_id` (uuid, nullable).
4. **`ingredients` (Kho nguyên liệu & Bia):**
   * `id` (uuid, PK), `name` (text), `unit` (text - VD: "lon", "kg"), `stock_quantity` (numeric), `min_threshold` (numeric - mức cảnh báo sắp hết), `unit_cost` (numeric).
5. **`inventory_logs` (Lịch sử Xuất / Nhập / Hủy kho):**
   * `id` (uuid, PK), `ingredient_id` (uuid, FK -> `ingredients.id`), `type` (text: `'IMPORT' | 'EXPORT_SALE' | 'RETURN_BEER' | 'WASTAGE'`), `quantity_change` (numeric), `total_cost` (numeric), `note` (text), `created_by` (text, FK -> `staff_profiles.id`), `created_at` (timestamptz).
6. **`menu_items` (Thực đơn):**
   * `id` (uuid, PK), `name` (text), `category` (text: `'FOOD' | 'BEER' | 'DRINK' | 'OTHER'`), `station` (text: `'KITCHEN' | 'BAR_INSTANT'`), `price` (numeric - giá bán hiện tại), `cost_price` (numeric - giá vốn ước tính), `prep_time_minutes` (int - thời gian nấu chuẩn), `image_url` (text), `is_available` (boolean - phục vụ nút báo hết món 86ing), `linked_ingredient_id` (uuid, nullable, FK -> `ingredients.id` - dùng để tự động trừ kho khi bán bia/nước ngọt).
7. **`table_sessions` (Phiên nhậu tại bàn & Đơn mang về):**
   * `id` (uuid, PK), `session_token` (text, unique - mã bí mật trên URL QR), `session_type` (text: `'DINE_IN' | 'TAKEAWAY'`), `table_id` (uuid, nullable, FK -> `tables.id`), `assigned_staff_id` (text, nullable, FK -> `staff_profiles.id`), `customer_name` (text, nullable), `customer_phone` (text, nullable), `status` (text: `'PENDING_PAYMENT' | 'ACTIVE' | 'REQUEST_BILL' | 'CLOSED'`), `payment_method` (text: `'CASH' | 'VIETQR'`), `payment_code` (text, unique - mã nội dung chuyển khoản PayOS/SePay), `total_amount` (numeric), `opened_at` (timestamptz), `closed_at` (timestamptz, nullable).
8. **`order_items` (Chi tiết từng món gọi - Trái tim của Realtime & Analytics):**
   * Bổ sung M-07b: `stock_export_log_id` (uuid nullable FK -> inventory_logs.id, ON DELETE RESTRICT); `quantity` CHECK≥0.
   * `id` (uuid, PK), `session_id` (uuid, FK -> `table_sessions.id`), `menu_item_id` (uuid, FK -> `menu_items.id`), `quantity` (int), `note` (text, nullable), `station` (text: `'KITCHEN' | 'BAR_INSTANT'`), `status` (text: `'QUEUED' | 'COOKING' | 'READY' | 'SERVED' | 'CANCELLED'`), `batch_id` (uuid, nullable - mã gom nhóm khi bếp nấu gộp), `unit_price` (numeric - snapshot giá bán lúc đặt), `unit_cost_price` (numeric - snapshot giá vốn lúc đặt), `served_by_staff_id` (text, nullable, FK -> `staff_profiles.id`), `created_at` (timestamptz), `cooking_started_at` (timestamptz, nullable), `ready_at` (timestamptz, nullable), `served_at` (timestamptz, nullable), `cancelled_at` (timestamptz, nullable), `cancelled_by` (text, nullable), `cancel_reason` (text, nullable).

---

### 12.9. Amendment M-14a — Menu CRUD và 86ing (2026-10-22)

- `POST/GET /api/staff/menu-actions` dùng Clerk actor và DB role/active. Admin
  được CREATE/UPDATE/DELETE/AVAILABILITY; kitchen chỉ AVAILABILITY, staff không
  được ghi menu. Origin cùng ứng dụng, body tối đa16KiB, DTO chặn field lạ.
- Command `{operationId,action,id,item,expected}`. CREATE dùng UUID mới lưu cùng
  journal, expected=null; UPDATE/DELETE expected là toàn bộ9 metadata fields
  của menu (không id); AVAILABILITY chỉ nhận `{is_available:boolean}` cho cả
  item/expected. DELETE item=null; CREATE/UPDATE item là9 metadata fields.
- `fn_menu_action(actor,operation,command)` và `fn_get_menu_action_operation`
  chỉ service_role; fixed search_path, kiểm role trong transaction. Dùng ledger
  hiện hữu scope `menu-action:<actor>`, action `menu.action`, kết quả chỉ có
  operationId/action/menuItemId. Lưu journal trước POST; GET đối soát và chỉ
  gửi lại cùng key/body nếu chưa có kết quả; không áp snapshot cũ lên UI.
- Tên1..120, giá/vốn hữu hạn0..1e12 (tối đa2 số lẻ), prep int0..1440, category/
  station đúng enum; image_url=null hoặc HTTPS tối đa2048 ký tự. Linked ingredient
  chỉ non-FOOD/BAR_INSTANT (mỗi đơn vị bán tương ứng1 đơn vị kho), FK phải có.
- Khóa row menu và so khớp expected trước ghi; lệch trả409. Giá/snapshot món
  đã gọi và kho không đổi. Menu có order history không được xóa, không được
  đổi category/station/linked_ingredient_id để tránh diễn giải lại chứng từ
  và trả bia cũ; dùng tạm ngừng bán hoặc tạo món mới. FK RESTRICT giữ lịch sử.
- Thu hồi mọi table/column write grant menu của anon/authenticated. Bổ sung
  menu_items vào publication supabase_realtime cho UPDATE 86ing; private realtime/outbox M-12 và read RLS
  M-04 chưa hoàn tất. Ảnh/storage, metadata kho/bàn, phân trang, seed/env còn
  M-14; không thêm bảng/cột/enum trong batch này. Cho phép module
  `src/lib/menu/`, route nêu trên, shared feedback và tests theo cấu trúc hiện có.

### 12.10. Amendment M-14b — Metadata nguyên liệu/khu vực/bàn (2026-10-22)

- Admin active dùng POST/GET `/api/admin/metadata` → service_role-only RPC
  `fn_admin_metadata_action` / `fn_get_admin_metadata_operation`. Command
  `{operationId,resource,action,id,item,expected}`; resource INGREDIENT/ZONE/TABLE,
  action CREATE/UPDATE/DELETE (ingredient chỉ CREATE/UPDATE). CREATE expected=null,
  UUID mới lưu trong journal; DELETE item=null. UPDATE/DELETE expected đúng các
  metadata fields trước sửa: ingredient{name,unit,min_threshold}, zone{name},
  table{table_number,zone_id}. Không nhận tồn, giá vốn, trạng thái/pointer phiên,
  timestamps, created_at, actor hay bất cứ field lạ. Tên1..120, unit1..30,
  threshold hữu hạn0..1e12, tối đa3 số lẻ; zone UUID phải có.
- RPC kiểm admin/active cả replay, khóa row, compare expected; ledger hiện hữu
  scope metadata:<actor>, action metadata.action cùng commit. Result chỉ
  operationId/resource/action/entityId; GET không tạo mutation. Journal trước
  POST, timeout15s, GET đối soát trước khi retry nguyên body/key; refresh SSR.
- Tạo nguyên liệu luôn tồn0/giá vốn0. Đổi unit chỉ khi tồn0, không inventory_logs
  và không menu mapping (kể cả món tạm hết); không diễn giải lại số lượng kho.
  Sửa name/threshold không đụng số liệu phiếu/tồn/giá vốn.
- Không sửa/xóa bàn đang OCCUPIED, có current_session_id hoặc phiên chưa CLOSED
  tham chiếu tới bàn; metadata không nhận assignment/lifecycle. Không xóa bàn
  có lịch sử phiên, không xóa zone còn bàn/nhân sự tham chiếu. Đổi FK hiện hữu
  tables.zone_id, staff_profiles.assigned_zone_id, table_sessions.table_id sang
  ON DELETE RESTRICT thay CASCADE/SET NULL để bảo vệ chứng từ/routing khi đua FK.
  Không thêm bảng/cột/enum. Đổi khu vực bàn trống được phép; KPI lịch sử theo
  zone vẫn bị giới hạn schema chưa có snapshot zone, không tự tạo dữ liệu giả.
- Thu hồi INSERT/UPDATE/DELETE/TRUNCATE và column grants của zones/tables/
  ingredients cho PUBLIC/anon/authenticated. Stock/lifecycle chỉ qua RPC hiện có;
  takeaway và read RLS vẫn các task riêng chưa hoàn tất. Cho phép src/lib/metadata,
  API nêu trên, shared feedback và unit/integration tests theo cấu trúc hiện có.

### 12.11. Amendment M-14c — Ảnh menu và dọn orphan (2026-10-22)

- Browser nén ảnh raster JPEG/PNG/WebP (đầu vào≤10MiB,≤4096px mỗi chiều và
  ≤16M pixels), đầu ra WebP tĩnh≤1024px mỗi chiều, **0<size<81920 bytes**.
  Ngưỡng81920 phải nén lại hoặc báo lỗi. Server POST `/api/admin/menu-images`
  chỉ admin active, cùng Origin, raw image/webp body bị giới hạn stream; dùng
  sharp giải mã đầy đủ, kiểm MIME/magic/dimensions/pages thực, không fetch URL.
  Upload ID UUID ở x-upload-id, actor lấy guard, SHA256 nội dung do server tính.
- Bổ sung private.menu_image_uploads: id uuid PK, actor_id text FK staff_profiles
  RESTRICT, content_hash text64hex, object_path text UNIQUE, public_url text UNIQUE,
  state text CHECK UPLOADING/READY/DELETING/DELETED, created_at và updated_at
  timestamptz DB defaults. Không public table/enum mới. RLS không policy public,
  revoke mọi quyền table/private helper kể cả service_role; chỉ service-only RPC
  fn_menu_image_upload(actor,id,hash,url,action RESERVE/READY),
  fn_claim_menu_image_cleanup(actor) và fn_finish_menu_image_cleanup(actor,id).
- Path bất biến managed/<UUID>.webp trong bucket menu-images; server upload
  upsert=false. Replay upload cùng id phải cùng actor/hash/url; object đã có
  được download và so hash trước READY. Lỗi Storage/DB không tự đổi menu/ảnh cũ;
  retry cùng id/body không overwrite. Không coi upload và DB là một transaction.
- Trigger menu chỉ cho gắn URL đã READY, khóa registry FOR SHARE. Giữ nguyên
  URL legacy được phép khi UPDATE không đổi ảnh; URL mới tùy ý bị chặn (kể cả
  gọi API trực tiếp). Xóa ảnh bằng null. Không nhận path hoặc URL từ browser
  để xóa object. RPC cleanup admin claim tối đa20 ảnh không được bất cứ menu
  nào tham chiếu và đã quá24h, hoặc DELETING để retry; row lock+mark DELETING
  trước remove Storage, finish DELETED chỉ sau remove thành công. Tombstone
  không được gắn/revive. Lỗi menu save/unknown không xóa ảnh ngay.
- POST `/api/admin/menu-images/cleanup` chạy theo yêu cầu Admin, không tự gửi
  lúc build/test. UI có nút dọn ảnh chưa dùng; ảnh mới tải được giữ24h để sửa
  lỗi form/recovery. Reservation upload chưa hoàn tất cũng có thể dọn sau24h;
  upload hoàn tất muộn bị từ chối READY và server cố remove bù. Failure còn
  DELETING để chạy lại; rehearsal Storage thật/M-16 vẫn cần kiểm đối soát orphan.
- Bucket public đọc ảnh, file_size_limit81919/allowed_mime_types image/webp;
  restrictive policies chặn INSERT/UPDATE/DELETE của anon/authenticated kể cả
  có permissive policy cũ. Không phát signed write token hoặc key cho browser.
  Migration có nhánh Storage chỉ chạy khi storage.objects/buckets hiện hữu;
  bootstrap local fixture phải kiểm riêng policy. Không sửa object dữ liệu thật.
- Cho phép src/lib/menu-images, API nêu trên, private types/migration và tests;
  khai báo sharp dependency trực tiếp. Ảnh chỉ upload qua server, bỏ ô dán URL.
  Reserve giới hạn30 upload mới/actor/giờ; replay không tính thêm lượt.

### 12.12. Amendment M-14d — Lists, seed và cấu hình (2026-10-22)

- Bill/phiếu kho phân trang server25 dòng, timestamp+id xác định, lọc status/
  type trước range. Page nguyên dương≤1000000, sai về1; lỗi DB không giả rỗng.
  Bill detail RPC đầy đủ; search client ghi phạm vi trang. Catalog UI25/filter.
- Catalog/live working set keyset id từng250 đến trang rỗng (không tin row cap),
  tối đa200 lượt; cursor lặp/vượt giới hạn phải báo lỗi. Staff chỉ lấy
  items phiên ACTIVE/REQUEST_BILL, KDS thêm station/status; không order history.
- seed.sql no-op production; demo/seed.sql cần app.seed_mode=demo + DB suffix
  _demo, lock và từ chối DB đã có dữ liệu; không reset khi chạy lại. Total demo
  tính từ items. Env public/server tách, URL/key không placeholder, lỗi không
  lộ giá trị. Cron Bearer CRON_SECRET≥32 constant-time trước DB; thiếu503/sai401,
  SELECT limit1 không count, cooldown60s/instance sau xác thực (không giả
  đây là global distributed limiter). Push subject phải cấu hình.
- Provider chưa chốt: giữ mã tích hợp để triển khai M-09/10, khóa có kiểm soát
  entry point takeaway/webhook (thông báo/503 mọi môi trường), không giả bank/
  merchant hoặc unsigned dev bypass. Không mở bằng env flag khi chưa có provider.
- Cho phép lib/config, lib/data, components/ui navigation, demo seed và tests;
  không thêm bảng/cột/enum DB.

### 12.13. Amendment M-04 — Server read boundaries (2026-10-22)

- All eight business tables enable RLS. Revoke table and column privileges from
  PUBLIC/anon/authenticated, including KPI views and application RPC execution.
  Service-only reads follow the existing active-role server guards; private
  tables/helpers remain inaccessible. No browser receives a service-role key.
  Remove legacy service_role table/column grants too, then grant only SELECT
  and staff_profiles UPDATE(push_subscription) for the guarded push registration.
  Business mutations remain owner-executed RPC transactions.
- KPI views use security_invoker=true; service_role has explicit SELECT on their
  sources. Restrictive deny policies also protect business rows if an old
  permissive policy or column grant survives a deployment. Existing current
  session FK remains; preflight rejects pointers to another table or a non-live
  session. One non-CLOSED DINE_IN session per non-null table_id, enforced by a
  unique partial index. Upgrade must stop on dirty data, never silently repair it.
  Stock/threshold/unit costs, menu and item prices, session totals and log costs
  must be finite and nonnegative. Log changes must be finite, nonzero, positive
  for IMPORT/RETURN_BEER and negative for EXPORT_SALE/WASTAGE. Quantity zero is
  retained for fully returned historical items. Add indexes only for the actual
  paged bill/log and own-item/queue reads, with EXPLAIN evidence on local fixtures.
- Guest reads use service-only `fn_get_dine_in_snapshot(p_token text)` through
  SSR or GET `/api/customer/snapshot` with `x-session-token`, no-store responses.
  Only DINE_IN ACTIVE/REQUEST_BILL capabilities can read. Return own display
  session, table/zone labels, public menu fields, own display items and SQL queue
  positions. Never return other sessions/items, customer phones, cost snapshots,
  stock, push subscriptions or staff actors. Queue uses live sessions only and
  strictly earlier created_at, as §5.3 specifies. No new table/column/enum.
- Staff/KDS projections omit cost, stock and push subscriptions; KDS additionally
  omits session tokens and customer contact/payment data. Admin analytics filters
  run through guarded server reads, retaining SQL views/RPC as the source.
- Remove public row-change subscriptions before revocation. Until M-12 private
  Broadcast is implemented, refresh guarded server snapshots periodically only
  while visible/online, on focus/reconnect and after confirmed mutations. This
  temporary fallback is not acceptance evidence for private realtime or push.
  Guest polling must not overlap and must retain explicit unavailable/expired
  state rather than fabricate successful or empty data.
- Allow src/lib/data read contracts/helpers, customer snapshot and admin
  analytics API routes, migration/bootstrap/types and boundary tests in the
  existing project structure. Apply code and SQL together during controlled
  rollout; do not run this migration against the target database during coding.

### 12.14. Amendment M-12b — Durable notification delivery (2026-10-22)

- Extend private.notification_outbox with lease_token uuid, failed_at timestamptz,
  outcome text nullable CHECK SENT/SKIPPED/FAILED. Add private.notification_receipts
  (outbox_id uuid FK RESTRICT, staff_id text FK RESTRICT, subscription_hash text
  CHECK64hex, accepted_at timestamptz DB default; composite PK of first3 fields).
  Both tables enable RLS, no direct grants including service_role. Receipt means
  push service accepted, not proof the phone displayed or sounded a notification.
- Service-only RPCs claim one due job with FOR UPDATE SKIP LOCKED, random lease
  token and45s lease; attempts increment atomically, crash leases are reclaimable.
  Max8 attempts; exponential retry10…300s, exhausted jobs remain visible as FAILED.
  Prepare rechecks live session/current READY quantity/served_at, current active
  staff/admin assignment before each send. Lease and immutable receipt guard all
  completion/ack/expired-subscription operations; no browser-chosen recipients.
- Claiming ORDER_READY durably creates one fallback job due ready_at+120s before
  returning. Fallback only if still READY/unserved/live, targets active staff/admin
  in the physical table's current zone. Missing zone never means shop-wide push.
  Primary targets current active assignee; if missing/inactive, only current zone.
  Active assignee without subscription is not silently replaced by shop broadcast.
  A private trigger enqueues BILL_REQUESTED once on ACTIVE→REQUEST_BILL in the
  same transaction. Other invalidation events are consumed as SKIPPED by push.
- Per-recipient/subscription receipts survive retries/restart. Delivery is at least
  once: crash after provider accepts but before receipt may repeat; stable event
  tags replace duplicate visible notifications. Do not claim exactly-once sending.
  Worker processes at most5 jobs,8 recipients total/3 per job and20s per invocation, whole fetch timeout
  4500ms, no redirects. Failure stores stable codes, never endpoint/key/error text.
- POST /api/cron/notifications uses dedicated NOTIFICATION_WORKER_SECRET≥32 Bearer
  constant-time before DB; validate VAPID config before claim. No scheduler or real
  push is activated during implementation. Scheduler cadence must be≤30s during
  service; actual fallback happens on the first run at/after ready_at+120s.
- Retire caller-driven POST /api/push/notify (authorized callers receive410).
  POST/DELETE /api/push/subscribe only current active staff/admin, same-origin,
  bounded JSON; service-only subscription RPC rechecks role. DELETE requires exact
  expected endpoint so stale devices cannot clear another subscription. Worker
  removes410 subscriptions by hash CAS;404/other failures retry, then remain visible.
  Validate HTTPS provider endpoints (Google FCM, Mozilla Push, Apple Web Push,
  Windows Notify), no custom port/credentials/fragment; validate P-256/auth bytes.
  Revalidate legacy DB subscriptions before outbound HTTP to prevent SSRF.
- Admin notifications page/API show bounded safe job metadata and SQL counters,
  no payload/subscription secrets; admin active DB guard + CAS retry FAILED only.
  Allow lib/notifications, these routes/page/components and unit/PostgreSQL tests.
  Private Broadcast tickets, SW/PWA/audio and device acceptance remain M-12a/c.

### 12.15. Amendment M-12c — Device notifications, audio and offline safety (2026-10-22)

- Register a versioned native `/sw.js` at root, secure context only, no-cache script.
  Use a small explicit asset allowlist instead of enabling Serwist default runtime
  caching: only same-origin icons, original chime WAV and static offline page.
  No authenticated/QR/menu HTML, API, RSC, payment, mutation or remote image cache;
  navigation network-only, failures show generic offline page, never stale orders.
  Offline does not accept/queue background submissions. No business data cached.
- Push payload is generic and click destination restricted to same-origin `/staff`.
  Reuse a staff window or open it; never navigate an in-progress customer cart.
  No URL supplied by payload may open another origin or expose a capability.
  Notification permission only after a staff/admin button gesture; pending actions
  lock double clicks, errors/denied/unsupported stay visible. iOS may require home
  screen installation. Subscription refreshed on explicit enable via existing API;
  no automatic replacement on login. One profile currently holds one subscription,
  so UI explains that enabling another device replaces delivery to the old device.
- Local account ownership contains only Clerk user ID (no subscription/key/token).
  On sign-out/account change detach mismatched browser subscription and close
  notifications, require opt-in for the new account; revoke old endpoint server-side
  when still authorized, otherwise provider410 cleanup applies. Unsubscribe clears
  browser first (privacy), then server exact-endpoint CAS; uncertain cleanup is
  reported and retryable. Push uses generic text even with no open window.
- Replace invalid16-byte MP3 with an original deterministic two-tone PCM WAV,
  render PNG192/512/maskable512/apple180 icons from repo SVG. No external artwork.
  Sound off until user gesture successfully plays reusable audio; denied playback
  resets state, no unhandled rejection. Opt-in per open app instance, no auto-play
  on reload; snapshot events sound only when enabled. No custom locked-screen
  sound guarantee. Buttons are48px minimum with explicit enable/test/mute controls.
- KDS Wake Lock single in-flight request, no duplicate visible acquire; release on
  hide/unmount (including late resolutions), listen release state, re-acquire when
  visible; unsupported/rejected nonfatal with honest status.
- Allow lib/pwa, lib/audio, shared device controls, public SW/offline/icons/chime
  and focused unit/browser tests; no DB schema change. Browser tests use a disposable
  loopback static fixture, not the real DB or push provider. Private Broadcast
  tickets and end-to-end locked-device acceptance remain M-12a/M-16.

### 12.16. Amendment M-12a — private invalidation (2026-10-22)

- One private Broadcast channel per mounted owner: `123dzo:session:<uuid>` or
  `123dzo:role:<staff|kitchen|admin>`. No postgres_changes/presence/client publish.
  Signal `{v:1,id:<random uuid>}` only; no row, token, name, price or contact.
  SQL statement triggers invalidate live dine-in sessions (queue/menu changes
  affect other tables too) and internal roles; closing a session also signals its
  former channel. Refetch always uses the protected API/SSR, never event state.
- POST `/api/customer/realtime-ticket` checks Origin + header capability and live
  DINE_IN ACTIVE/REQUEST_BILL. POST `/api/staff/realtime-ticket` checks Origin and
  current Clerk/DB active role. No body/topic/actor input. Responses no-store.
- Ticket is ES256, authenticated role, audience authenticated, random UUID sub,
  app/scope/actor/topic claims, lifetime120s. Server-only REALTIME_SIGNING_JWK
  must be an EC P-256 private JWK with kid already imported into this project's
  trusted Supabase signing keys. Never derive from anon/service key. Feature flag
  NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED defaults off until staging acceptance.
- `public.fn_realtime_receive_allowed(text)` is the sole read-only boolean
  policy helper callable by authenticated; fixed search_path/security definer,
  rechecks signed claims, lifetime and current live session/active role. It grants
  no base reads or business RPC execution. Restrictive SELECT/INSERT policies on
  managed realtime.messages prevent legacy permissive policies bypassing the
  app namespace. No ALTER of managed RLS; skip managed objects only on plain PG
  fixture. Disable Supabase Allow public access before enabling the flag.
- Renew by fresh authorization before expiry; remove old channel before rejoin.
  Abort requests/remove channel/disconnect socket/timers/listeners on hide,
  offline, account/scope change or unmount; reconnect refetches. Expiry always
  closes local socket even if renewal fails. Server APIs revoke immediately;
  cached Realtime joins may receive generic signals until ticket expires.
- Debounce/coalesce invalidations, bounded UUID dedupe; no ordering dependency.
  Guest refresh schedules a follow-up if a signal arrives during a read. Retain
  visible/online polling as recovery, not proof of private Realtime acceptance.
  DB fanout is O(live dine-in sessions) per statement; measure peak load M-16.
- Allowed additions: lib/realtime, both ticket routes, migration0014/bootstrap,
  focused unit/PG policy and SDK tests. Actual Supabase join/publish/expiry tests
  remain required on the configured test project; local fixtures are not that evidence.

### 12.17. Amendment M-13 — KPI periods and preparation losses

- Reporting uses half-open [start,end) instants; customer-facing date inputs
  interpret whole days in Asia/Ho_Chi_Minh. Revenue uses closed_at, serving/menu
  sold uses served_at, wastage uses log created_at; opened tables uses opened_at
  separately from managed revenue closed_at. Never count unpaid sessions.
- Add table_sessions.activated_at timestamptz nullable (no guessed backfill).
  Takeaway effective queue time is greatest(item.created_at,activated_at);
  missing activation evidence excludes takeaway from queue-time/peak analysis.
  Provider activation writes this atomically in M-10; dine-in uses created_at.
- Financial total_cogs includes served quantity and prepared CANCELLED quantity
  at unit_cost_price snapshot, recognized at served_at if already served or
  cancelled_at otherwise. Prepared means cooking_started_at or ready_at exists.
  No second stock deduction/WASTAGE log. Unprepared cancellations cost zero.
  Full returns quantity0 contribute no money/counts. Net profit retains formula
  revenue minus total_cogs minus manual wastage. Historical reports reflect current
  recorded returns/cancellations; not an immutable accounting closing ledger.
- Five existing views derive from corresponding filtered SQL RPCs over all time;
  add fn_get_peak_hours_kpi(start,end). All retain invoker security/service-only
  access. Kitchen evaluation NO_DATA when no valid cooking samples; staff pickup
  NO_DATA without valid ready/served timestamps. Invalid negative intervals are
  excluded, not clamped to a fabricated zero. Kitchen period uses served_at for
  completed work, cancelled_at for slow-cancelled work.
- Allow analytics range helper, migration0015/bootstrap/types and focused tests.
  UI updates all five projections together, aborts stale filter requests, preserves
  last good data on error and labels last update/no data explicitly.

### 12.18. Amendment UX-01…15 — customer interaction contracts

- Keep existing routes, DB state machine and guarded mutation journals. Customer
  UI translates enums into plain Vietnamese, with no implementation terms.
- Allow src/lib/customer/{cart-lines,order-status,customer-config}, shared
  CustomerShell/AccessibleDialog/MenuCatalog/MenuItemCard/CartSheet/BillPanel/
  OrderProgress and focused tests under existing test directories. No UI mocks
  shipped in src; fixture preview uses production components outside src.
- Cart lines have client-only immutable UUID lineId, never sent to DB. Quantity,
  note and remove address one lineId; note edits do not merge or change keys.
  Versioned persist migrates valid old lines, ignores malformed values, separates
  dine-in and takeaway stores and keeps existing dine-in session isolation.
- Customer typography scoped .customer-app: body/input/name/price16px, secondary
 14px, controls48x48, safe areas and reduced motion. Native dialog primitive owns
  focus trapping/background inertness/Escape/return focus; pending submission
  cannot close accidentally. Dialog contents scroll on short/dynamic viewports.
- Dine-in bottom navigation: menu, ordered items, bill. Review cart separately
  from shared bill. Request bill requires explicit confirmation that the whole
  table stops ordering; unsent cart must be handled first, clear only on confirmed
  success. Split bill optional/collapsed/estimate. READY means ready for service,
  not already being carried. Queue has no fabricated countdown or ETA promise.
- Takeaway checkout requires verified store/bank/provider configuration; when
  missing, show unavailable state with no fake address/account or legacy browser
  writes. Build shared browsing/form/payment/tracking components independently;
  provider-specific activation/recovery acceptance remains gated by M-09/M-10.
- Staff orders actionable READY then bill requests then table map; KDS retains
  per-portion notes, explicit batch IDs and existing atomic actions. Neither UI
  broadens RBAC. Preview/accessibility tests do not replace actual DB, Clerk,
  device or user acceptance. M-16 release still needs operator configuration.

### 12.19. Amendment M-16 — read-only reconciliation

- Add service-only `fn_admin_data_health(actor)` SECURITY DEFINER/fixed path,
  rechecking active admin, returning only check codes/counts and checkedAt.
  No tokens, contacts, prices, staff IDs, row payloads or automatic repairs.
- Checks: duplicate live dine-in sessions per table, current-session pointers,
  stored totals versus full non-cancelled item sums, negative stock, missing or
  reversed KPI timestamps, linked stock export provenance. Snapshot is diagnostic;
  legacy missing evidence must be reconciled by an operator, never guessed.
- Admin /admin/release and GET /api/admin/data-health use current guard/no-store.
  A clean local fixture is not a production release approval. Payment/provider,
  external jobs, real key/private channel/device acceptance remain separate gates.
- Operations/payment audit identities are not pruned automatically. No replay
  tombstone deletion or outbox receipt deletion in this release. Before storage
  pressure, archive with replay protection and operator-approved retention; do
  not delete old operations merely to stay within Free Tier.
- Allow release rehearsal and CI files under integration_test/.github/scripts.
  Backup/restore only disposable fixture DB until separately authorized target.

### 12.20. Amendment — Manual payment confirmation (user direction 2026-10-22)

- V1 uses staff/admin confirmation of actual receipt instead of PayOS/SePay.
  This supersedes webhook-only activation and the provider prerequisite in §3.1,
  §4/Phase5 and earlier amendments/plans. Automatic webhook entry remains disabled;
  selecting a bank does not select a provider. No bank API or payment credential
  is needed for manual confirmation; verified receiving-account details remain
  required before displaying transfer instructions/QR to customers.
- Public takeaway creation/recovery and customer tracking remain separate work.
  PENDING_PAYMENT never enters KDS, serving/queue/KPI sold or READY notifications.
  Only current active staff/admin can confirm; kitchen/customer cannot. The caller
  supplies expected total, CASH/VIETQR, explicit confirmedReceived=true and a bank
  transaction reference for VIETQR. A customer statement/screenshot is not receipt
  verification. Wrong/partial/excess amount or insufficient stock stays pending;
  operators reconcile actual money with the customer, no automatic refund.
- Add service-only RPCs fn_confirm_manual_payment(actor,operation,command),
  fn_get_manual_payment_operation(actor,operation), fn_manual_payment_status(actor,
  pending_page=1,history_page=1). All recheck DB active role, fixed search_path,
  guarded staff/admin API/page, no direct public reads/writes. Command exact fields:
  sessionId,expectedTotal,paymentMethod,reference,confirmedReceived. Amount must
  equal the full bill and stored total, positive/finite. Existing price/cost
  snapshots and created_at remain unchanged. No new table/column/session enum.
- Confirmation locks session→items sorted→menu sorted→ingredients sorted, claims
  existing private.operation_requests action manual.payment.confirm scoped by
  actor. In one transaction: verify pending TAKEAWAY/unprepared items and mappings,
  deduct linked 1:1 stock with EXPORT_SALE, record original export provenance,
  set ACTIVE/activated_at and assigned_staff_id to the confirmer, set BAR_INSTANT READY/ready_at plus outbox (kitchen
  remains QUEUED), save immutable confirmation result. Failure rolls back all.
  Confirmation is receipt of money, not pickup; it never closes a takeaway order.
- Durable result includes operationId/sessionId/amount/paymentMethod/reference,
  confirmedAt from DB, confirmedBy Clerk ID, confirmedByName/Role snapshots and
  status transition PENDING_PAYMENT→ACTIVE. No actor/name/time accepted from client.
  Unique partial indexes prevent a second manual receipt per session or reuse of
  a normalized VIETQR reference (single Techcombank receiving account in v1).
  Correcting a mistake/refund needs a future explicit reversal workflow; no edit,
  delete or unconfirm button. Keep audit identities indefinitely in this release.
- Status RPC exposes only paged internal pending list and confirmation history
  (25 rows, hasMore), including existing dine-in CLOSE operations with their
  immutable actor ID/completion time and stored closed-session payment method.
  Old dine-in names are current directory labels; new manual receipt names are
  snapshots. No audit/PII is returned to customer or kitchen. Missing-export health
  checks exclude unpaid drafts: stock is only exported upon receipt confirmation.
- Client persists original command/operation ID before POST, blocks double submit,
  recovers by GET and only explicit same-key retry after no committed result.
  Ambiguous errors retain journal; known 4xx rollback errors may clear it.
  API validates Origin/JSON/body bounds; server supplies actor, never browser.
- Allowed modules: src/lib/payments, /api/staff/payments, /staff/payments and
  /admin/payments, components/staff/ManualPayments, SQL0017/bootstrap/types and
  focused unit/real PostgreSQL tests. Not a rollout authorization.

### 12.21. Amendment — Manual takeaway creation, recovery and pickup

- Public create requires verified store information and receiving bank/account
  configuration (NEXT_PUBLIC_VIETQR_BANK_ID/ACCOUNT_NO/ACCOUNT_NAME plus explicit
  NEXT_PUBLIC_MANUAL_TAKEAWAY_ENABLED=true and NEXT_PUBLIC_BANK_INFO_VERIFIED=true).
  Default off. No credentials needed for QR instructions, no automatic banking.
- Before POST the browser securely generates a 256-bit hex capability and UUID
  operation ID, persists them with frozen recipient/lines. No Math.random. Request
  header x-takeaway-token carries capability; no API URL/phone-only lookup. The
  DB stores that secret in session_token, scope uses SHA256(secret), ledger never
  stores plaintext secret. Same-token/key lookup or retry recovers only that order.
  Losing response never causes a new operation; local history stores at most20
  capability references, warns shared-device access, offers local removal.
- Add service-only fn_create_takeaway(token,operation,command),
  fn_get_takeaway_create(token,operation), fn_get_takeaway_snapshot(token),
  fn_pickup_takeaway(actor,operation,session), fn_get_takeaway_pickup(actor,operation),
  fn_takeaway_pickup_list(actor,page=1) with25 rows/hasMore.
  Create command {customerName,customerPhone,lines}; line contract as dine-in.
  Strict bounded input/name2..80/mobile0[35789]+8digits, menu available, DB
  snapshot price/cost/station, expected price conflicts require explicit review.
  Creates entire PENDING_PAYMENT order and unique payment_code atomically, no
  stock/log/outbox/activated_at/ready_at. BAR retains READY status with null
  ready_at while unpaid; all operational queries exclude pending sessions.
- Durable abuse quotas use ledger under a global advisory lock: max100 pending
  takeaway orders globally, max3 pending per phone, max2 creates/10minutes/phone,
  max10/day/phone and max100/day globally. These bound data volume, not proof of
  caller identity; rotating phone numbers may exhaust the shared quota. Explicit
  429/busy states, no in-memory limiter or guessed proxy IP. Rollout evaluates
  real traffic before enabling; no claim of bot-proof public ordering.
- Snapshot capability only returns own status/paymentCode/total/opened/activated/
  closed timestamps and own display items; no recipient phone/name, cost, actor,
  bank reference, other orders or staff audit. Revalidate every read incl CLOSED;
  CLOSED may be read for takeover history, unlike dine-in QR. Poll visible/online,
  abort/timeout/cleanup, no background mutations, keep stale/unknown labels.
  Refresh15s with error backoff to60s; stop after CLOSED or401/403/404.
- Payment instructions show bank/account/name/amount/code and copy actions on
  one phone, QR rendered locally using VietQR EMV CRC16, local PNG download with
  readable failure fallback, no external QR service. Menu conflicts refresh the
  catalog, preserve the cart and require consent to displayed old/new prices;
  unavailable lines must be removed explicitly before sending.
  A customer cannot mark paid; UI says waiting for staff verification, do not
  transfer twice. Tracking uses own whole-order states, no fake ETA. All-cancelled
  or zero-item orders require contact, never invite pickup automatically.
- Staff/admin pickup only ACTIVE paid TAKEAWAY with a manual receipt and all
  positive items READY/SERVED or CANCELLED; set unserved READY→SERVED with server
  actor/time, CLOSE/closed_at and immutable ledger action takeaway.pickup once,
  preserving snapshots/stock/payment receipt. Public/customer/kitchen cannot.
  Pickup uses durable client journal/GET recovery. Pending payment status page
  also exposes bounded ready-for-pickup rows internally. This is handover, not a
  second cash receipt. Automatic refund/reversal/expiry remain outside v1.
- Allowed: lib/takeaway, customer/takeaway API/create/snapshot/recovery routes,
  customer TakeawayFlow/PaymentInstructions, staff pickup API/UI, migration0018,
  bootstrap/types/tests. No new tables/columns/enums. Store contact supplied by
  owner may be public configuration; no fabricated account or history backfill.

### 12.22. Amendment M-05 — Durable public request limits (2026-10-23)

- Before a validated public takeaway create/retry, the server claims request
  budget in a separate committed RPC. Business rollback does not refund request
  budget. Recovery/snapshot GET stays available; receipt/order idempotency and
  phone/global successful-create quotas stay unchanged. No external rate service.
- Add private.request_limits: scope_key text NOT NULL (global:takeaway or64hex
  HMAC network fingerprint), window_seconds integer NOT NULL (60 or3600),
  window_start timestamptz NOT NULL, hits integer NOT NULL (1..100001),
  expires_at timestamptz NOT NULL; PRIMARY KEY(scope_key,window_seconds,
  window_start), CHECK expires_at=window_start+window_seconds interval, expiry
  index. No raw IP, phone, token, actor or request body. RLS on, no table/schema
  access for PUBLIC/anon/authenticated/service_role; never exposed/realtime.
  This is expiring quota state, not a business/payment audit: safely delete
  expired buckets only, at most200 per request, in the same quota transaction.
- Service-only fn_takeaway_request_gate(fingerprint,network_minute=10,
  network_hour=120,global_minute=60,global_hour=600) SECURITY DEFINER/fixed path
  validates fingerprint and integer limits1..100000. Serialize with a dedicated
  global advisory lock, DB-clock fixed minute/hour buckets; increment and cap
  global counters before checking per-network counters. Global rejection creates
  no new network rows. Return {allowed:boolean,retryAfter:integer0..3600}; deny
  returns normally so counters persist, never throws a rollback for quota denial.
- Server configuration: TAKEAWAY_REQUEST_SOURCE=vercel accepts only the platform
  x-vercel-forwarded-for header when VERCEL=1; source=proxy requires constant-time
  shared-secret verification of x-dzo-proxy-secret and reads x-dzo-client-ip.
  Trusted ingress must overwrite both headers from its actual peer address and
  restrict direct origin access. Never trust generic Forwarded/X-Forwarded-For,
  or let request headers select the trust mode. Missing/invalid config/IP =>503
  before order write. Proxy secret and TAKEAWAY_RATE_LIMIT_SECRET each32..256
  bytes, server-only. No development bypass or fallback IP.
- Canonical IPv4 and IPv4-mapped IPv6 share a bucket; IPv6 uses /64 to bound
  address rotation. HMAC-SHA256 with a UTC-date namespace avoids raw IP storage;
  keep secret stable within a window. Optional TAKEAWAY_RATE_NETWORK_MINUTE/
  NETWORK_HOUR/GLOBAL_MINUTE/GLOBAL_HOUR configure limits with strict bounds.
  Denied API responds429/Retry-After/no-store with TAKEAWAY_REQUEST_RATE_LIMIT;
  keep the client identity because another concurrent same-key request may have
  committed. This differs from the business quota rejection, which is serialized
  after replay lookup inside create. Gate/DB failures respond503 and also retain
  client journal. No order RPC runs after quota denial or gate unavailability.
  Own committed-operation GET can recover after throttling.
- Limits reduce request/order amplification, not DDoS protection or identity
  verification. Shared NAT users share budget; rotating networks may exhaust a
  global budget. Fixed windows allow bursts around boundaries. Configure ingress
  protection and verify trusted headers on the chosen host before enabling.
  Defaults are for this small shop, not a performance or Free Tier cost guarantee.
- Allowed: lib/takeaway/request-limit.ts, existing takeaway API, migration0019,
  bootstrap/types/env example, focused unit/real PG tests and staging POM/CI.
  No new business tables/columns/enums; no target deployment authorization.

## 13. CẤU TRÚC THƯ MỤC DỰ ÁN & QUY TẮC CHO AI AGENT (DIRECTORY & AGENT RULES)

Khi khởi tạo và viết code cho dự án, bắt buộc tuân thủ cấu trúc thư mục Next.js App Router sau:

```text
├── public/
│   ├── manifest.json            # Cấu hình PWA
│   └── sounds/ting-ting.wav     # Âm thanh thông báo Bếp & Nhân viên
├── src/
│   ├── app/
│   │   ├── customer/            # Public: bảo vệ dữ liệu bằng capability phiên
│   │   │   ├── order/[token]/   # Khách ngồi tại bàn (Dine-in PWA)
│   │   │   └── takeaway/        # Khách đặt mang về (Takeaway PWA)
│   │   ├── access-denied/       # Thông báo từ chối, không có dữ liệu nội bộ
│   │   ├── (auth-protected)/    # Clerk login + server guard role/active
│   │   │   ├── staff/           # Giao diện Nhân viên chạy bàn
│   │   │   ├── kitchen/         # Giao diện Màn hình Bếp (KDS Tablet)
│   │   │   └── admin/           # Giao diện Chủ quán (Dashboard KPI, Menu, Kho, Bill)
│   │   └── api/
│   │       ├── webhooks/payment/# Nhận Webhook từ PayOS / SePay
│   │       ├── push/            # Đăng ký & Gửi Web Push Notification
│   │       └── cron/keep-alive/ # Chống ngủ đông Supabase
│   ├── components/
│   │   ├── ui/                  # Các component gốc của shadcn/ui
│   │   ├── customer/            # Component giỏ hàng, thanh tiến độ bếp, QR chia sẻ bàn
│   │   ├── kitchen/             # Component thẻ Gom món (Batch Card) & Hàng đợi FIFO
│   │   ├── staff/               # Component Sơ đồ bàn, Modal mở bàn, Trả bia
│   │   └── admin/               # Component Biểu đồ Recharts, Bảng KPI, Xuất nhập kho
│   ├── lib/
│   │   ├── auth/staff-guard.ts  # Server page/API guards, quyền hiện tại từ DB
│   │   ├── supabase/            # Khởi tạo Supabase Client (Browser & Server)
│   │   ├── store/               # Zustand store quản lý giỏ hàng của khách
│   │   └── utils.ts             # Hàm định dạng tiền tệ VNĐ, nén ảnh WebP, tính giờ
│   ├── types/
│   │   └── database.types.ts    # Kiểu dữ liệu TypeScript khớp 100% với Mục 12
│   └── middleware.ts            # Clerk login; role/active kiểm tra tại page/API
└── supabase/
    └── schema.sql               # Toàn bộ câu lệnh tạo bảng, Realtime & SQL Views cho KPI
```

### Quy tắc thực thi dành cho AI Agent (Implementation Guidelines):
1. **Không tự chế thêm bảng hoặc đổi tên cột:** Luôn tham chiếu chính xác **Mục 12** khi viết câu lệnh truy vấn Supabase.
2. **Bảo đảm Realtime:** Bảng `order_items` và `table_sessions` phải được bật `ALTER PUBLICATION supabase_realtime ADD TABLE ...`. Ở phía Client, luôn nhớ `unsubscribe` kênh Realtime trong hàm cleanup của `useEffect`.
3. **Giao diện Mobile-First cho Khách & Nhân viên, Tablet-Landscape cho Bếp:**
   * Trang `/customer/order/[token]` và `/staff` thiết kế tối ưu cho màn hình dọc điện thoại (nút bấm cao tối thiểu `48px`).
   * Trang `/kitchen` thiết kế tối ưu cho màn hình ngang máy tính bảng (chia 2 cột lớn: Cột trái là **Gom món trùng - Batch View**, Cột phải là **Thứ tự gọi món - FIFO Queue**).
