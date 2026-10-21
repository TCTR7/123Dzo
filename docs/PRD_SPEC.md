# 🍻 TÀI LIỆU ĐẶC TẢ NGHIỆP VỤ & KỸ THUẬT TOÀN DIỆN (PRD & TECH SPEC)

**Tên dự án:** Hệ thống Quản lý Quán nhậu, Gọi món QR & Điều phối Bếp thời gian thực (Smart POS & KDS PWA)  
**Phiên bản:** 2.0 (AI-Agent Ready & Full Analytics KPI)  
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
  * Khi khách vào bàn, Nhân viên phụ trách khu vực bấm **"Mở bàn"** trên PWA Nhân viên -> Hệ thống tạo `table_sessions` mới (`session_type = 'DINE_IN'`) và sinh ra một đường dẫn chứa `session_token` ngẫu nhiên (VD: `/t/k9x2m8p1`) dưới dạng **Mã QR động**.
  * Nhân viên đưa màn hình điện thoại (hoặc phiếu in nhiệt) cho khách quét. Khách đầu tiên quét xong có thể bấm *"Hiện mã QR bàn"* trên máy mình cho bạn nhậu cùng bàn quét theo để vào chung giỏ hàng.
  * Khi bàn thanh toán xong, `session_token` lập tức chuyển sang trạng thái `CLOSED` và vô hiệu hóa vĩnh viễn.

* **Luồng 2 - Khách đặt từ xa / Mang về (Takeaway):**
  * Sử dụng 1 mã QR / Đường dẫn tĩnh duy nhất (`/mang-ve`).
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
* **US-C05 (Đặt mang về):** Chọn món qua link `/mang-ve`, thanh toán trước qua mã VietQR tự động và theo dõi trên màn hình xem khi nào bếp nấu xong để canh giờ ghé quán lấy đồ.

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

| Thành phần | Công nghệ lựa chọn | Mục đích & Lý do sử dụng |
| :--- | :--- | :--- |
| **Framework chính** | **Next.js 15 (App Router) + TypeScript** | Chung 1 codebase cho cả Frontend, PWA và API Webhook. |
| **Giao diện & Biểu đồ** | **Tailwind CSS + shadcn/ui + Recharts** | Dựng UI cảm ứng nhanh, dùng `Recharts` vẽ biểu đồ phân tích doanh thu/KPI. |
| **Quản lý State** | **Zustand** | Lưu giỏ hàng tạm của khách trên trình duyệt (`localStorage`). |
| **PWA Engine** | **`@serwist/next`** | Cài đặt ứng dụng ra màn hình chính, lưu đệm (cache) ảnh menu giúp tải siêu tốc. |
| **Xác thực (Auth)** | **Clerk (`@clerk/nextjs`)** | Quản lý đăng nhập & phân quyền (`Public Metadata` role: `admin`, `staff`, `kitchen`). |
| **Database & Realtime** | **Supabase (PostgreSQL)** | Lưu trữ dữ liệu, chạy SQL Views cho Dashboard và dùng **Supabase Realtime** đồng bộ tức thì. Region: **Singapore (`ap-southeast-1`)**. |
| **Thông báo đẩy** | **`web-push` (VAPID)** | Gửi thông báo có âm thanh về điện thoại nhân viên ngay cả khi khóa màn hình. |
| **Thanh toán QR** | **PayOS** (hoặc **SePay**) | Tạo mã VietQR động và bắn Webhook xác nhận tiền về tài khoản sau 2-5 giây. |
| **Tiện ích bổ trợ** | **`qrcode.react`, `browser-image-compression`** | Vẽ mã QR tại bàn và nén ảnh menu xuống < 80KB chuẩn WebP trước khi upload. |

---

## 9. SƠ ĐỒ ĐỊNH TUYẾN MÀN HÌNH & API (ROUTING MAP)

### 9.1. Giao diện Người dùng (Pages)
* **Phân hệ Khách hàng (Public - Bảo vệ bằng Session Token):**
  * `/t/[session_token]` : Màn hình gọi món, xem giỏ hàng, xem vị trí bếp & gọi tính tiền của khách tại bàn.
  * `/mang-ve` : Màn hình đặt món mang về, thanh toán VietQR và tra cứu tiến độ đơn bằng SĐT.
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
3. **Âm thanh cảnh báo (Audio Feedback):** Màn hình `/kitchen` (khi có đơn mới) và `/staff` (khi có món chín) phải phát âm thanh `ting-ting.mp3` rõ ràng.
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
   * `id` (uuid, PK), `session_id` (uuid, FK -> `table_sessions.id`), `menu_item_id` (uuid, FK -> `menu_items.id`), `quantity` (int), `note` (text, nullable), `station` (text: `'KITCHEN' | 'BAR_INSTANT'`), `status` (text: `'QUEUED' | 'COOKING' | 'READY' | 'SERVED' | 'CANCELLED'`), `batch_id` (uuid, nullable - mã gom nhóm khi bếp nấu gộp), `unit_price` (numeric - snapshot giá bán lúc đặt), `unit_cost_price` (numeric - snapshot giá vốn lúc đặt), `served_by_staff_id` (text, nullable, FK -> `staff_profiles.id`), `created_at` (timestamptz), `cooking_started_at` (timestamptz, nullable), `ready_at` (timestamptz, nullable), `served_at` (timestamptz, nullable), `cancelled_at` (timestamptz, nullable), `cancelled_by` (text, nullable), `cancel_reason` (text, nullable).

---

## 13. CẤU TRÚC THƯ MỤC DỰ ÁN & QUY TẮC CHO AI AGENT (DIRECTORY & AGENT RULES)

Khi khởi tạo và viết code cho dự án, bắt buộc tuân thủ cấu trúc thư mục Next.js App Router sau:

```text
├── public/
│   ├── manifest.json            # Cấu hình PWA
│   └── sounds/ting-ting.mp3     # Âm thanh thông báo Bếp & Nhân viên
├── src/
│   ├── app/
│   │   ├── (public)/            # Nhóm route không cần đăng nhập Clerk
│   │   │   ├── t/[token]/       # Giao diện Khách ngồi tại bàn (Dine-in PWA)
│   │   │   └── mang-ve/         # Giao diện Khách đặt mang về (Takeaway PWA)
│   │   ├── (protected)/         # Nhóm route bảo vệ bởi Clerk Middleware
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
│   │   ├── supabase/            # Khởi tạo Supabase Client (Browser & Server)
│   │   ├── store/               # Zustand store quản lý giỏ hàng của khách
│   │   └── utils.ts             # Hàm định dạng tiền tệ VNĐ, nén ảnh WebP, tính giờ
│   ├── types/
│   │   └── database.types.ts    # Kiểu dữ liệu TypeScript khớp 100% với Mục 12
│   └── middleware.ts            # Clerk Middleware kiểm tra role (admin, staff, kitchen)
└── supabase/
    └── schema.sql               # Toàn bộ câu lệnh tạo bảng, Realtime & SQL Views cho KPI
```

### Quy tắc thực thi dành cho AI Agent (Implementation Guidelines):
1. **Không tự chế thêm bảng hoặc đổi tên cột:** Luôn tham chiếu chính xác **Mục 12** khi viết câu lệnh truy vấn Supabase.
2. **Bảo đảm Realtime:** Bảng `order_items` và `table_sessions` phải được bật `ALTER PUBLICATION supabase_realtime ADD TABLE ...`. Ở phía Client, luôn nhớ `unsubscribe` kênh Realtime trong hàm cleanup của `useEffect`.
3. **Giao diện Mobile-First cho Khách & Nhân viên, Tablet-Landscape cho Bếp:**
   * Trang `/t/[token]` và `/staff` thiết kế tối ưu cho màn hình dọc điện thoại (nút bấm cao tối thiểu `48px`).
   * Trang `/kitchen` thiết kế tối ưu cho màn hình ngang máy tính bảng (chia 2 cột lớn: Cột trái là **Gom món trùng - Batch View**, Cột phải là **Thứ tự gọi món - FIFO Queue**).