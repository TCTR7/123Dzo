# Deploy 123Dzô lên Vercel — làm lần lượt từ bước 1

Hướng dẫn này dùng **Clerk production + Supabase + Vercel + domain riêng**. Ví dụ địa chỉ app là **https://pos.example.com**: thay bằng domain của bạn ở tất cả các bước.

Chuẩn bị: tài khoản GitHub, Vercel, Supabase, Clerk và quyền sửa DNS domain. Dùng gói Vercel cho phép thương mại nếu triển khai cho quán kinh doanh; [Hobby chỉ dành cho cá nhân/phi thương mại](https://vercel.com/docs/limits/fair-use-guidelines).

## 1. Chuẩn bị Supabase và chạy SQL

Mở [Supabase Dashboard](https://supabase.com/dashboard), chọn **project đang dùng trong `.env.local`**.

**Nếu dùng project hiện có:**

1. Vào **SQL Editor → New query**.
2. Chạy đoạn dưới để role `operator` hoạt động; nếu đã chạy rồi, bỏ qua:

```sql
BEGIN;
ALTER TABLE public.staff_profiles
DROP CONSTRAINT IF EXISTS staff_profiles_role_check;
ALTER TABLE public.staff_profiles
ADD CONSTRAINT staff_profiles_role_check
CHECK (role IN ('operator', 'admin', 'staff', 'kitchen'));
COMMIT;
```

3. Mở [supabase/schema.sql](../supabase/schema.sql) trong IDE.
4. Tìm dòng `-- Browser access goes through authorized Next.js APIs` ở gần cuối.
5. Copy **từ dòng đó đến hết file**, dán vào một query mới trong Supabase, bấm **Run**. Đây là khối `REVOKE/GRANT` bạn đang chọn trong IDE.
6. Chạy query sau để kiểm tra; kết quả phải là **false / false / true**:

```sql
SELECT
  has_table_privilege('anon', 'public.table_sessions', 'SELECT') AS anon_read,
  has_table_privilege('authenticated', 'public.order_items', 'INSERT') AS browser_insert,
  has_table_privilege('service_role', 'public.table_sessions', 'SELECT') AS server_read;
```

**Nếu muốn dùng DB production mới hoàn toàn:** Supabase → **New project** → đặt tên `123dzo-production` → đặt mật khẩu DB → chọn region Singapore → **Create**. Sau khi project sẵn sàng, vào SQL Editor, copy **toàn bộ** `supabase/schema.sql` rồi Run một lần; không cần chạy lại các đoạn ở trên.

**Xong bước này:** Table Editor có 8 bảng: `zones`, `staff_profiles`, `tables`, `ingredients`, `inventory_logs`, `menu_items`, `table_sessions`, `order_items`.

## 2. Tạo nơi lưu ảnh món và lấy 3 giá trị Supabase

Trong **cùng project Supabase**:

1. Vào **Storage → New bucket**.
2. Name: **`menu-images`**.
3. Bật **Public bucket** → **Create bucket**. Không tạo policy cho phép người lạ upload.
4. Vào **Project Settings → API Keys**.
5. Chọn tab **Legacy anon, service_role API keys** và lấy:
   - Khóa **anon** → dùng cho `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Khóa **service_role** → dùng cho `SUPABASE_SERVICE_ROLE_KEY`.
6. Lấy **Project URL** trong **Connect** hoặc **Settings → Data API**:
   - Có dạng `https://xxxxxxxx.supabase.co`.
   - Dùng cho `NEXT_PUBLIC_SUPABASE_URL`, không thêm `/rest/v1`.

Nếu dùng lại project cũ, có thể lấy cả 3 giá trị tương ứng từ `.env.local`. Với code hiện tại, dùng cặp legacy keys trên để khớp cơ chế proxy. Không dùng mật khẩu database thay cho API key. [Vị trí và loại khóa Supabase](https://supabase.com/docs/guides/getting-started/api-keys)

## 3. Cấu hình Clerk production

Mở [Clerk Dashboard](https://dashboard.clerk.com), chọn application 123Dzô đang dùng.

### Tạo production instance và cấu hình đăng nhập

1. Ở bộ chọn môi trường đang là **Development**, chọn tạo **Production instance**.
2. Chọn copy cấu hình Development nếu Dashboard hỏi; sau đó chỉnh lại theo các mục dưới.
3. Nhập domain app: ví dụ **`pos.example.com`**.
4. Clerk hiển thị các DNS record cần thêm. Mở trang quản lý DNS nơi bạn mua domain:
   - Bấm **Add record**.
   - Copy đúng **Type**, **Name/Host**, **Value/Target** từ từng dòng Clerk.
   - Nếu dùng Cloudflare DNS, để các CNAME phục vụ Clerk ở chế độ **DNS only**.
5. Quay lại Clerk, bấm **Verify** cho đến khi DNS được xác minh.

Trong **Production → User & authentication**, cấu hình:

- **Username:** bật, để không bắt buộc.
- **Email:** bật, để không bắt buộc, để form có thể tạo bằng email **hoặc** username.
- **Password:** bật.
- **First name:** bật; **Last name** và **Phone number:** không đặt bắt buộc.
- Không cần bật Google/Facebook để chạy luồng đăng nhập hiện tại.

Vào **Access mode → Invite-only → Save**. Nhân sự sẽ được tạo từ app; người ngoài không tự đăng ký. [Cấu hình đăng nhập](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [Invite-only](https://clerk.com/docs/guides/secure/restricting-access)

### Tạo tài khoản triển khai của bạn

1. Vẫn ở **Production**, vào **Users → Create user**.
2. Nhập username của bạn, ví dụ `operator_trung`, họ tên và **mật khẩu riêng của bạn** → Create.
3. Mở user vừa tạo, copy **User ID** dạng `user_...`.
4. Giữ User ID đó để điền vào `OPERATOR_CLERK_USER_IDS` ở bước 5.
5. Vào **API Keys**, copy:
   - **Publishable key** bắt đầu bằng `pk_live_`.
   - **Secret key** bắt đầu bằng `sk_live_`.

Tài khoản ở Clerk Development không tự xuất hiện trong Production. Tài khoản operator ở bước này phải được tạo trong **Production**. [Tạo user trên Dashboard](https://clerk.com/docs/guides/users/managing), [Clerk production trên Vercel](https://clerk.com/docs/guides/development/deployment/vercel)

## 4. Đưa code mới nhất lên GitHub

Trong terminal tại thư mục dự án:

```powershell
Set-Location 'D:\WORK_SPACE\HOME_PROJECTS\123Dzo'
npx tsc --noEmit
npx vitest run
npm run build
git status --short
git ls-files .env.local
```

- Các lệnh kiểm tra phải thành công.
- Lệnh cuối phải **không in ra `.env.local`**. Không đưa file chứa khóa này lên GitHub.
- Trong IDE → **Source Control**, stage các file code mới/sửa → **Commit → Push**.
- Mở repository trên GitHub, kiểm tra có thư mục `src/app/api/events` và file `public/app-sw.js` trong commit vừa đẩy.

Nếu chưa có repository GitHub: tạo một **private repository trống**, rồi chạy các lệnh sau, thay URL bằng repository thật. Chỉ thêm `origin` nếu `git remote -v` chưa có remote:

```powershell
git remote add origin https://github.com/YOUR_ACCOUNT/123Dzo.git
```

Sau đó dùng **Commit → Push / Publish Branch** trong IDE. Nhớ stage cả file mới, không chỉ các file đã được Git theo dõi.

## 5. Tạo project Vercel và nhập biến môi trường

Mở [Vercel](https://vercel.com) → **Add New → Project** → kết nối GitHub → chọn repository 123Dzô → **Import**.

Điền:

- **Project Name:** `123dzo`, hoặc tên bạn muốn.
- **Framework Preset:** `Next.js`.
- **Root Directory:** gốc repository, nơi có `package.json`.
- **Install Command:** `npm ci`.
- **Build Command:** `npm run build`.
- **Output Directory:** giữ mặc định.
- **Production Branch:** nhánh bạn vừa push.

Trong **Environment Variables**, copy khối dưới, thay các giá trị rồi dán/import vào giao diện Vercel. Chọn môi trường **Production**:

```dotenv
NEXT_PUBLIC_APP_URL=https://pos.example.com

NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=PASTE_ANON_KEY_FROM_STEP_2
SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY_FROM_STEP_2

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=PASTE_PK_LIVE_KEY_FROM_STEP_3
CLERK_SECRET_KEY=PASTE_SK_LIVE_KEY_FROM_STEP_3
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

OPERATOR_CLERK_USER_IDS=PASTE_YOUR_USER_ID_FROM_STEP_3

NEXT_PUBLIC_VIETQR_BANK_ID=MB
NEXT_PUBLIC_VIETQR_ACCOUNT_NO=YOUR_BANK_ACCOUNT_NUMBER
NEXT_PUBLIC_VIETQR_ACCOUNT_NAME=TEN CHU TAI KHOAN
```

Cách điền các dòng cuối:

- `NEXT_PUBLIC_APP_URL`: **domain thật của bạn**, có `https://`, không dùng localhost.
- `OPERATOR_CLERK_USER_IDS`: User ID `user_...` đã copy, **không phải username hay email**.
- `NEXT_PUBLIC_VIETQR_BANK_ID`: ngân hàng nhận tiền; ví dụ `MB` nếu dùng MBBank.
- `NEXT_PUBLIC_VIETQR_ACCOUNT_NO`: số tài khoản nhận tiền của quán, giữ các số 0 ở đầu nếu có.
- `NEXT_PUBLIC_VIETQR_ACCOUNT_NAME`: tên chủ tài khoản ngân hàng.

Giá trị trên Vercel nhập **không có dấu nháy bao ngoài**. Bản này không cần `VAPID_*`, `OPERATOR_EMAILS`, `NODE_ENV`, `NEXT_PUBLIC_BUILD_TIME`, Redis hoặc một server push riêng.

Bấm **Deploy**, chờ trạng thái **Ready**. Nếu sau này sửa env: **Settings → Environment Variables → Save**, rồi **Deployments → Redeploy** để áp dụng. [Cách nhập env trên Vercel](https://vercel.com/kb/guide/how-to-add-vercel-environment-variables)

## 6. Gắn domain vào Vercel

1. Mở project Vercel → **Settings → Domains → Add Domain**.
2. Nhập domain đã dùng ở bước 3 và 5, ví dụ `pos.example.com`.
3. Vercel hiện DNS record cần thêm. Mở nơi quản lý DNS domain, thêm đúng **Type / Name / Value** được hiển thị.
4. Không xóa các record của Clerk đã thêm ở bước 3.
5. Chờ domain trên Vercel báo **Valid Configuration** và HTTPS sẵn sàng.
6. Mở **https://pos.example.com**: phải thấy trang chủ 123Dzô.
7. Nếu Clerk còn báo chưa hoàn tất production setup, quay lại Clerk Production, bấm xác minh lại các mục DNS/domain còn đỏ.

## 7. Đăng nhập và tạo tài khoản Chủ quán

1. Mở **`https://pos.example.com/operator`**.
2. Đăng nhập bằng username/mật khẩu operator bạn đã tạo ở bước 3.
3. Trang phải hiển thị **Supabase Connected**, **Clerk Connected** và version app.
4. Nếu muốn dữ liệu thử: bấm **Tạo dữ liệu mẫu** khi chưa có bàn và món.
5. Nhập thông tin quán, tên Chủ quán, username Chủ quán và mật khẩu khởi tạo.
6. Bấm **Tạo Tài Khoản Chủ Quán & Sinh Phiếu Bàn Giao**.
7. Tải PNG hoặc in PDF ngay sau khi tạo; phiếu chứa mật khẩu nên gửi riêng cho Chủ quán.
8. Mở cửa sổ ẩn danh → **`https://pos.example.com/admin`**, đăng nhập bằng tài khoản Chủ quán vừa tạo.
9. Vào **Bàn & Nhân sự**:
   - Thêm khu vực và bàn nếu chưa có.
   - Tạo một tài khoản **staff** và một tài khoản **kitchen**, dùng username + mật khẩu.
10. Đăng nhập thử staff ở `/staff`, kitchen ở `/kitchen`.

Không cần tạo role trên Clerk hoặc nhập tay hồ sơ operator vào Supabase: app tự lưu role dựa trên User ID trong env.

## 8. Chạy thử một đơn trước khi bàn giao

Dùng các trình duyệt/thiết bị riêng cho từng vai trò:

1. Staff mở `/staff`, bấm **Kiểm tra chuông**, rồi **Mở bàn & Tạo QR**.
2. Điện thoại khách quét QR, gọi một món bếp và một đồ uống.
3. Kitchen mở `/kitchen`, bấm **Kiểm tra chuông** → phải thấy món bếp mới.
4. Bếp bấm **Nhận nấu → Hoàn thành**.
5. Staff phải thấy cảnh báo món chín và nghe chuông; bấm đã phục vụ.
6. Khách gọi tính tiền; staff phụ trách hoặc Chủ quán chốt bill.
7. Quét lại QR cũ: phải báo phiên đã đóng.
8. Mở `/customer/takeaway`, tạo đơn thử, quét VietQR bằng app ngân hàng để kiểm tra **đúng tài khoản, số tiền, nội dung**.
9. Với đơn thử chưa chuyển tiền, chỉ xác nhận trong môi trường thử. Khi vận hành thật, Chủ quán kiểm tra tiền vào ngân hàng rồi duyệt ở **Thu ngân & Hóa đơn**.
10. Trên điện thoại, dùng **Thêm vào màn hình chính / Install App**. Giữ app mở để nhận thông báo nội bộ; không có push khi khóa máy hoặc đóng app.

Nếu muốn xóa hóa đơn thử trước khai trương: dùng nút reset trong `/operator` **chỉ khi toàn bộ hóa đơn là dữ liệu test**. Nút này xóa cả hóa đơn đã thanh toán và không hoàn trả lịch sử kho.

**Sau bước này, bản deploy đã chạy được:** operator, Chủ quán, staff, kitchen, khách gọi món và duyệt chuyển khoản thủ công.

## 9. Chỉ làm thêm nếu muốn tự động xác nhận tiền bằng SePay

Nếu duyệt chuyển khoản thủ công ở bước 8 là đủ, bỏ qua bước này.

1. Đăng ký SePay, kết nối tài khoản ngân hàng nhận tiền theo hướng dẫn trong tài khoản SePay của bạn.
2. Vào **Webhooks → + Thêm webhook**, điền form:
   - Thông tin cơ bản: tên `123Dzo`, sự kiện **Có tiền vào**, URL **`https://pos.example.com/api/webhooks/payment`**. SePay gửi bằng POST.
   - Tài khoản và bộ lọc: chọn đúng tài khoản ngân hàng của quán; nếu lọc theo tiền tố mã thanh toán thì nhập **`DZO`**.
   - Bảo mật: chọn **API Key**, tạo/lưu một secret riêng. SePay sẽ gửi header `Authorization: Apikey SECRET_CUA_BAN`.
   - Cảnh báo: chọn nơi nhận báo lỗi webhook nếu cần, rồi bấm **Thêm**. [Các trường trên form SePay](https://docs.sepay.vn/tich-hop-webhooks.html)
3. Vercel → **Settings → Environment Variables**, thêm `SEPAY_WEBHOOK_SECRET` bằng **cùng secret** đó → Save → Redeploy.
4. Tạo đơn mang về, chuyển một khoản thử thực tế theo VietQR; kiểm tra đơn tự chuyển từ `PENDING_PAYMENT` sang `ACTIVE` và hiện ở bếp.
5. Nếu không chuyển trạng thái, xem lịch sử webhook trong SePay và **Vercel → Logs**.

Không cần nhập `PAYOS_CHECKSUM_KEY` nếu đang dùng SePay. Repo chưa có luồng tạo PayOS payment link đầy đủ; hướng dẫn này chọn SePay cho xác nhận tự động.

## Khi mắc lỗi, kiểm tra đúng chỗ này

- **Không thể khởi tạo Operator / staff_profiles_role_check:** chạy SQL role và khối quyền ở bước 1 trên đúng Supabase project.
- **Vào /operator bị access-denied:** kiểm tra `OPERATOR_CLERK_USER_IDS` là ID của user **Production** vừa đăng nhập; Save env rồi Redeploy.
- **Clerk báo domain/key không hợp lệ:** kiểm tra hai khóa cùng bắt đầu `pk_live_` / `sk_live_`, cùng application Production; DNS Clerk phải được verified.
- **Không tạo được tài khoản chỉ có username:** Clerk Production phải bật Username và Password, không bắt buộc Email/Phone/Last name.
- **Upload ảnh lỗi:** Storage phải có public bucket tên chính xác `menu-images`; hosting có service-role key đúng project.
- **QR chứa localhost / sai ngân hàng:** sửa `NEXT_PUBLIC_APP_URL` hoặc `NEXT_PUBLIC_VIETQR_*` trên Vercel rồi Redeploy.
- **Không thấy món/cảnh báo cập nhật:** giữ app mở, kiểm tra dòng **Đã kết nối thông báo nội bộ**; bấm Kiểm tra chuông để bật âm thanh.
- **Code trên mạng vẫn cũ:** kiểm tra file mới đã commit/push và deployment Ready đang dùng đúng commit.
