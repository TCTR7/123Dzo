# Deploy 123Dzô: bắt đầu từ Vercel, chưa cần domain

Làm theo thứ tự dưới đây. **Lần đầu dùng Clerk Development đang có và địa chỉ Vercel cấp. Chưa tạo Clerk Production, chưa mua domain.**

## 1. Đăng nhập Vercel và đưa code lên GitHub

1. Mở [vercel.com/signup](https://vercel.com/signup) → **Continue with GitHub**.
2. Đăng nhập tài khoản GitHub của bạn và cho phép Vercel kết nối.
3. Mở project 123Dzô trong IDE → **Source Control**.
4. Kiểm tra `.env.local` không nằm trong các file chuẩn bị commit. File này chứa khóa thật, chỉ dùng để điền env ở bước 4.
5. Stage các file code mới/sửa → **Commit → Push**. Nếu chưa có repository, dùng **Publish Branch / Publish to GitHub**, chọn repository private.
6. Mở repository trên GitHub, xác nhận có `package.json`, thư mục `src/app/api/events` và file `public/app-sw.js`.

**Xong bước này:** bạn đã đăng nhập Vercel và có repository chứa code mới nhất.

## 2. Mở form tạo project Vercel

1. Mở [Vercel Dashboard](https://vercel.com/dashboard).
2. Bấm **Add New → Project**.
3. Trong **Import Git Repository**, chọn repository chứa code 123Dzô → **Import**.
4. Nếu chưa thấy repository: bấm **Adjust GitHub App Permissions / Configure GitHub App**, cấp quyền cho repository đó rồi quay lại Import.
5. Trong form cấu hình, điền:
   - **Project Name:** `123dzo` hoặc tên bạn muốn.
   - **Framework Preset:** `Next.js`.
   - **Root Directory:** để gốc repository, nơi có `package.json`.
   - **Install Command:** `npm ci`.
   - **Build Command:** `npm run build`.
   - **Output Directory:** giữ mặc định.

**Chưa bấm Deploy.** Giữ tab này mở; làm bước 3 rồi quay lại nhập env. Lúc này chưa có URL app nên chưa cần tìm Domains hoặc điền domain vào Clerk.

## 3. Kiểm tra Supabase và Clerk đang dùng

Dùng lại hai dịch vụ đã cấu hình trong `.env.local`, không tạo production instance mới ở bước này.

### 3.1. Supabase: SQL và bucket ảnh

Mở [Supabase Dashboard](https://supabase.com/dashboard) → chọn đúng project có URL trùng `NEXT_PUBLIC_SUPABASE_URL` trong `.env.local`.

**Nếu đã chạy các SQL dưới đây rồi thì bỏ qua, không cần chạy mỗi lần deploy.**

1. Vào **SQL Editor → New query**, chạy đoạn này để hỗ trợ role operator:

```sql
BEGIN;
ALTER TABLE public.staff_profiles
DROP CONSTRAINT IF EXISTS staff_profiles_role_check;
ALTER TABLE public.staff_profiles
ADD CONSTRAINT staff_profiles_role_check
CHECK (role IN ('operator', 'admin', 'staff', 'kitchen'));
COMMIT;
```

2. Mở [supabase/schema.sql](../supabase/schema.sql) trong IDE, tìm dòng `-- Browser access goes through authorized Next.js APIs` gần cuối file.
3. Copy từ dòng đó đến hết file → dán vào query mới trong Supabase → **Run**. Đây là khối `REVOKE/GRANT` khóa truy cập DB trực tiếp.
4. Vào **Storage**, kiểm tra đã có bucket **`menu-images`**. Nếu chưa có: **New bucket → Name: menu-images → bật Public bucket → Create**. Không tạo policy cho phép người lạ upload.

Để kiểm tra quyền sau khi chạy SQL, kết quả phải là **false / false / true**:

```sql
SELECT
  has_table_privilege('anon', 'public.table_sessions', 'SELECT') AS anon_read,
  has_table_privilege('authenticated', 'public.order_items', 'INSERT') AS browser_insert,
  has_table_privilege('service_role', 'public.table_sessions', 'SELECT') AS server_read;
```

Nếu Supabase chưa có 8 bảng nghiệp vụ: chạy toàn bộ `supabase/schema.sql` trên **project mới trống** thay cho các bước SQL riêng ở trên. Không tạo thêm bảng bằng tay.

**3 giá trị sẽ dùng ở bước 4:**

- `NEXT_PUBLIC_SUPABASE_URL`: copy từ `.env.local`; dạng `https://xxxxxxxx.supabase.co`, không có `/rest/v1`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: copy từ `.env.local`.
- `SUPABASE_SERVICE_ROLE_KEY`: copy từ `.env.local`.

Nếu cần lấy lại khóa: **Supabase → Project Settings → API Keys → Legacy anon, service_role API keys**. Copy đúng khóa `anon` và `service_role`, không dùng mật khẩu database. [Hướng dẫn API keys](https://supabase.com/docs/guides/getting-started/api-keys)

### 3.2. Clerk: giữ Development và lấy User ID operator

1. Mở [Clerk Dashboard](https://dashboard.clerk.com) → chọn application đang dùng cho 123Dzô.
2. Giữ môi trường **Development**. Nếu đang ở form tạo Production hỏi domain thì thoát form đó.
3. Vào **User & authentication**, kiểm tra:
   - **Username:** bật, không bắt buộc.
   - **Email:** bật, không bắt buộc, để tạo tài khoản bằng email hoặc username.
   - **Password:** bật.
   - **First name:** bật; **Last name / Phone number:** không bắt buộc.
4. Vào **Access mode → Invite-only → Save** để người ngoài không tự đăng ký.
5. Vào **Users**, mở tài khoản bạn dùng để triển khai. Nếu chưa có: **Create user**, nhập username, họ tên và mật khẩu của bạn.
6. Copy **User ID** dạng `user_...` của tài khoản này; giữ lại để điền `OPERATOR_CLERK_USER_IDS`.
7. Vào **API Keys**, lấy cặp khóa **`pk_test_...`** và **`sk_test_...`**. Có thể copy từ `.env.local` nếu đã đúng application.

Không cần tạo role operator trong Clerk. App tự cấp role theo User ID bạn điền trên Vercel. [Đăng nhập Clerk](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [Invite-only](https://clerk.com/docs/guides/secure/restricting-access)

## 4. Điền env trên Vercel rồi Deploy

Quay lại **tab Import project Vercel ở bước 2** → mở **Environment Variables**.

Copy khối dưới, thay từng giá trị bằng khóa của bạn rồi dán/import vào form:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=PASTE_ANON_KEY_FROM_ENV_LOCAL
SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY_FROM_ENV_LOCAL

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=PASTE_PK_TEST_KEY
CLERK_SECRET_KEY=PASTE_SK_TEST_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

OPERATOR_CLERK_USER_IDS=PASTE_USER_ID_FROM_CLERK_DEVELOPMENT

NEXT_PUBLIC_VIETQR_BANK_ID=MB
NEXT_PUBLIC_VIETQR_ACCOUNT_NO=YOUR_BANK_ACCOUNT_NUMBER
NEXT_PUBLIC_VIETQR_ACCOUNT_NAME=TEN CHU TAI KHOAN
```

Điền chính xác:

- Hai khóa Clerk phải là `pk_test_...` / `sk_test_...` lấy ở bước 3.2.
- `OPERATOR_CLERK_USER_IDS` là **User ID `user_...`**, không phải username/email.
- `NEXT_PUBLIC_VIETQR_BANK_ID`: ví dụ `MB` nếu nhận tiền bằng MBBank.
- `NEXT_PUBLIC_VIETQR_ACCOUNT_NO`: số tài khoản ngân hàng nhận tiền của quán.
- `NEXT_PUBLIC_VIETQR_ACCOUNT_NAME`: tên chủ tài khoản ngân hàng.
- Không thêm dấu nháy bao ngoài giá trị trong giao diện Vercel.

**Lần deploy đầu chưa thêm `NEXT_PUBLIC_APP_URL` vì chưa có URL. Không copy dòng localhost từ `.env.local`.** App sẽ dùng địa chỉ request hiện tại khi chưa có biến này.

Nếu form cho chọn scope env, chọn **Production** cho lần deploy nhánh chính. Đây là tên môi trường của **Vercel**; các khóa **Clerk vẫn dùng Development** để chạy thử.

Bấm **Deploy** → chờ **Ready**. Nếu báo Error, mở **Build Logs**, xử lý dòng lỗi đầu tiên rồi Redeploy. Không cần VAPID, Redis hay một backend riêng.

[Cách nhập env trên Vercel](https://vercel.com/kb/guide/how-to-add-vercel-environment-variables)

## 5. Lấy URL Vercel và cập nhật NEXT_PUBLIC_APP_URL

Chỉ làm bước này **sau khi deployment đã Ready**.

1. Mở trang tổng quan project vừa tạo.
2. Bấm deployment **Ready** → **Visit**.
3. App mở trong tab mới. Copy phần địa chỉ `https://...vercel.app`, bỏ đường dẫn như `/admin` hoặc `/operator` nếu có.
4. Quay lại Vercel project → **Settings → Environment Variables**.
5. Thêm biến sau, thay bằng URL vừa copy:

```dotenv
NEXT_PUBLIC_APP_URL=https://DIA_CHI_VUA_COPY.vercel.app
```

6. Chọn scope **Production** → **Save**.
7. Vào **Deployments** → menu **⋯** của bản vừa deploy → **Redeploy**.
8. Chờ bản mới **Ready**, bấm **Visit** lại.

**Không cần vào Domains để lấy URL chạy thử.** Địa chỉ này dùng với Clerk Development, chưa dùng với Clerk Production. [URL do Vercel cấp](https://vercel.com/docs/deployments/generated-urls)

## 6. Đăng nhập operator, tạo Chủ quán và nhân viên

Từ đây, dùng URL thật lấy ở bước 5. Ví dụ URL là `https://123dzo-abc.vercel.app` thì trang operator là `https://123dzo-abc.vercel.app/operator`.

1. Mở **URL app + `/operator`**.
2. Đăng nhập bằng tài khoản **Clerk Development** có User ID đã điền ở bước 4.
3. Kiểm tra trang hiển thị **Supabase Connected**, **Clerk Connected** và version.
4. Nếu chưa có bàn/món, có thể bấm **Tạo dữ liệu mẫu**.
5. Nhập thông tin quán, tên Chủ quán, username và mật khẩu khởi tạo → **Tạo Tài Khoản Chủ Quán & Sinh Phiếu Bàn Giao**.
6. Tải PNG hoặc in PDF ngay sau khi tạo; phiếu có mật khẩu nên gửi riêng.
7. Mở cửa sổ ẩn danh → **URL app + `/admin`** → đăng nhập bằng tài khoản Chủ quán vừa tạo.
8. Vào **Bàn & Nhân sự**, tạo một tài khoản **staff** và một tài khoản **kitchen** bằng username + mật khẩu.
9. Đăng nhập thử staff ở `/staff`, kitchen ở `/kitchen`.

Nếu bị access-denied: kiểm tra User ID trên Vercel có đúng tài khoản đang đăng nhập trong **Development** không. Sửa env xong phải **Save → Redeploy**.

## 7. Thử một đơn để xác nhận app chạy được

1. Staff mở `/staff` → **Kiểm tra chuông → Mở bàn & Tạo QR**.
2. Điện thoại khách quét QR, gọi một món bếp và một đồ uống.
3. Kitchen mở `/kitchen` → **Kiểm tra chuông** → thấy món mới → **Nhận nấu → Hoàn thành**.
4. Staff nhận cảnh báo món chín và chuông → xác nhận đã phục vụ.
5. Khách gọi tính tiền; staff phụ trách hoặc Chủ quán chốt bill.
6. Quét lại QR cũ: phải báo phiên đã đóng.
7. Mở `/customer/takeaway`, tạo đơn thử; quét VietQR kiểm tra đúng ngân hàng, số tài khoản, tiền và nội dung.
8. Trong môi trường thử có thể duyệt đơn thử tại **Thu ngân & Hóa đơn**. Khi vận hành thật, phải kiểm tra tiền vào ngân hàng trước khi duyệt.
9. Cài app bằng **Thêm vào màn hình chính / Install App**. Giữ app mở để nhận chuông/cảnh báo; không có push khi khóa máy hoặc đóng app.

**Đến đây bạn đã có app chạy trên mạng, chưa cần mua domain.**

## 8. Sau khi chạy thử xong: domain riêng và Clerk Production

Bước này dành cho bản vận hành thật. Vercel Hobby chỉ dành cho cá nhân/phi thương mại; nếu triển khai cho quán kinh doanh, dùng gói hosting cho phép thương mại. [Quy định Vercel](https://vercel.com/docs/limits/fair-use-guidelines)

### Có domain riêng trước

1. Mua một domain còn trống tại nhà đăng ký domain hoặc [Vercel Domains](https://vercel.com/docs/domains/working-with-domains), ví dụ `tenquan.com`.
2. Dùng `pos.tenquan.com` cho app; không cần mua riêng tên `pos`.
3. Trong Vercel project, tìm **Domains** bằng ô **Find** ở menu trái → chọn mục Domains của project → **Add Domain**.
4. Nhập `pos.tenquan.com`, thêm DNS record Vercel cung cấp tại nơi quản lý domain.
5. Chờ domain và HTTPS được xác minh; mở `https://pos.tenquan.com` phải thấy app.

### Sau đó mới tạo Clerk Production

1. Clerk Dashboard → application 123Dzô → **Development → Create Production instance**.
2. Nhập **domain thật vừa gắn**, ví dụ `pos.tenquan.com`; không nhập `*.vercel.app`.
3. Thêm đúng DNS record Clerk cung cấp → **Verify**.
4. Cấu hình Username/Email/Password và **Invite-only** giống bước 3.2, nhưng trên **Production**.
5. Vào **Production → Users → Create user**, tạo operator; copy User ID mới.
6. Vào **Production → API Keys**, lấy `pk_live_...` và `sk_live_...`.
7. Vercel → env **Production**, thay 4 biến:

```dotenv
NEXT_PUBLIC_APP_URL=https://pos.tenquan.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=PASTE_PK_LIVE_KEY
CLERK_SECRET_KEY=PASTE_SK_LIVE_KEY
OPERATOR_CLERK_USER_IDS=PASTE_PRODUCTION_OPERATOR_USER_ID
```

8. **Save → Redeploy**. Mở domain thật + `/operator`, đăng nhập tài khoản Production.
9. Tạo lại tài khoản Chủ quán và nhân viên trên Production; tài khoản Clerk Development không tự chuyển sang.
10. Tạo lại phiếu bàn giao/QR để dùng domain thật, rồi lặp lại ca thử bước 7.

Clerk Production yêu cầu domain bạn sở hữu. [Hướng dẫn Clerk trên Vercel](https://clerk.com/docs/guides/development/deployment/vercel)

## 9. Tùy chọn: tự động xác nhận tiền bằng SePay

Chỉ làm sau khi app chạy ổn; nếu Chủ quán duyệt chuyển khoản thủ công thì bỏ qua.

1. Đăng ký SePay, kết nối tài khoản ngân hàng nhận tiền của quán.
2. Vào **Webhooks → + Thêm webhook**:
   - Tên `123Dzo`; sự kiện **Có tiền vào**.
   - URL: **URL app chính thức + `/api/webhooks/payment`**; SePay gửi bằng POST.
   - Chọn đúng tài khoản ngân hàng; nếu lọc theo tiền tố mã thanh toán, nhập **`DZO`**.
   - Bảo mật: **API Key**, tạo/lưu secret riêng. SePay gửi `Authorization: Apikey SECRET_CUA_BAN`.
   - Bấm **Thêm**. [Form cấu hình SePay](https://docs.sepay.vn/tich-hop-webhooks.html)
3. Vercel → Environment Variables → thêm `SEPAY_WEBHOOK_SECRET` bằng cùng secret → **Save → Redeploy**.
4. Tạo đơn mang về và chuyển khoản thử thực tế theo QR. Đơn phải tự sang ACTIVE và xuất hiện ở bếp.
5. Nếu lỗi: kiểm tra lịch sử webhook SePay và **Vercel → Logs**.

Không cần `PAYOS_CHECKSUM_KEY` khi dùng SePay. Repo chưa có luồng tạo PayOS payment link đầy đủ.

## Sửa nhanh khi mắc lỗi

- **Chưa có URL app:** phải hoàn tất bước 4, deployment Ready rồi mới làm bước 5.
- **Không tìm thấy Domains:** bỏ qua; chạy thử chỉ cần nút Visit của deployment.
- **Operator bị chặn:** kiểm tra User ID cùng môi trường với hai khóa Clerk, rồi Redeploy.
- **Lỗi staff_profiles_role_check:** chạy SQL role ở bước 3.1.
- **Không tạo được user bằng username:** bật Username/Password, không bắt buộc Email/Phone/Last name.
- **Ảnh upload lỗi:** kiểm tra bucket public `menu-images` và service-role key.
- **QR chứa localhost:** không lấy `NEXT_PUBLIC_APP_URL` local đưa lên Vercel; sửa bằng URL bước 5 rồi Redeploy.
- **Không thấy thay đổi trên mạng:** kiểm tra code đã push và deployment Ready đang dùng đúng commit.
