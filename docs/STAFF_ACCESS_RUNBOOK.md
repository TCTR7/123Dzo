# Cấp quyền nhân sự — Auth foundation

Thực hiện bởi người quản lý có quyền vận hành Clerk/Supabase, không phải luồng
đăng ký công khai. Không đặt service-role key hoặc token vào chat/source/log.

1. Xác minh người thật, tài khoản Clerk và **user ID** chính xác trong dashboard
   quản trị. Không lấy ID do người lạ gửi làm bằng chứng danh tính.
2. Với admin đầu tiên, kiểm tra DB hiện có trước: dùng hồ sơ admin hợp lệ đã
   có nếu đúng danh tính; không tạo admin thứ hai chỉ vì login gặp lỗi config.
3. Qua công cụ quản trị DB được phép, tạo/sửa duy nhất hồ sơ staff_profiles
   tương ứng: id đúng Clerk user ID, full_name đúng, role đã được duyệt,
   is_active=true, assigned_zone_id đúng khu vực hoặc null; không chạy seed.
4. Đăng nhập lại và kiểm tra đúng phân hệ; thử URL phân hệ khác để xác nhận
   role. Khách đăng ký chưa được provision phải thấy chưa có quyền.
5. Để thu hồi quyền, đặt is_active=false. Request kế tiếp phải bị chặn; phiên
   Clerk vẫn tồn tại không có nghĩa được quyền nghiệp vụ. Thu hồi Clerk session
   khi có yêu cầu đăng xuất thiết bị. Realtime revocation là phần M-12 riêng.
6. Sau rollout migration staff, dùng giao diện nhân sự để gọi API/RPC; API
   xác minh Clerk khi cấp mới, DB bảo vệ admin cuối cùng và báo conflict khi
   profile đã thay đổi. Không sửa quyền bằng browser Supabase trực tiếp.
   Nếu request mất phản hồi, tải lại kiểm tra hồ sơ trước khi thử lại.

Phân biệt xử lý sự cố:

- “Chưa có quyền”: kiểm tra profile có tồn tại, role và active đúng; không tự
  nâng quyền khi user nói không truy cập được.
- “Chưa thể kiểm tra quyền”: kiểm tra tình trạng Clerk/DB và cấu hình server;
  thiếu SUPABASE_SERVICE_ROLE_KEY phải sửa config, không dùng anon fallback.

Không có script tự cấp admin theo email/user đầu tiên trong đợt code này.
Không chạy bất kỳ thay đổi DB thật nào trong quá trình viết/chạy unit tests.

Rollout staff API: review migration `202610220001_admin_staff.sql`; backup và
áp vào staging riêng trước bản app dùng RPC mới. Xác nhận last-admin/grants
trên staging, rồi mới lên lịch rollout đích. Batch code không tự áp SQL thật.

Seed/config sau B12:

- `supabase/seed.sql` không tạo/reset dữ liệu. Provision Clerk admin có xác minh,
  tạo dữ liệu thật qua Admin và nhập kho bằng phiếu; không lấy nhân sự giả demo.
- Demo tách `supabase/demo/seed.sql`, chỉ DB trống tên kết thúc `_demo`, cùng
  kết nối phải `SET app.seed_mode='demo'` trước chạy. Guard chặn target sai và
  chạy lại; không hướng dẫn vượt guard để reset DB có giao dịch.
- Thiết lập CRON_SECRET ngẫu nhiên≥32 ký tự ở scheduler/server; gửi Bearer qua
  header, không URL query. Cooldown60s/instance; thiếu secret trả503 trước DB.
  VAPID_SUBJECT phải là địa chỉ quán đã xác minh, không dùng mail mẫu.
- Takeaway/webhook đang đóng theo provider chưa chốt. Điền bank/key không tự mở
  tính năng; M-09/M-10 cần triển khai/xác minh receipt trước khi thay gate.

Rollout read boundaries B13 (migration `202610220012_read_boundaries.sql`):

- Rehearsal staging trước; mọi SSR/API cần service key server. Thu hồi grants sẽ
  làm app cũ mất khả năng đọc, vì vậy phát hành code và SQL trong cùng cửa sổ
  bảo trì, ngừng nhận thao tác và yêu cầu các thiết bị tải lại sau phát hành.
- Migration atomic: nếu trùng phiên dine-in sống/bàn, pointer sai hoặc số liệu
  không hợp lệ thì dừng và rollback toàn bộ. Đối soát bản ghi từ chứng từ trước
  khi chạy lại; không tự sửa tồn/tiền hoặc bỏ constraint để vượt kiểm tra.
- Xác minh QR ACTIVE/REQUEST_BILL chỉ thấy dữ liệu bàn mình; CLOSED/unpaid/
  sai token không đọc được. Admin, Staff và Bếp phải đọc được sau guard; thử
  anon/authenticated không SELECT bảng/KPI/subscription hoặc gọi business RPC.
- Bản này dùng snapshot refresh có guard (khách10s, Staff/KDS/Bills15s), pause
  hidden/offline và cleanup. Đây là bước chuyển an toàn, chưa phải realtime/
  push nghiệm thu M-12. Không khôi phục public grants để chữa lỗi client cũ;
  giữ bảo trì và sửa/roll forward bản app phù hợp nếu rehearsal thất bại.

Worker thông báo B14 (migration `202610220013_notification_worker.sql`):

- Khai báo NOTIFICATION_WORKER_SECRET ngẫu nhiên≥32 ký tự, riêng CRON_SECRET;
  VAPID public/private phải cùng cặp và subject là thông tin quán hợp lệ. Thiếu/
  sai cấu hình trả503 trước khi nhận việc. Không đưa secret vào browser hoặc URL.
- Scheduler được cấu hình ở bước triển khai môi trường đích, POST
  `/api/cron/notifications` với Bearer secret qua HTTPS, không body/recipient.
  Cần nhịp≤30s khi quán hoạt động và kiểm tải backlog; mỗi lần tối đa5 jobs/
  8 recipients,45s lease,20s budget. Cho phép các lần chạy chồng nhau: DB claim
  SKIP LOCKED. Hẹn giờ2 phút là ready_at+120s, gửi ở lượt chạy đến hạn tiếp theo,
  có thể trễ thêm nhịp scheduler/backlog. Chưa cấu hình scheduler trong batch code.
- READY/đồ uống và bill-request chỉ gửi khi trạng thái còn hợp lệ, lấy assignment/
  zone hiện tại; fallback không có zone thì không phát toàn quán. Không dùng API
  `/api/push/notify` cũ (410). Subscription chỉ tự đăng ký/gỡ qua API có Origin
  guard, RPC recheck active/role. Invalid legacy/410 chỉ xóa khi hash vẫn khớp;
  404 lỗi khác retry và cuối cùng hiện lỗi, không tự suy ra đã hết hạn.
- `/admin/notifications`: xem pending/failed, kiểm cấu hình/kết nối trước khi
  retry lỗi. Retry CAS số attempts, giữ receipts đã gửi; không tạo món hoặc sửa
  bill. Thử tối đa8 lần, backoff10…300s. Receipt là push service chấp nhận, không
  chứng minh thiết bị đã hiện/đổ chuông. Crash sau provider trước receipt có thể
  gửi lặp, tag cố định để thay notification cùng việc; không cam kết exactly-once.
- Rehearsal riêng trước áp DB: worker crash/lease reclaim, đổi người phụ trách,
  serve trước fallback,410 khi subscription vừa đổi, lỗi VAPID/provider và backlog.
  PWA subscribe/notificationclick/audio, private Broadcast và test thiết bị thật
  vẫn M-12a/c; không bật lịch chỉ để thử trên DB/điện thoại đang vận hành.

PWA/audio B15 (không migration DB mới):

- `/sw.js` root native SW chỉ cache offline page/icon/WAV, không API/SSR/RSC/QR,
  không gửi nền khi offline. Ship đủ public assets với SW; no-cache script và scope
  root. Rehearsal proxy/CDN giữ đúng JS MIME/no-store; tắt các rule cache HTML/API
  khác ở tầng hosting. Mất mạng hiển thị hướng dẫn, không phải menu/bill đã xác nhận.
- Staff: chạm Bật/đăng ký lại thông báo, cấp quyền, chỉ coi thành công khi API xác
  nhận. Nếu iOS không hỗ trợ trong tab, thêm vào Màn hình chính và mở từ icon.
  Một profile hiện chỉ một subscription: đăng ký trên máy2 thay delivery máy1.
  Khi refresh VAPID/key/device, đăng ký lại từ tài khoản đang dùng; không auto opt-in.
- Máy dùng chung: tắt trước khi đổi người dùng; runtime gỡ subscription cũ/đóng
  notifications khi sign-out hoặc đổi Clerk ID, không tự chuyển sang người mới.
  Nếu cảnh báo không gỡ được, tắt thông báo trang trong cài đặt browser. Khi gỡ DB
  chưa xác nhận, Tắt lần nữa để đối soát; nếu reload mất endpoint tạm thì provider410
  cleanup sẽ xử lý khi worker gửi tiếp. Không coi đăng ký local là DB đang active.
- Âm thanh bật riêng bằng nút chạm, tắt mặc định mỗi lần mở; Test/Tắt cùng một audio
  element. Browser deny hiển thị rõ để thử lại, không hứa chuông tùy chỉnh lúc khóa
  màn hình. KDS WakeLock release khi ẩn/unmount, xin lại khi visible; OS có thể từ
  chối hoặc thu hồi, luôn kiểm màn hình và nguồn sạc trong ca.
- Rebuild assets: `node scripts/generate-pwa-assets.mjs` từ SVG/two-tone nội bộ;
  `npm run test:integration:pwa` dùng Chromium local + loopback fixture, không Clerk,
  DB hoặc provider. Test device thật: Android/desktop/iOS home screen, permission
  denied/revoked, signed-out push, lock screen, reconnect; còn chờ M-16/nghiệm thu.
  Private Broadcast M-12a chưa hoàn tất, ứng dụng vẫn dùng snapshot refresh có guard.

Private realtime B16 (migration `202610220014_private_realtime.sql`, chưa áp DB app):

- Code local M-12a đã có, thay cho giới hạn B13/B15 bên trên; mặc định
  NEXT_PUBLIC_PRIVATE_REALTIME_ENABLED=false. Không bật trên DB vận hành để thử.
  Chuẩn bị Supabase test project riêng, áp migration đúng thứ tự qua0014, kiểm
  messages đã bật RLS và6 policy dzo_* có mặt. Không ALTER managed RLS. Tắt
  Realtime Settings→Allow public access. Xem [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).
- Import EC P-256 signing key được Supabase tin cậy, giữ private JWK/kid trong
  REALTIME_SIGNING_JWK server secret; không đưa key vào NEXT_PUBLIC, git, log hoặc
  chat. Kiểm JWKS công khai đúng kid/x/y và chỉ public fields trước bật. Custom
  token dùng imported key theo [Supabase JWT](https://supabase.com/docs/guides/auth/jwts).
  Không dùng anon/service key làm signing key. Bật flag rồi rebuild app test;
  thiếu/sai key trả503, giữ polling, không tự mở public grants.
- Nghiệm thu test project với SDK thật: lấy ticket từ hai phiên A/B và từng role;
  A join A được, join B/role giả bị từ chối; client không broadcast/presence được
  kể cả payload hợp lệ. Anon không join app topic. Chủ động tạm thêm permissive
  policy ở project test để xác nhận restrictive vẫn chặn, rồi gỡ policy test.
- Kiểm hết hạn/renew mất mạng, disable/demote staff, CLOSED phiên khi ticket cũ
  còn hạn. Protected API từ chối ngay; cached channel chỉ có generic signal đến
  khi expiry, không hàng DB/PII. Không diễn giải cached join là revocation tức thì.
  Giữ tab nhiều role/máy: menu86ing, new order, batch ready, trả bia, chuyển bàn,
  yêu cầu bill/close; queue khách khác phải đổi khi session thay đổi. Reconnect
  phải refetch, unmount/signout/hide không để socket sống hoặc retry tăng dần.
- [Broadcast](https://supabase.com/docs/guides/realtime/broadcast) cần private flag
  đồng nhất client/server; kết nối client trước bài gửi thử để managed partition
  được tạo. Theo dõi WarnSendingBroadcastMessage và backlog/delivery. Đo fanout
  O(live sessions)/statement với tải quán thật và giới hạn Free Tier; chỉ gửi
  UUID/version, không broadcast_changes chứa hàng DB. Polling không là bằng chứng
  realtime hoạt động. Local PG/SDK fixture chưa thay được các bài Supabase trên.
- Rollback cấu hình: tắt flag + rebuild để dùng guarded polling, giữ base RLS/
  grants/policy an toàn. Không rollback schema bằng cách mở quyền browser. Chưa
  có kết quả Supabase đích/OS push thì giữ G3/G5 chưa đạt, chưa phát hành.

KPI, thông tin quán và đối soát B17/B18 (chưa áp migration lên DB app):

- Rehearsal migration0015/0016 sau các migration trước trên môi trường riêng.
  activated_at lịch sử để null khi thiếu bằng chứng, không lấy opened_at làm mốc
  thanh toán. Kiểm kỳ qua nửa đêm giờ Việt Nam, bill mở tháng trước/đóng tháng này,
  trả hết bia và hủy món đã nấu bằng chứng từ quán; không chỉnh lịch sử cho khớp KPI.
- `/admin/release` hoặc GET `/api/admin/data-health` chỉ trả số lượng sai lệch,
  không tự sửa. Đối chiếu bill đầy đủ, pointer bàn, kho và timestamps với chứng từ.
  Counter0 không chứng minh payment/provider hoặc các gate phát hành đã đạt.
- Điền thông tin thật đã xác minh vào NEXT_PUBLIC_STORE_NAME/STORE_ADDRESS/
  STORE_PHONE/STORE_HOURS (cùng prefix NEXT_PUBLIC_), rồi đặt
  NEXT_PUBLIC_STORE_INFO_VERIFIED=true và rebuild. Tên có thể dùng mặc định123Dzô;
  địa chỉ/điện thoại/giờ không đủ thì không hiển thị như thông tin đã xác minh.
  Receipt cũng dùng cấu hình này. Cấu hình quán không tự bật thanh toán.
- Khi bill/đồ uống trả lại làm tổng tiền đổi, hoặc đổi tiền mặt/chuyển khoản,
  checkbox đã nhận tiền tự bỏ chọn. Đối chiếu lại số tiền thực tế rồi xác nhận.
  Nếu request mất phản hồi: dùng Kiểm tra thao tác vừa gửi; không xóa localStorage
  hoặc tạo mã mới để thử thu tiền/đặt món lần nữa. HTTP5xx giữ journal cũ.
- `python integration_test/release_rehearsal_test.py` chỉ tạo cluster loopback tạm,
  không nhận app DB URL: backup/restore, kiểm role/counts, 12 bàn/48 calls và các
  RPC order→batch→serve→return→cash-close. fsync off, có overhead psql; thời gian
  local không là SLA/quota benchmark hoặc bằng chứng độ bền trên hạ tầng thật.
- Kiểm local: npm run lint, typecheck:tests, typecheck:e2e, test:coverage,
  test:integration, build, test:ux, test:integration:pwa; migration parity bằng
  node scripts/check-migrations.mjs. Không cần .env.local cho fixture DB/UI.
  CI quality chạy các bước này; chưa có run remote thì không ghi gate CI đã đạt.
- Playwright acceptance cần E2E_ISOLATED_PROJECT=true + E2E_BASE_URL của app riêng,
  Clerk storage states cho admin/staff/kitchen/inactive và E2E_SESSION_TOKEN của
  phiên test. Secrets chỉ ở môi trường/file tạm được bảo vệ, không chat/git.
  E2E_ALLOW_ORDER_MUTATIONS=true chỉ khi được phép ghi fixture riêng; bài thật
  kiểm UI acknowledgment, snapshot món và replay cùng operation ID. Thiếu cờ
  hoặc fixture sẽ skip ca ghi, không tính là nghiệm thu đã đạt. Traces có thể
  chứa capability/auth nên không upload hoặc chia sẻ như ảnh fixture UI.
- Cutover còn cần người vận hành chốt domain/HTTPS, tài khoản nhận của quán,
  scheduler≤30s và nguồn fixture/staging. Backup+restore staging trước, ngừng
  nhận thao tác trong cửa sổ bảo trì, áp migration thứ tự rồi bản app tương ứng,
  bắt thiết bị tải lại và kiểm role/QR/kho/bill/worker/private channel trước mở bán.
  Nếu lỗi giữ bảo trì và roll forward; không mở lại public grants hoặc chạy app
  cũ ghi trực tiếp. Không DROP ledger/receipts để rollback; giữ snapshot/log để
  đối soát trước phương án restore được người vận hành xác nhận.
- Nghiệm thu còn mở: thanh toán/đối soát tiền thật, Supabase key/policy/Storage,
  worker lag/fanout với tải quán được xác nhận, thiết bị iOS/Android/khóa màn hình,
  screen reader và thử với5–8khách. Không deploy hoặc bật job trong đợt code này.

Thông tin quán do chủ dự án cung cấp (2026-10-22):

- Tên hiển thị: Nhỏ Út. Địa chỉ: Điện Bàn Bắc – Đà Nẵng.
- Giờ hoạt động: 10:00–23:30; 10 bàn. Chưa tạo/sửa bàn trên DB ứng dụng.
- Điện thoại quán: 0905729459. Ngân hàng nhận tiền: Techcombank (BIN970407);
  chưa cung cấp số và tên tài khoản nhận. V1 xác nhận tiền thủ công theo yêu cầu
  người dùng, không cần PayOS/SePay hoặc secret webhook.
- Có 2 nhân viên phục vụ. Số máy bếp/thu ngân và số điện thoại khách mở app cùng
  lúc chưa xác nhận; không coi số bàn bằng số thiết bị. Chưa cập nhật env ứng dụng.
- Chủ dự án xác nhận Supabase/Clerk đã có và yêu cầu coi dữ liệu vận hành tách
  riêng để tiếp tục chuẩn bị. Ghi nhận đây là xác nhận của chủ dự án, không phải
  bằng chứng đã kiểm kỹ thuật. Auto-review trước đó chặn đọc .env.local; chưa
  xác minh credential/test-live, áp migration hoặc gửi request tới dịch vụ thật.

V1 thu tiền thủ công và mang về — B19 (ghi đè phụ thuộc provider trước đây):

- Rehearsal202610220017_manual_payments.sql rồi202610220018_manual_takeaway.sql sau0016; chưa áp
  lên DB app. Giữ private ledger/audit khi backup/restore, không TRUNCATE để sửa
  lỗi thu tiền hoặc giảm dung lượng. Không bật webhook tự động trong bản này.
- Cấu hình công khai: STORE_NAME=Nhỏ Út, STORE_ADDRESS=Điện Bàn Bắc – Đà Nẵng,
  STORE_PHONE=0905729459, STORE_HOURS=10:00–23:30 (đều prefix NEXT_PUBLIC_),
  STORE_INFO_VERIFIED=true sau kiểm tra hiển thị. VIETQR_BANK_ID=970407 và
  VIETQR_ACCOUNT_NO/ACCOUNT_NAME cần số/tên thật đã xác minh. Sau đó mới đặt
  NEXT_PUBLIC_BANK_INFO_VERIFIED=true và NEXT_PUBLIC_MANUAL_TAKEAWAY_ENABLED=true,
  rebuild. Thiếu thông tin thì vẫn xem menu, không tạo QR/tài khoản giả.
- `/staff/payments` hoặc `/admin/payments`: đối chiếu app ngân hàng/tiền mặt thực
  nhận với đúng mã đơn và đủ số tiền; chuyển khoản nhập mã giao dịch ngân hàng,
  đánh dấu đã kiểm tra rồi xác nhận. Không căn cứ ảnh chuyển khoản của khách.
  Lịch sử lưu Clerk ID, tên/role lúc xác nhận, DB time, tiền/phương thức/reference.
  Dine-in cũ chỉ có actor/time bất biến; tên hiển thị là directory label hiện tại.
- Thiếu/thừa tiền, thiếu tồn hoặc reference đã dùng: đơn giữ pending và không
  vào bếp; liên hệ đối soát với khách, không yêu cầu chuyển lại toàn bộ. Không có
  nút sửa/xóa receipt, tự hoàn tiền hoặc đảo giao dịch trong v1. Nếu xác nhận nhầm,
  dừng xử lý đơn và nhờ quản lý giữ chứng từ để giải quyết; không sửa SQL lịch sử.
- Sau nhận tiền, người xác nhận được gán phụ trách để nhận việc/notification.
  Danh sách chờ giao chỉ hiện đơn đã nhận tiền và chuẩn bị đủ. Chỉ bấm “Tôi đã
  giao đủ món” sau giao đúng khách; đây là đóng đơn, không thu tiền lần hai.
  Mất phản hồi dùng kiểm tra lượt vừa xác nhận, không xóa journal/tạo mã mới.
- Trình duyệt lưu tối đa20 lối mở đơn; ai dùng chung thiết bị có thể xem. Xóa lối
  mở chỉ xóa trên máy, không hủy/hoàn tiền. Không tra cứu đơn chỉ bằng SĐT.
- Quota pending100/quán,3/SĐT; create2/10phút/SĐT,10/ngày/SĐT,100/ngày/quán.
  Đổi SĐT vẫn làm đầy hạn mức chung được: cấu hình chống spam/request tại hạ tầng
  trước mở public, đo tải thật. Không có expiry tự động; đơn pending bị bỏ lại
  cần theo dõi, không tự xóa/chuyển CLOSED như đã nhận tiền.
- Nghiệm thu thêm: quét PNG/QR bằng Techcombank trên máy thật, đối chiếu tên nhận/
  tiền/nội dung, reload/quay lại sau app ngân hàng, Clerk các role và2staff cùng
  xác nhận. Không chuyển tiền thật trong fixture. Script test:ux:manual dùng API
  peer tạm, không chứng minh ngân hàng/Clerk/DB app. Acceptance POM có trang thu
  tiền nhưng chưa chạy đích; chưa bật checkout, scheduler hoặc deploy.

Chống request spam — B20 (2026-10-23, chưa áp lên môi trường thật):

- Migration `202610230019_takeaway_request_limits.sql` sau0018; bootstrap/types
  tương ứng. Đây là bucket quota hết hạn, không phải receipt/operation audit.
  RPC riêng commit budget trước create: order rollback không hoàn budget. Retry
  có tính request; GET khôi phục kết quả đã commit không cần budget tạo đơn.
- Server-only `TAKEAWAY_RATE_LIMIT_SECRET`: random32..256bytes, giữ ổn định trong
  cửa sổ quota. Chọn đúng `TAKEAWAY_REQUEST_SOURCE`; thiếu/sai cấu hình sẽ khóa
  checkout/create, không fallback IP và không có bypass cho development.
- Nếu Vercel trực tiếp: source=vercel, runtime phải có VERCEL=1. Chỉ lấy
  x-vercel-forwarded-for, không dùng header generic do client chọn. Theo
  [Vercel request headers](https://vercel.com/docs/headers/request-headers), nền
  tảng cung cấp header này; cần nghiệm thu header thực trên deployment của quán.
  Không tự đặt VERCEL=1 trên VPS để vượt kiểm tra trust. Sau proxy khác, cấu hình
  proxy tin cậy riêng; không đoán phần tử đầu trong X-Forwarded-For.
- Nếu reverse proxy/VPS: source=proxy, thêm TAKEAWAY_PROXY_SECRET random32..256bytes.
  Ingress phải **ghi đè**, không append, x-dzo-client-ip bằng địa chỉ peer thật
  và x-dzo-proxy-secret bằng secret server; không chuyển tiếp giá trị khách gửi.
  Hạn chế truy cập trực tiếp origin; secret chỉ nằm ở ingress và server env.
  Cần kiểm thử không có/sai secret bị503, header giả không đổi được bucket.
- Hạn mặc định:10request/phút và120/giờ/mạng,60/phút và600/giờ/quán; cấu hình
  TAKEAWAY_RATE_NETWORK_MINUTE/NETWORK_HOUR/GLOBAL_MINUTE/GLOBAL_HOUR, integer
  1..100000. IPv4-mapped IPv6 cùng bucket IPv4; IPv6 gom/64; DB chỉ lưu HMAC
  namespace ngày UTC, không IP thô/SĐT/capability. DB clock fixed windows, có
  thể burst quanh ranh giới; NAT dùng chung hạn mức. Quota phone/global create
 0018 vẫn giữ và không được coi là thay thế ingress DDoS protection.
- HTTP429 request gate có Retry-After và giữ journal; chờ rồi kiểm tra GET trước
  retry cùng mã. Request song song cùng mã vẫn có thể đã commit ở nơi khác.
  Network/DB503 cũng giữ journal, kiểm tra GET
  trước tạo thao tác mới. Bucket hết hạn được xóa tối đa200/request, không xóa
  receipt/ledger. Giới hạn global chặn cấp row mạng mới khi đã hết budget.
- Cần nghiệm thu hạ tầng thật: giả XFF/IPv6, nhiều instance cùng quota, proxy
  bypass, restart, lỗi DB và lưu lượng/NAT quán. Test PG/Node local không chứng
  minh trusted ingress thật hoặc chống DDoS. Chưa chọn nền tảng triển khai.

Staging mang về xuyên luồng — B20:

- Acceptance `takeaway.spec.ts` + TakeawayPage POM dùng UI/API thật, không route
  mocks. Chỉ chạy ghi khi E2E_ALLOW_TAKEAWAY_MUTATIONS=true trên isolated app;
  cần staff storageState, E2E_TAKEAWAY_PHONE là số fixture được phép sử dụng và
  E2E_TAKEAWAY_BAR_NAME trùng món BAR_INSTANT đang bán/còn tồn trong fixture.
- Test tạo pending/replay/reload, cash receipt giả lập có actor/time/history,
  replay receipt, ACTIVE/READY, giao riêng/replay và CLOSED/SERVED. Không có
  chuyển khoản hoặc xác minh app ngân hàng thật. Quota/DB state không reset tự
  động; chuẩn bị fixture riêng trước lần chạy tiếp theo.
- Workflow isolated-staging có input allow_takeaway_mutations mặc định false;
  phone ở secret, tên món ở environment variable; auth states/traces không upload.
  Typecheck/discovery chỉ xác nhận bộ test chạy được về cấu trúc; chưa chạy đích
  không được ghi M-02/M-15/M-16 hay bank/device acceptance đã đạt.

Hoàn tất nghiệm thu còn lại — B21 (2026-10-23):

- Chủ dự án xác nhận chưa có URL thử nghiệm và chưa thể thử thiết bị/5–8người.
  Không dùng fixture, WebKit desktop hoặc test local để thay các bước đó. Chưa
  áp migration, truy cập credential hay bật checkout/worker/deploy.
- Baseline được dựng từ commit9f986ac,8ảnh kèm source/CSS/store/utils hashes;
  xem `automation_test/artifacts/README.md`. Đây là ảnh Git tái dựng bằng current
  toolchain, không phải ảnh deployment trước đổi. Đủ đối chiếu UI và truy xuất
  nguồn; không chứng minh auth/DB hoặc thanh toán lịch sử.
- Sau khi có app staging riêng, đặt biến trong terminal/CI (không commit/chat):
  `E2E_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `STAGING_PREFLIGHT_CONFIRMED_ISOLATED=true`; chạy `npm run test:staging:preflight`.
  CLI không tự load `.env.local`, không dùng service key. Probe hiện yêu cầu
  legacy anon JWT còn hạn/role=anon; key publishable mới chưa được hỗ trợ cho
  kiểm tra này. Thiếu/sai cấu hình phải sửa, không thay bằng service-role key.
- Preflight23checks: positive control key trước, deny8tables/5views và read-only
  admin-health RPC với anon,4page redirect về sign-in đúng origin,3API401 và
  invalid-capability403/no-store. Không follow redirect, không đọc/in body/PII,
 3request đồng thời, timeout5s. POST duy nhất là RPC health chỉ đọc. Không gọi
  create/payment/seed; không chứng minh managed realtime, Clerk positive role
  hoặc bank/device acceptance từ các negative probes này.
- Kết quả `.temp/staging-preflight.json`: PASS/FAIL/NOT_RUN, releaseApproved luôn
  false. Chạy trực tiếp Node có exit0/1/2 tương ứng; npm trả nonzero khi chưa đạt.
  NOT_RUN không được ghi thành pass. B21 hiện là NOT_RUN do thiếu staging; không
  gửi network khi chưa xác nhận isolation. Unit của preflight dùng Response peer,
  không phải kết quả kiểm Supabase thật.
- Khi preflight đạt, chạy staging workflow đã có real Clerk storage states và
  fixture riêng. Kiểm admin/staff/kitchen/inactive, A/B capability và private
  Broadcast join/publish/expiry/disable theo phần M-12 ở trên; kiểm Storage và
  ingress thật. Bật mutation chỉ với fixture riêng được phép. Giữ auth/trace ở
  môi trường bảo vệ; CI đã không upload chúng.
- Với thiết bị thật: ghi model/OS/browser, bàn phím ảo, safe-area, focus/zoom,
  screen reader, quét QR bằng Techcombank và quay lại app, offline/reconnect,
  push khi khóa máy, WakeLock. WebKit/Chromium headless chỉ bổ sung engine proof.
- Khi có thể mời5–8người, giao nhiệm vụ không chỉ nút: tìm bàn/đặt2món có note,
  phân biệt giỏ/món đã gửi, tìm tính tiền, mang về/copy/chờ quán xác nhận. Ghi
  thời gian, lỗi, cần trợ giúp, lời người dùng; chưa đo thì để trống, không điền
  số mẫu như kết quả thật. Dùng mục9 UX plan làm tiêu chí, giữ issue thật để sửa.
- M-16 chỉ chốt khi đủ evidence target, đối soát và review cuối. Script readiness
  hay build pass không tự cho phép phát hành production.
