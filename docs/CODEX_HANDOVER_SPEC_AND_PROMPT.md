# 🎯 TÀI LIỆU ĐẶC TẢ & PROMPT TRIỂN KHAI DÀNH CHO CODEX (OPERATOR HANDOVER & ONBOARDING)

Tài liệu này định nghĩa **chính xác và giới hạn tuyệt đối** các hạng mục cần triển khai cho tính năng **Operator Handover (`/operator`)**, **Khởi tạo tài khoản Clerk phân cấp (`operator` -> `admin` -> `staff`/`kitchen`)**, và **Popup Hướng dẫn sử dụng & Cài đặt PWA (`OnboardingGuideModal`)**.

---

## 🚫 1. RÀO CHẮN CHỐNG OVER-ENGINEERING (BẮT BUỘC TUÂN THỦ 100%)

Khi triển khai tài liệu này, **Codex TUYỆT ĐỐI KHÔNG ĐƯỢC**:
1. **KHÔNG tạo thêm bất kỳ bảng (table) hay cột (column) mới nào trong PostgreSQL / Supabase.** Tiếp tục dùng đúng 8 bảng hiện có trong `supabase/schema.sql` (cột `staff_profiles.role` đã hỗ trợ `'operator' | 'admin' | 'staff' | 'kitchen'`).
2. **KHÔNG viết thêm bất kỳ hàm PL/pgSQL RPC, Trigger, hay file `.sql` migration nào.** Mọi thao tác đọc/ghi database phải dùng trực tiếp `supabase.from('...').select/insert/update/delete` trong Next.js.
3. **KHÔNG tạo sổ cái `localStorage` để khóa nút bấm (`operation_requests` / pending journal).** Chỉ sử dụng `localStorage` cho 2 việc nhẹ nhàng:
   * Lưu cờ `dzo_onboarding_dismissed_v1` (boolean) để biết người dùng đã tắt tự động hiện Popup Hướng dẫn hay chưa.
   * Lưu cấu hình hiển thị nhanh trên Phiếu bàn giao (Tên quán, Địa chỉ, SĐT, Ngân hàng VietQR).
4. **KHÔNG thêm mục thứ 6 vào thanh điều hướng 5 mục cốt lõi của `/admin`** (`/admin`, `/admin/bills`, `/admin/menu`, `/admin/inventory`, `/admin/staff`). Nút mở **`❓ Hướng dẫn & Cài App`** và nút chuyển sang **`/operator`** (chỉ hiện khi `role === 'operator'`) phải đặt ở góc phải của thanh Header trên cùng (cạnh khu vực tài khoản `<UserButton />`).
5. **KHÔNG cài thêm thư viện ngoài nặng nề** (như `puppeteer`, `jspdf`, `html2canvas`...). Sử dụng **HTML5 `<canvas>`原生 (Native Canvas API)** kết hợp SVG QR của `qrcode.react` để xuất file ảnh `.PNG` sắc nét 100% và dùng **`window.print()` với CSS `@media print`** để xuất/in file `.PDF` chuẩn khổ A4/K80.

---

## 🏗️ 2. CHI TIẾT KỸ THUẬT CÁC HẠNG MỤC CẦN TRIỂN KHAI

### Hạng mục A: Phân quyền 4 cấp (`operator` > `admin` > `staff` / `kitchen`) & Tự động nhận diện Operator
1. **Cập nhật kiểu dữ liệu `StaffRole`** trong `src/types/database.types.ts`:
   ```ts
   export type StaffRole = 'operator' | 'admin' | 'staff' | 'kitchen';
   ```
2. **Cập nhật logic phân quyền trong `src/lib/auth/roles.ts`:**
   * Hỗ trợ biến môi trường `OPERATOR_EMAILS` hoặc `OPERATOR_CLERK_USER_IDS` (hoặc nếu bảng `staff_profiles` đang **trống hoàn toàn 0 dòng** sau khi mới deploy): Tài khoản đầu tiên đăng nhập hoặc tài khoản khớp `OPERATOR_EMAILS` sẽ được tự động upsert vào `staff_profiles` với `role = 'operator'`. Nhờ vậy, ngay khi vừa deploy dự án mới lên mạng, người triển khai (`operator`) đăng nhập vào là có ngay quyền `operator` mà không cần phải mở Supabase nhập tay!
   * Quyền truy cập các route:
     * `operator`: Toàn quyền cao nhất — truy cập được `/operator`, `/admin/*`, `/staff`, `/kitchen`.
     * `admin` (Chủ quán): Truy cập được `/admin/*`, `/staff`, `/kitchen` (Không vào được `/operator`).
     * `staff` (Nhân viên chạy bàn): Truy cập được `/staff`.
     * `kitchen` (Đầu bếp): Truy cập được `/kitchen`.

---

### Hạng mục B: API Tạo tài khoản trực tiếp qua Clerk (`POST /api/accounts/provision`)
Tạo file `src/app/api/accounts/provision/route.ts`:
1. **Xác thực người gọi:** Dùng `getCurrentStaffProfile()`.
   * Nếu tạo tài khoản có `role === 'admin'` (Chủ quán) hoặc `role === 'operator'`: **Bắt buộc người gọi phải là `operator`**.
   * Nếu tạo tài khoản có `role === 'staff'` hoặc `role === 'kitchen'`: **Người gọi phải là `operator` hoặc `admin` (Chủ quán)**.
2. **Input Body JSON:**
   ```ts
   interface ProvisionAccountBody {
     fullName: string;
     emailAddress?: string;
     username?: string;
     password: string;
     role: 'admin' | 'staff' | 'kitchen';
     assignedZoneId?: string | null;
   }
   ```
3. **Xử lý với `@clerk/nextjs/server` (`await clerkClient()`):**
   * Gọi `client.users.createUser({ emailAddress: emailAddress ? [emailAddress] : undefined, username: username || undefined, password, firstName: fullName, skipPasswordChecks: true })` để tạo tài khoản đăng nhập thật trên Clerk.
   * Nếu email/username đã tồn tại trên Clerk, tìm `user` hiện có bằng `client.users.getUserList(...)` và lấy `user.id` (đồng thời cập nhật mật khẩu nếu cần).
   * Dùng `createSupabaseServiceRoleClient()` để `upsert` vào bảng `public.staff_profiles`:
     * `id`: `clerkUser.id`
     * `full_name`: `fullName`
     * `role`: `role`
     * `assigned_zone_id`: `assignedZoneId ?? null`
     * `is_active`: `true`
   * Trả về JSON `{ success: true, profile, credentials: { loginIdentifier, password, loginUrl } }`.

---

### Hạng mục C: Nâng cấp trang `/admin/staff` cho Chủ quán tạo tài khoản Nhân viên
Trong `src/components/admin/StaffAndTableManager.tsx`:
1. Tại form **"Thêm nhân sự mới"**:
   * Cho phép Chủ quán chọn tạo trực tiếp bằng **Email / Tên đăng nhập + Mật khẩu khởi tạo** (gọi `POST /api/accounts/provision`) thay vì bắt Chủ quán phải tự vào Clerk copy `clerk_user_id`!
   * Vẫn giữ một tùy chọn thu gọn *(Nâng cao: Nhập `clerk_user_id` có sẵn)* nếu cần.
   * Chủ quán chỉ được chọn vai trò `staff` (Phục vụ) hoặc `kitchen` (Đầu bếp). Riêng nếu người đang đăng nhập là `operator` thì có thể chọn thêm `admin` hoặc `operator`.
   * Sau khi tạo xong tài khoản nhân viên, hiển thị hộp thông tin tài khoản vừa tạo (Email/Username + Mật khẩu + Nút Copy nhanh) để Chủ quán gửi qua Zalo cho nhân viên.

---

### Hạng mục D: Màn hình Quản trị Hệ thống & Bàn giao của Operator (`/operator`)
Tạo trang `src/app/(auth-protected)/operator/page.tsx` và component `src/components/operator/OperatorConsole.tsx`:
1. **Khu vực 1 — Thông tin Hệ thống & Phiên bản Build (System & Build Version):**
   * Hiển thị rõ:
     * **App Version:** Đọc từ `package.json` (`v2.0.0`).
     * **Build / Environment:** `process.env.NODE_ENV`, `NEXT_PUBLIC_APP_URL`, trạng thái kết nối Supabase (`Connected - 8 Core Tables`) & Clerk Auth.
     * Thống kê nhanh hiện trạng DB: Tổng số tài khoản (`staff_profiles`), tổng số khu vực (`zones`), bàn (`tables`), món trong thực đơn (`menu_items`), và phiên đơn hàng (`table_sessions`).
2. **Khu vực 2 — Tạo tài khoản Chủ quán (`admin`) & Thông tin Quán bàn giao:**
   * Form nhập:
     * Tên Quán nhậu (VD: *Quán Nhậu 123Dzô*), Địa chỉ & Hotline quán.
     * Họ tên Chủ quán (`fullName`), Email hoặc Username đăng nhập, Mật khẩu khởi tạo (`password`).
   * Khi bấm **"Tạo Tài Khoản Chủ Quán & Sinh Phiếu Bàn Giao"**:
     * Gọi `POST /api/accounts/provision` với `role: 'admin'`.
     * Tự động điền thông tin tài khoản Chủ quán vừa tạo xuống **Phiếu Bàn Giao Hệ Thống** bên dưới.
3. **Khu vực 3 — Phiếu Bàn Giao Hệ Thống cho Khách hàng (Handover Kit - Xuất PNG & PDF):**
   * Hiển thị một tấm thẻ bàn giao trực quan, sang trọng, có đầy đủ:
     * **Tiêu đề:** PHIẾU BÀN GIAO HỆ THỐNG SMART POS & KDS 123DZÔ (Kèm Tên quán & Phiên bản `v2.0.0`).
     * **Thông tin tài khoản Chủ quán (`admin`):**
       * Đường dẫn đăng nhập quản trị: `<origin>/admin`
       * Tài khoản (Email / Username): `...`
       * Mật khẩu khởi tạo: `...`
     * **2 Mã QR lớn đặt cạnh nhau:**
       1. **QR 1 — Đăng nhập Quản trị cho Chủ quán (`/admin`):** Chủ quán quét mã này trên điện thoại/máy tính bảng để vào thẳng trang đăng nhập quản lý quán & cài đặt App PWA.
       2. **QR 2 — Mã QR Cố định cho Khách Đặt Mang Về (`/customer/takeaway`):** Mã QR chung cố định để Chủ quán in dán trước quầy, đăng Fanpage Facebook hoặc gửi Zalo cho khách quen đặt mồi mang về.
     * **Tóm tắt 3 bước bắt đầu dành cho Chủ quán:**
       1. Quét **QR 1** để đăng nhập tài khoản Chủ quán và cài đặt App ra màn hình chính điện thoại.
       2. Vào mục **Thực đơn** để cập nhật món/giá và mục **Bàn & Nhân sự** để tạo tài khoản cho nhân viên chạy bàn & đầu bếp.
       3. In **QR 2 (Đặt mang về)** dán tại quầy; còn khách ngồi tại bàn thì nhân viên bấm *"Mở bàn & Tạo QR"* theo từng lượt khách.
   * **2 Nút xuất file bàn giao bấm ăn ngay:**
     1. **🖼️ Tải Ảnh Bàn Giao (`.PNG`):** Dùng HTML5 `<canvas>` vẽ trực tiếp thẻ bàn giao kèm 2 mã QR từ SVG sang ảnh PNG độ phân giải cao (`1200x800px`) và tải về máy (`Ban-Giao-123Dzo-<TenQuan>.png`) để gửi qua Zalo/Messenger cho chủ quán.
     2. **📄 Xuất / In File `.PDF`:** Gọi `window.print()` với vùng in `@media print` được căn chỉnh vừa khít 1 trang A4/PDF sắc nét để lưu thành PDF gửi cho khách hàng.
4. **Khu vực 4 — Tiện ích Khởi tạo & Làm sạch dữ liệu bàn giao (Quick Handover Tools):**
   * Nút **"🌱 Tạo dữ liệu mẫu (Khu vực, Bàn & Menu mẫu)"**: Nếu quán mới tinh chưa có bàn/món, bấm 1 nút để tạo nhanh 2 Khu vực, 6 Bàn và 6 Món nhậu/Bia mẫu cho Chủ quán dùng thử.
   * Nút **"🧹 Xóa dữ liệu hóa đơn test (Reset Đơn nháp về 0đ trước khai trương)"**: Xóa sạch `order_items` và `table_sessions` dùng thử, đồng thời trả trạng thái mọi `tables` về `'AVAILABLE'` (giữ nguyên Thực đơn, Bàn, Khu vực, Nhân sự và Kho).

---

### Hạng mục E: Popup Hướng dẫn Sử dụng & Cài đặt App (PWA Onboarding & Help Guide)
Tạo component `src/components/shared/OnboardingGuideModal.tsx` và tích hợp vào Header của `/admin`, `/staff`, `/kitchen`, `/operator`:
1. **Cơ chế hiển thị tự động & xem lại:**
   * Ngay sau khi người dùng đăng nhập vào `/admin`, `/staff`, hoặc `/kitchen`, kiểm tra `window.localStorage.getItem('dzo_onboarding_seen_v1')`.
   * Nếu chưa có (`null`), tự động mở Popup Hướng dẫn và chọn sẵn Tab đúng với vai trò của người đang đăng nhập (`admin`, `staff`, hoặc `kitchen`).
   * Khi người dùng bấm **"Đã hiểu, bắt đầu làm việc"** (hoặc tắt popup), lưu `localStorage.setItem('dzo_onboarding_seen_v1', 'true')`.
   * Trên thanh Header của `/admin` (`src/app/(auth-protected)/admin/layout.tsx`), `/staff` (`StaffDashboard.tsx`), và `/kitchen` (`KitchenKdsBoard.tsx`), đặt nút **`❓ Hướng dẫn & Cài App`** ở góc phải (cạnh badge vai trò và `<UserButton />`, **ngoài** 5 tab menu cốt lõi) để người dùng bấm mở lại popup bất cứ lúc nào.
2. **Nội dung 4 Tab trong Popup Hướng dẫn (`OnboardingGuideModal.tsx`):**
   * **Tab 1 — 📱 Cài đặt App ra Màn hình chính (PWA) & Bật Chuông:**
     * Hướng dẫn cho **iPhone / iPad (Safari):** Bấm nút **Chia sẻ (Share)** ở cạnh dưới trình duyệt $\rightarrow$ Chọn **"Thêm vào MH chính" (Add to Home Screen)** $\rightarrow$ Mở app từ màn hình chính và bấm *"Bật thông báo đẩy"*.
     * Hướng dẫn cho **Android / Máy tính bảng / Chrome:** Bấm biểu tượng **Cài đặt ứng dụng (Install App)** trên thanh địa chỉ hoặc menu 3 chấm $\rightarrow$ Chọn **"Cài đặt"**.
   * **Tab 2 — 👑 Hướng dẫn cho Chủ quán (`admin`):**
     * Giải thích ngắn gọn 5 mục cốt lõi: **Dashboard KPI** (xem lãi/lỗ cuối tháng), **Thu ngân & Hóa đơn** (duyệt chuyển khoản đơn mang về & in bill K80), **Thực đơn** (thêm món, báo hết món 86ing), **Kho** (nhập bia/nguyên liệu), **Bàn & Nhân sự** (tạo bàn & tạo tài khoản cho nhân viên/đầu bếp).
   * **Tab 3 — 🍻 Hướng dẫn cho Nhân viên phục vụ (`staff`):**
     * Quy trình 4 bước: (1) Khách vào bàn $\rightarrow$ Bấm **"Mở bàn & Tạo QR"** đưa khách quét; (2) Món chín / Bia lấy ngay $\rightarrow$ Máy kêu chuông, đi bưng và bấm **"Bưng ngay"**; (3) Cuối buổi nếu dư bia $\rightarrow$ Bấm **"Trả bia thừa"**; (4) Khách tính tiền $\rightarrow$ Nhân viên phụ trách bàn (hoặc Chủ quán) bấm **"Chốt & Đóng bill"**.
   * **Tab 4 — 🔥 Hướng dẫn cho Đầu bếp (`kitchen`):**
     * Quy trình 3 bước trên Tablet Bếp: (1) Xem cột **Gom món trùng (Batch Cooking)** bên trái để nấu gộp nhiều bàn cùng lúc cho nhanh; (2) Bấm **"Nhận nấu"** khi bật bếp và bấm **"Hoàn thành"** khi gắp ra đĩa để gọi nhân viên vào bưng; (3) Khi hết nguyên liệu, gạt nút **"Báo hết món (86ing)"** để khóa món trên thực đơn của khách ngay lập tức.

---

## 📋 3. PROMPT MẪU ĐỂ COPY-PASTE CHO CODEX

Anh chỉ cần copy nguyên đoạn trong khung dưới đây và gửi cho **Codex**:

```text
Hãy đọc kỹ file `docs/PRD_SPEC.md`, `AGENTS.md` và đặc biệt là `docs/CODEX_HANDOVER_SPEC_AND_PROMPT.md`.

Nhiệm vụ của bạn là triển khai ĐÚNG 5 Hạng mục (A, B, C, D, E) đã được đặc tả chi tiết trong `docs/CODEX_HANDOVER_SPEC_AND_PROMPT.md`, bao gồm:
1. Nâng cấp phân quyền 4 vai trò (`operator`, `admin`, `staff`, `kitchen`) trong `src/types/database.types.ts`, `src/lib/auth/roles.ts`, `src/middleware.ts`, cho phép tài khoản đầu tiên khi DB trống hoặc khớp `OPERATOR_EMAILS` tự động nhận quyền `operator`.
2. Tạo API `POST /api/accounts/provision` (`src/app/api/accounts/provision/route.ts`) sử dụng `@clerk/nextjs/server` (`clerkClient()`) để `operator` tạo tài khoản Chủ quán (`admin`), và `admin`/`operator` tạo tài khoản Nhân viên (`staff`) & Đầu bếp (`kitchen`) trực tiếp kèm đồng bộ vào bảng `staff_profiles`.
3. Cập nhật form thêm nhân sự tại `/admin/staff` (`src/components/admin/StaffAndTableManager.tsx`) để Chủ quán tạo trực tiếp tài khoản đăng nhập (Email/Username + Password) cho nhân viên mà không cần nhập `clerk_user_id` thủ công.
4. Xây dựng trang `/operator` (`src/app/(auth-protected)/operator/page.tsx` và `src/components/operator/OperatorConsole.tsx`) dành riêng cho `operator`: hiển thị thông tin chung + version bản build (`package.json`), form tạo tài khoản Chủ quán (`admin`), khu vực Phiếu Bàn Giao Hệ Thống (gồm thông tin đăng nhập Chủ quán, QR đăng nhập quản trị `/admin`, và QR Đặt mang về cố định `/customer/takeaway`) cho phép xuất ra ảnh `.PNG` (bằng HTML5 Canvas原生) và in/lưu `.PDF` (`window.print()`), cùng 2 nút tiện ích Tạo dữ liệu mẫu & Reset hóa đơn test trước khai trương.
5. Tạo component `src/components/shared/OnboardingGuideModal.tsx` (Hướng dẫn sử dụng theo vai trò & Hướng dẫn cài đặt App PWA iOS/Android): tự động bật lên ở lần đăng nhập đầu tiên và có thể mở lại bất cứ lúc nào qua nút "❓ Hướng dẫn & Cài App" đặt trên thanh Header chung của `/admin`, `/staff`, `/kitchen`, `/operator` (cạnh nút User, tách biệt khỏi 5 menu cốt lõi của `/admin`).

RÀNG BUỘC BẮT BUỘC (STRICT GUARDRAILS):
- TUYỆT ĐỐI KHÔNG tạo thêm bảng mới, cột mới, hàm PL/pgSQL RPC, hay file migration `.sql`. Giữ nguyên 8 bảng trong `supabase/schema.sql`.
- TUYỆT ĐỐI KHÔNG tạo sổ cái `localStorage` khóa nút bấm hay tạo thêm tab thứ 6 trong menu `/admin`.
- Sau khi code xong, hãy chạy `npx tsc --noEmit`, `npx vitest run` và `npm run build` để đảm bảo 0 lỗi TypeScript và build thành công 100%.
```
