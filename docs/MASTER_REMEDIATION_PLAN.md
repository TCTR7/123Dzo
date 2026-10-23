# 123Dzô — Kế hoạch hợp nhất sửa lỗi và cập nhật trải nghiệm

Ngày: 2026-10-22 · Phiên bản: 1.0 · **Người dùng đã cho phép bắt đầu triển khai**.

Tiến độ thực tế ghi tại `MASTER_IMPLEMENTATION_PROGRESS.md`. Phê duyệt bắt đầu
không có nghĩa mọi task, schema amendment hoặc cổng production đã hoàn thành.

Đây là kế hoạch triển khai, không phải báo cáo đã khắc phục. Các thay đổi code
được ghi theo từng batch trong progress; chưa áp schema, tạo tài khoản, cấu hình
thanh toán hoặc giao dịch trên dữ liệu thật trong quá trình triển khai local.

## 1. Phạm vi và cách sử dụng

Điều chỉnh người dùng 2026-10-22: v1 chuyển sang xác nhận tiền thủ công bởi
staff/admin, có lịch sử actor/time/amount/reference bất biến theo PRD§12.20.
M-09 thay bằng manual receipt/RBAC/audit; M-10 vẫn tạo/activate/recovery takeaway
nguyên tử, bỏ phụ thuộc provider. UX-09 hướng dẫn chuyển khoản + chờ người xác
nhận; UX-10 tracking vẫn giữ. Webhook tự động hoãn ngoài v1, không tính đã triển
khai. Giữ33 ID, không xóa task hoặc tự cộng hoàn thành do đổi scope. Các mô tả
provider/webhook phía dưới là thiết kế cũ ở nơi xung đột với amendment này.

Kế hoạch này bao phủ toàn bộ phát hiện **đã ghi nhận** trong hai báo cáo audit
và UX, các task UX-00…UX-15, cùng các rủi ro tích hợp phát sinh khi sửa chúng.
Không cam kết rằng đây là toàn bộ lỗi chưa được khám phá của hệ thống.

Thứ tự ưu tiên: chặn truy cập sai → bảo vệ dữ liệu và transaction → thanh toán,
kho, bill → realtime/push → UX → kiểm thử tích hợp và diễn tập vận hành.

Tài liệu đọc bắt buộc:

1. `AGENTS.md` và `docs/PRD_SPEC.md`.
2. `CODEBASE_AUDIT_2026-10-22.md`: bằng chứng audit gốc, AUD-01…09.
3. `CUSTOMER_UX_REVIEW_2026-10-22.md`: phát hiện UX gốc, gọi là **REVIEW-UX-01…09** trong tài liệu này để tránh trùng task.
4. Tài liệu này: phạm vi tổng, quyết định kỹ thuật, thứ tự và cổng nghiệm thu.
5. `UX_UPDATE_IMPLEMENTATION_PLAN.md`: đặc tả màn hình và acceptance chi tiết của **TASK-UX-00…15**.
6. `MASTER_IMPLEMENTER_HANDOFF.md`: prompt giao một task và quy trình review.

AGENTS.md tham chiếu `PRO_SPEC.md`, nhưng file hiện có là `PRD_SPEC.md`.
M-00 sửa tham chiếu sau duyệt; không tạo hai spec song song. Nếu plan mâu thuẫn
với spec, phải hoàn tất amendment M-01 trước khi triển khai phần đó. Plan không
tự thay thế nguồn chân lý về nghiệp vụ/schema.

Master plan thay thế thứ tự triển khai và năm TECH gate còn chung chung của
plan UX. Giữ nguyên chi tiết thiết kế UX trừ nơi tài liệu này nói rõ thay đổi.
Các số dòng trong audit là mốc lịch sử; phải tìm lại source trước mỗi task.

Không nằm trong đợt này: loyalty, voucher, giao hàng, đặt bàn, giỏ đồng bộ đa
thiết bị, công thức nguyên liệu món ăn, tự hoàn tiền, cổng gọi nhân viên mới,
khẩu phần mới, hóa đơn công khai sau đóng bàn. Những ý tưởng này được ghi nhận
là scope riêng; không phải lỗi cũ bị bỏ quên.

## 2. Kết quả cần đạt

- Khách không đăng nhập có thể gọi đúng bàn, biết món đã gửi, theo dõi và tính tiền.
- Khách mang về có thể thanh toán trên một điện thoại, khôi phục đơn, biết nơi nhận và trạng thái cả đơn.
- Người thiếu quyền hoặc bị ngưng hoạt động không thể đọc/ghi dữ liệu nội bộ qua UI, API, DB hoặc realtime.
- Mỗi thao tác nghiệp vụ được commit đầy đủ hoặc rollback; retry không tạo món, tiền, log kho hay thông báo nghiệp vụ trùng.
- Bếp chỉ nhận đơn được phép chế biến; BAR_INSTANT không vào queue bếp.
- Bill, kho và KPI có số liệu có thể đối soát; lỗi tải không được biến thành số 0 giả.
- Test gọi logic production, kiểm tra DB thật trong môi trường riêng và hành trình thực tế theo role.

**Không coi tsc/unit pass là Production-ready.** Các gate ở mục 10 mới quyết định.

## 3. Quyết định kiến trúc đề nghị duyệt

### A-01. Clerk xác thực; hồ sơ DB quyết định quyền thực thi

Đề xuất chốt `staff_profiles.role/is_active` là nguồn quyền nghiệp vụ tại mỗi
request. Clerk xác minh user ID; metadata role chỉ là bản phản chiếu, không
được tự nâng quyền hoặc ghi đè DB. Middleware kiểm tra đăng nhập; server guard
kiểm tra role và active cho page/API; RPC kiểm tra lại actor khi ghi.

Không tạo profile có quyền từ lần đăng nhập đầu. Admin provision nhân sự
có chủ đích bằng Clerk user ID đã xác minh. Tài khoản chưa được cấp quyền
nhận thông báo liên hệ quản lý. Admin đầu tiên được provision ngoài luồng
đăng ký công khai theo runbook, không dựa vào “user đầu tiên là admin”.

Đây là thay đổi so với mô tả metadata-role trong spec mục 8, cần M-01 chốt.
Đăng ký công khai nếu giữ vẫn không cấp quyền nhân sự. Mọi lỗi auth/DB phải
deny hoặc trả lỗi dịch vụ, tuyệt đối không tạo actor admin giả.

### A-02. Server API là cổng nghiệp vụ; browser không ghi bảng

Chọn hướng **Next.js Route Handlers → module server-only → PostgreSQL RPC
transaction**. Không triển khai song song hai kiến trúc ghi từ browser và API.

- Browser gửi ý định: menu ID, quantity, note, expected state, operation ID.
- Server xác minh Clerk hoặc capability khách, parse input, giới hạn request.
- DB lấy giá/cost/station/actor hợp lệ, kiểm tra phiên/quyền, khóa và ghi nguyên tử.
- `anon/authenticated` không có quyền ghi trực tiếp các bảng nghiệp vụ; không được gọi RPC nội bộ.
- Service role chỉ ở server; thiếu key phải lỗi cấu hình, không fallback anon.
- RPC nhận actor từ server đã xác thực; chữ ký RPC không tạo quyền cho caller công khai. Revoke EXECUTE từ PUBLIC/anon/authenticated; fixed search_path; tên bảng đầy đủ; grant chính xác cho server role.
- Các base tables và KPI views không được đọc công khai. Server trả DTO tối thiểu, không `select('*')` rồi trả toàn bộ cho khách.
- Một transaction là một RPC hoặc kết nối transaction thật; nhiều lần `await supabase...` trong JS không phải transaction.

RLS/grants phải kiểm thử bằng anon key và JWT người dùng; kiểm thử service
role riêng vì service role có thể bypass RLS. Bảo vệ server guard là bắt buộc.
Migration khóa quyền chỉ được đưa cùng phiên bản API/client đã chuyển đổi;
không deploy giữa chừng khiến toàn bộ màn hình đang dùng bị lỗi.

### A-03. Khách dùng capability; realtime chỉ gửi tín hiệu thay đổi

`session_token` ngẫu nhiên mạnh là bí mật truy cập phiên. Không dùng UUID phiên,
SĐT hoặc payment_code thay capability. Khách chỉ đọc projection của phiên mình;
không nhận cost, token bàn khác, thông tin nhân sự hay SĐT khách khác.

Takeaway trả capability một lần khi tạo; bảo vệ khi khôi phục. Đề xuất lưu
tham chiếu trên thiết bị để khôi phục, kiểm tra server mọi lần; không tin total
hay trạng thái localStorage. Phải nêu rõ ai dùng chung thiết bị có thể xem đơn.
Tra cứu chỉ bằng SĐT trong spec phải đổi thành SĐT + capability/mã bí mật hoặc
quy trình xác minh riêng; không thêm OTP provider trong đợt này.

Realtime đề xuất: Supabase **private Broadcast** với ticket ngắn hạn do server
cấp sau kiểm tra capability/Clerk. Topic gắn một session hoặc role nội bộ;
payload chỉ chứa loại thay đổi và version/ID cần refresh, không chứa hàng DB,
PII hay token. Client refetch DTO qua API đã bảo vệ.

M-02 phải chứng minh ticket/policy tương thích phiên bản SDK và cấu hình
Supabase trên test project, bao gồm chống join/publish topic giả, token hết hạn
và user bị disable. Ticket không cho phép đọc base table hoặc gọi RPC nội bộ.
Đóng bàn chặn API ngay cả khi ticket cũ còn sống; không broadcast dữ liệu nhạy cảm.
Nếu cơ chế này không khả thi trong hạ tầng đã chọn, M-02 trả BLOCKED quyết định
realtime; không mở SELECT toàn bảng để “sửa nhanh”. Polling có bảo vệ là fallback
tạm thời khi mất channel, không tự được coi đã đạt yêu cầu realtime.

### A-04. Durable idempotency, payment receipt và outbox

Tám bảng hiện tại không có nơi rõ ràng lưu operation/replay/outbox. Đề xuất
M-01 phê duyệt schema bổ sung, chưa tạo bảng trong lượt lập plan:

- `private.operation_requests`: `id uuid PK`, `scope_key text`, `operation_id uuid`, `action text`, `request_hash text`, `session_id uuid nullable`, `actor_id text nullable`, `result jsonb`, `created_at timestamptz`; UNIQUE(scope_key, operation_id). Result chỉ lưu DTO tối thiểu; không lưu capability dạng rõ.
- `private.payment_events`: `id uuid PK`, `provider text`, `provider_transaction_id text`, `session_id uuid nullable`, `payment_code text`, `amount numeric`, `verified_payload_hash text`, `outcome text`, `reason text nullable`, `received_at timestamptz`, `processed_at timestamptz nullable`; UNIQUE(provider, provider_transaction_id). Outcome đề nghị: APPLIED hoặc REVIEW_REQUIRED; không phải enum trạng thái phiên mới.
- `private.notification_outbox`: `id uuid PK`, `dedupe_key text UNIQUE`, `session_id uuid nullable`, `order_item_id uuid nullable`, `kind text`, `payload jsonb`, `available_at timestamptz`, `attempts int`, `locked_until timestamptz nullable`, `delivered_at timestamptz nullable`, `last_error text nullable`, `created_at timestamptz`. Payload tối thiểu, không secret/PII.

Các bảng private không expose qua Data API/realtime và không cấp anon. M-01
phải ghi đủ nullability, FK/delete behavior, CHECK, index, retention và RPC
types vào spec. Đây là **đề xuất để duyệt**, không cho Builder tự thêm biến thể.

Operation result và thay đổi nghiệp vụ commit cùng transaction. Cùng key +
cùng body trả cùng kết quả; cùng key + khác body trả conflict. Sau timeout,
client hỏi kết quả theo cùng scope/key hoặc gửi lại **cùng key**, không đổi key.
Auth/capability vẫn được kiểm tra khi replay. Request rollback không được ghi
thành công. Không dùng memory Map hoặc localStorage làm bằng chứng idempotency.

Payment transaction ID không được áp sang phiên khác. Callback hợp lệ nhưng
không thể áp nghiệp vụ phải lưu REVIEW_REQUIRED và báo quản lý, không giả là
đã thanh toán thành công trong app. Worker outbox retry có lease; nghiệp vụ
exactly-once không đồng nghĩa Web Push transport exactly-once. Notification tag
và UI dedupe giảm trùng khi worker chết sau gửi nhưng trước đánh dấu delivered.

### A-05. Các quy tắc tiền, kho và trạng thái cần ghi vào spec

1. Giá tiền VND lấy từ DB; không tính bằng số float tùy ý hoặc dữ liệu giỏ. Giá thay đổi giữa xem lại và gửi: trả PRICE_CHANGED với quote mới; khách xác nhận lại.
2. Tổng phiên = SUM(quantity × unit_price) của món không CANCELLED. Đóng phiên khóa phiên và tính lại; chưa thanh toán thực tế không được gắn CLOSED.
3. Tồn tự trừ chỉ cho menu có liên kết 1:1 đúng đơn vị bán, đặc biệt bia/nước. Không giả định một đĩa thức ăn bằng một kg nguyên liệu; food mapping sai phải sửa dữ liệu theo xác minh của quán.
4. IMPORT/RETURN_BEER quantity_change dương; EXPORT_SALE/WASTAGE âm. `total_cost = abs(quantity_change) × unit cost được xác nhận tại thao tác`. Return dùng giá vốn snapshot của món nếu liên kết 1:1; giữ quy tắc chi phí nhất quán khi giá nhập đổi. Không cộng WASTAGE lần hai cho phần đã trừ kho lúc bán.
5. Takeaway PENDING_PAYMENT không xuất kho/không gửi bếp/không push READY. Đề xuất không giữ tồn trước chuyển khoản trong đợt này; khi callback hợp lệ nhưng thiếu tồn: giữ đơn ngoài queue, lưu REVIEW_REQUIRED, hiện “Quán cần xác nhận khả năng phục vụ; không chuyển thêm tiền”, cảnh báo quản lý. Chỉ retry áp giao dịch sau khi xử lý tồn và cùng transaction ID. Không tự refund hoặc tự đổi món. Chủ quán cần duyệt giới hạn này; nếu cần bảo đảm giữ hàng trước trả tiền, phải duyệt thêm reservation/expiry trước triển khai, không tự bịa ở M-10.
6. BAR_INSTANT của takeaway chưa thanh toán có thể lưu READY theo enum hiện có nhưng `ready_at` chưa ghi và tuyệt đối bị loại khỏi mọi hàng phục vụ; khi activate mới ghi ready_at và outbox. M-01 phải ghi ngoại lệ này rõ, hoặc chọn thiết kế lưu draft riêng nếu không chấp nhận; không đưa BAR vào QUEUED để né vấn đề.
7. Giữ `created_at` bất biến là thời điểm khách tạo món. Đề xuất thêm `table_sessions.activated_at timestamptz nullable` để takeaway dùng thời điểm thanh toán làm mốc queue; dine-in dùng created_at. Queue/KPI chờ bếp dùng effective queue time; không cộng thời gian chờ trả tiền. Backfill không suy diễn timestamp lịch sử không có bằng chứng.
8. Hủy thường: staff chỉ QUEUED; admin hủy QUEUED/COOKING/READY/SERVED, bắt buộc lý do cho món đã bắt đầu/đã sẵn sàng/đã phục vụ. Kitchen không hủy. RETURN_BEER là nghiệp vụ riêng của staff/admin, không phải quyền hủy món đã phục vụ nói chung.
9. Trả một phần: giảm quantity; trả toàn bộ: đề xuất quantity=0, giữ timestamps/trạng thái gốc, không giả cancelled bởi staff. Cần sửa CHECK/schema và KPI để dòng quantity=0 không đóng góp tiền/sản lượng; quyết định count lượt phục vụ phải ghi rõ M-01. Chỉ bia/đồ uống chưa dùng được nhân viên xác nhận, không vượt lượng còn lại và không trả trên CLOSED. Nếu không duyệt quantity=0, phải thiết kế return ledger riêng trước M-07; không DELETE lịch sử.
10. Đóng takeaway: nhân viên xác nhận đã giao đủ, không suy ra từ thanh toán. Admin xử lý ngoại lệ có lý do theo workflow được duyệt. Đơn đã CLOSED không bị webhook mới mở lại.
11. Dine-in VietQR: chỉ tự chốt khi REQUEST_BILL, tổng đã khóa và callback khớp. Khi tiền đến lúc ACTIVE/tổng lệch/phiên đã đóng do CASH: lưu REVIEW_REQUIRED, không tự giải phóng bàn.
12. Chốt bill có món chưa phục vụ: chặn và liệt kê món cần xử lý, không âm thầm tính/đóng. Trước chốt staff phục vụ hoặc admin hủy đúng quyền. Snapshot lịch sử không đổi khi chỉnh menu.
13. Hủy món không tự động đồng nghĩa hàng đã trở lại kho. M-01 phải chốt cách xử lý phần đã EXPORT_SALE: đồ uống còn nguyên dùng RETURN_BEER; hàng đã dùng không hoàn kho. Nếu món đã nấu bị hủy cần ghi nhận tổn thất tài chính, phải chốt công thức KPI/ghi nhận chi phí để không vừa mất COGS vừa trừ stock thêm lần nữa. Không tự gắn WASTAGE quantity âm lần hai cho cùng lượng đã xuất bán. M-07/M-11/M-13 phải có fixture hủy trước/sau chuẩn bị và đối soát cả tồn lẫn chi phí.

Các điểm 5–9 là quyết định thực sự ảnh hưởng nghiệp vụ/schema; duyệt tổng quan
không cho phép model tùy chọn các phương án trái nhau. M-01 phải chốt một
phương án duy nhất bằng amendment reviewable trước code phụ thuộc.

### A-06. Provider, scheduler và thông tin quán

Chỉ enable **một provider thanh toán được cấu hình rõ** trong bản phát hành đầu.
Không auto-detect bằng hình dạng payload và không fallback auth giữa provider.
M-09 cần tên provider, tài khoản nhận đã xác minh, chế độ webhook thực tế và
test credentials được cung cấp qua môi trường an toàn. Đọc tài liệu chính thức
ở thời điểm triển khai; không coi hàm HMAC hiện tại là chuẩn provider.

Push fallback sau 2 phút cần scheduler bền vững. M-12 phải chọn cơ chế có thể
chạy đủ thường xuyên trong deployment thực, đo độ trễ, xác nhận quota/chi phí.
Không dùng setTimeout trong HTTP request. Không hứa ngân sách 0 đồng/tháng
hoặc push đúng 120 giây khi chưa xác minh giới hạn platform. Thiếu scheduler
phù hợp là gate chưa đạt, không âm thầm bỏ yêu cầu spec.

## 4. Contract chung để model triển khai nhất quán

M-02 ghi contract chi tiết trong `docs/IMPLEMENTATION_CONTRACTS.md` (file mới
chỉ sau duyệt), với input/output typed, auth, errors, RPC và ví dụ test. Các
endpoint sau là danh mục dự kiến cần bổ sung mục 9/13 của spec tại M-01:

- `GET /api/customer/menu`: DTO menu công khai không cost/stock nội bộ.
- `GET /api/customer/session`: capability, chỉ phiên tương ứng và tổng chuẩn.
- `POST /api/customer/orders`: capability dine-in ACTIVE, operationId, lines.
- `POST /api/customer/request-bill`: capability, operationId, payment method.
- `POST /api/customer/takeaway`: lines, tên/SĐT, quote, operationId; tạo PENDING_PAYMENT nguyên tử.
- `GET /api/customer/operation`: đối soát operation, cùng scope/capability; không liệt kê operations.
- `POST /api/realtime/ticket`: capability hoặc Clerk; ticket/topic tối thiểu.
- `POST /api/staff/tables/open`, `/transfer`, `/close`: Clerk staff/admin, expected state, operationId.
- `POST /api/staff/orders`: gọi hộ, cùng engine đặt món; `/serve`, `/cancel`, `/return-beer` là các action riêng.
- `POST /api/kitchen/start`, `/complete`, `/availability`: kitchen/admin, danh sách ID rõ ràng, expected state.
- `POST /api/admin/inventory`, `/menu`, `/staff`: admin; validation và audit actor. Read routes tương ứng phân trang, projection theo role.
- `GET /api/admin/kpi`: admin, khoảng thời gian, kết quả aggregate từ DB.
- Giữ `/api/webhooks/payment`, `/api/push/subscribe`, `/api/push/notify`, `/api/cron/keep-alive`; notify là nội bộ được bảo vệ, không endpoint để khách chọn người nhận.
- Worker outbox qua endpoint/server job riêng có service authentication; tên và lịch cụ thể chốt M-12.

Không đặt capability trong query string của API nếu có thể dùng header/cookie
phạm vi hẹp; URL QR vốn có token phải no-store/no-referrer và redact log.
Cookie mutation phải có Origin/CSRF guard; JSON-only, giới hạn body và số dòng,
quantity nguyên dương khi đặt, note giới hạn, phone parse rõ; từ chối unknown
privileged fields thay vì tin `actor`, `unit_price`, `station`, `status` từ body.

Response thành công dùng `{ data, operationId?, serverTime }`; lỗi dùng
`{ error: { code, message, retryable }, operationId? }` và HTTP đúng nghĩa:
401 thiếu identity, 403 thiếu quyền, 404 không có tài nguyên trong scope,
409 conflict/price/state, 422 dữ liệu nghiệp vụ, 429 rate limit,
503 dịch vụ tạm lỗi. Không trả raw SQL/secret/stack cho khách.

Riêng webhook phải tuân thủ response/ack chuẩn provider: invalid auth bị từ
chối; lỗi transient DB được retry; REVIEW_REQUIRED đã lưu bền vững được ack
theo contract nhưng **không** báo order activated. Missing order hợp lệ được
lưu để đối soát thay vì mất sự kiện. Browser chỉ hiển thị paid từ server state.

Takeaway create timeout trước khi client nhận capability: M-02 phải thiết kế
bootstrap recovery secret do client sinh ngẫu nhiên, gửi cùng request và lưu
hash scope server; retry cùng operationId+secret khôi phục đúng phiên/capability
qua cơ chế đã duyệt. Không mở endpoint lấy capability chỉ bằng operationId.
Không lưu secret rõ trong operation result/log. Test bắt buộc cho tình huống này.

## 5. Backlog kỹ thuật — mỗi task phải review riêng

Mỗi task dưới đây mặc định phải: đọc source hiện tại, chỉ thay phạm vi liên
quan, cập nhật types/contracts khi cần, chạy test acceptance, ghi bằng chứng.
Không đánh dấu DONE chỉ vì đã tạo file. Task lớn có các phần a/b/c để giao
từng lượt; chúng không được deploy rời nếu tạo trạng thái không an toàn.

### M-00 — Baseline, danh mục truy vấn và tài liệu [P0]

Phụ thuộc: người dùng duyệt hướng plan. Files: AGENTS, spec, docs; chỉ đọc src/tests.

- Sửa PRO_SPEC → PRD_SPEC; thống nhất routes thực tế `/customer/order/[token]`, `/customer/takeaway` và `src/lib/store/useCartStore.ts` trong spec, không tự di chuyển route.
- Lập inventory tất cả `.from`, `.rpc`, storage, channel, API/SSR: caller, quyền, projection, mutation, task thay thế; quét cả component/admin và util, không chỉ customer.
- Baseline git, tsc, unit, build nếu cấu hình test cho phép; ghi dependency lock/version; ảnh baseline khi browser khả dụng.
- Tạo progress ledger từ IDs mục 8, tất cả TODO; các phát hiện mới thêm ID, không sửa báo cáo gốc thành đã hết lỗi.
- Chốt test project và dữ liệu giả chỉ trong test; không đọc/in `.env.local`.

Nghiệm thu: inventory không bỏ query; đường dẫn spec thống nhất; log mới phân
biệt log audit lịch sử. TASK-UX-00 được đáp ứng chung, không chạy lại trùng lặp.

### M-01 — Amendment schema/nghiệp vụ có thể duyệt [P0]

Phụ thuộc: M-00. Files: spec và tài liệu quyết định; chưa chạy SQL.

- Ghi A-01…06, routes/modules mới, 3 bảng private, activated_at, return toàn bộ, queue clock, payment exception và quyền staff/kitchen/admin.
- Chốt quy tắc stock không giữ trước trả tiền; mô tả người xử lý REVIEW_REQUIRED và màn admin đối soát tối thiểu.
- Chốt cost return, cost wastage, serving count sau full return, bill chốt khi món còn dở, thu vượt/thiếu tiền; đề xuất exact amount tự áp, khác amount chuyển review, không tự cộng tiền chuyển lần hai.
- Chốt kế toán món đã xuất/nấu rồi bị hủy: hàng có hoàn lại thực hay không, chi phí hủy nằm ở đâu trong KPI; không tạo log xuất kho trùng hoặc làm mất chi phí. Nếu cần metadata bổ sung để phân biệt lý do hủy tài chính, đưa vào amendment cụ thể trước code.
- Chốt privacy tra cứu SĐT, retention operations/payment/outbox, scope đổi role và cách bootstrap admin.
- Xuất schema proposal đầy đủ, index/check/grants và kế hoạch migration/backfill cho reviewer; không chỉ để “TODO schema”.

Nghiệm thu: mỗi quyết định một phương án duy nhất, diff spec được duyệt; nếu
user chọn khác, cập nhật plan/contracts/test cùng lúc. Đây là checkpoint duyệt
thay đổi spec do AGENTS yêu cầu không tự thêm bảng/cột, không phải duyệt lại
cho từng thao tác code đã nằm trong scope được chấp thuận.

### M-02 — Contracts và thử nghiệm tích hợp giới hạn [P0]

Phụ thuộc: M-01. Files đề xuất: docs/IMPLEMENTATION_CONTRACTS.md; test spike
trong thư mục test được bổ sung spec, không code mock runtime.

- Viết đầy đủ endpoint/RPC ở mục 4, DTO customer/staff/kitchen/admin, error codes và idempotency scope.
- Chứng minh Clerk identity → guard → restricted RPC; private realtime ticket/channel không lộ base rows.
- Chốt recovery cho create takeaway bị mất response; kết quả replay không lộ token qua đoán UUID.
- Xác minh service runtime/scheduler/provider integration cần thiết, chỉ test project.
- Công bố lock order: session → tables theo ID tăng dần → order_items theo ID → ingredients theo ID; thao tác không có session vẫn khóa cùng thứ tự từng loại. Xử lý deadlock bằng retry có giới hạn/cùng operationId.

Nghiệm thu: test caller hợp lệ và caller giả đều có kết quả; không có lựa chọn
kiến trúc chưa chốt cho Builder. Có blocker thì hoàn tất phần độc lập và ghi rõ.

### M-03 — Auth/RBAC fail closed [P0; AUD-01]

Phụ thuộc: M-01. Files: middleware, sync-staff, server client, layouts/pages
protected, sign-in/sign-up, server guard mới theo spec.

- Bỏ mọi fallback admin/isActive=true. Trả discriminated result authenticated/forbidden/unavailable.
- Middleware không redirect theo metadata lỗi thời; server guard điều hướng theo profile DB và chặn inactive ở mọi route.
- Bỏ auto-provision quyền; admin cấp/đổi/thu hồi role qua API bảo vệ, không browser upsert.
- Guard không cache quyền vượt lifetime request; disable user có hiệu lực request kế tiếp.
- Tách service role server-only và fail config; không bundle key ra client.

Tests: no user/missing role/new signup/invalid role/DB error/inactive/role mismatch;
staff gọi admin API, kitchen gọi staff API; direct URL không loop; profile không
bị tạo khi auth lỗi. Bootstrap admin và tự bỏ admin cuối cùng phải có guard/runbook.

### M-04 — Migrations, RLS, grants và schema/type parity [P0; AUD-02]

Phụ thuộc: M-01/02; guard M-03 để tích hợp. Files: schema, migration versioned
theo spec mới, database.types, DB integration tests.

- Tạo extension schema đã duyệt; enable RLS tất cả bảng nghiệp vụ và private tables; revoke access views/RPC mặc định.
- Chỉ server gọi RPC nghiệp vụ; không policy `true` cho ghi hoặc đọc PII. Kiểm tra view owner/security behavior và function EXECUTE rõ ràng.
- CHECK quantity/price/stock phù hợp spec đã chốt; unique một phiên dine-in đang mở trên một bàn; kiểm tra FK current_session_id và dữ liệu lệch trước thêm constraint.
- Index theo truy vấn thật: session items, trạng thái queue, payment_code unique hiện có, outbox due/lease, operation scope/time, provider transaction unique. EXPLAIN trên fixture đủ lớn, không thêm index theo cảm tính.
- Update type functions/rows/views và DTO; không `any`, không ép kiểu để giấu schema mismatch.

Tests: bootstrap DB mới và upgrade fixture cũ; anon/Clerk không SELECT/INSERT/
UPDATE/DELETE base tables, KPI, staff subscription hoặc gọi RPC nội bộ; server
RPC hợp lệ hoạt động. RLS kiểm thử DB thật, không dùng mock Supabase làm bằng chứng.
Không deploy migration khóa quyền trước khi các client đã chuyển API.

### M-05 — Transaction engine, idempotency và rate limit [P0/P1]

Phụ thuộc: M-02/04. Files: RPC helpers, server validation/contracts, operation API.

- a: durable operation claim/result trong cùng transaction, fingerprint canonical input, scoped replay.
- b: rate limit tối đa 2 lượt đặt thành công/mới trong rolling 10 giây mỗi phiên, serialize cùng session lock; replay không tính thêm. Bổ sung giới hạn request abuse/IP có cấu hình cho public create, không memory-only trong serverless.
- c: input bounds, server time, conflict/error mapping, recovery endpoint bảo vệ.

Tests: hai request cùng key đồng thời; khác payload cùng key; timeout sau commit;
rollback giữa chừng; request thứ ba trong 10 giây; hai thiết bị vượt quota;
restart process vẫn replay được; capability khác không lấy kết quả nhau.

### M-06 — Đặt món tại bàn và gọi hộ [P1; AUD-02/05/06]

Phụ thuộc: M-03/04/05. Files: DineInOrderView, StaffDashboard, customer/staff
order routes, shared order RPC.

- Khóa session và chỉ ACTIVE; kiểm tra menu khả dụng/giá/quantity, lấy snapshot price/cost/station ở DB.
- Trừ kho linked 1:1 đủ tồn, insert EXPORT_SALE, insert items, tính total và outbox trong cùng transaction.
- KITCHEN QUEUED; BAR_INSTANT READY + ready_at DB NOW + notification event.
- Từ chối toàn lượt nếu một dòng lỗi, trả dòng cần khách sửa; không âm thầm nhận một phần.
- Browser bỏ trực tiếp ghi bảng, chỉ clear phần giỏ đã được xác nhận, giữ operation key khi mất response.

Tests: giả giá/cost/station/actor; ACTIVE→REQUEST_BILL trong lúc gửi; CLOSED,
PENDING_PAYMENT; hết món/đổi giá; stock 1 hai khách mua; fault sau item trước log;
giá menu thay đổi không sửa snapshot cũ; bar không queue bếp.

### M-07 — Kho và trả bia nguyên tử [P1; AUD-06]

Phụ thuộc: M-01 quy tắc return/cost, M-04/05/06. Files: InventoryManager,
StaffDashboard return, inventory/return RPC, seed mapping liên quan.

- IMPORT/WASTAGE chỉ admin, cập nhật số học stock và log cùng transaction; không clamp stock về 0.
- RETURN_BEER staff/admin kiểm tra món đủ điều kiện, phiên chưa CLOSED, lượng trả không vượt remaining; khóa item/ingredient, giảm quantity, tăng stock, log và total cùng commit.
- Full return theo phương án đã duyệt, giữ lịch sử; không gọi generic cancel để vượt quyền.
- Giá vốn inventory log có snapshot số thực tại transaction; mọi lỗi giữ nguyên kho/bill/log.
- Xóa liên kết food→kg giả chỉ sau kiểm tra danh mục dữ liệu test/quán; không xây BOM ngoài scope.

Tests: trả từng phần nhiều lần, trả toàn bộ, trả vượt, hai staff trả cùng lúc,
retry return, price cost đổi giữa bán/trả, âm kho, WASTAGE không tính trùng lượng
đã export. Đối soát stock đầu + SUM(log quantity_change) = stock cuối.

### M-08 — Mở/chuyển/đóng bàn và tổng bill [P1; AUD-05]

Phụ thuộc: M-03/04/05/06/07. Files: StaffDashboard, BillsManager, StaffAndTableManager,
staff/admin bill SSR, table RPC.

- Open khóa bàn AVAILABLE; tạo token server, session và current_session_id atomically.
- Transfer khóa nguồn/đích, giữ session token, cập nhật hai bàn/session/assignment theo quy tắc; không ghi đè bàn đang có phiên.
- Request bill khóa session, tính tổng DB, ACTIVE→REQUEST_BILL; tất cả máy dừng thêm món.
- Close tính lại toàn bộ items theo session, kiểm tra khoản thanh toán/món chưa xử lý; CLOSED + closed_at + giải phóng đúng bàn trong một transaction.
- Bỏ tổng từ danh sách 300/500 món; list phân trang tách detail theo session và aggregate server. Không cần tải toàn bộ món toàn quán để chốt.
- Nhân viên chỉ hành động đúng role; bàn giao người phụ trách có kiểm tra active, thông báo tới assignment mới.

Tests: hai mở cùng bàn; hai chuyển tới cùng đích; add vs request bill/close;
transfer vs close; session >500 items vẫn đúng tổng; duplicate close;
callback cũ không giải phóng bàn đã có phiên mới; token cũ không đọc/gọi món.

### M-09 — Xác minh webhook theo provider [P0; AUD-03/09]

Phụ thuộc: M-02 và provider/config được xác minh. Files: payment route,
server-only payment adapter/config, unit fixtures chính thức đã khử bí mật.

- Parse unknown runtime schema; giới hạn body; malformed JSON trả 400, không 500.
- Chỉ dùng fields nằm trong envelope đã được provider xác thực; bỏ ưu tiên top-level payment_code unsigned.
- Xác minh signature/secret đúng protocol, constant-time khi so secret phù hợp, kiểm tra success/direction/currency/receiver/amount/transaction ID theo dữ liệu provider thực sự cung cấp.
- Nếu signed payload không có đủ receiver/status, ràng buộc merchant configuration hoặc xác minh qua API provider; không tin field ngoài chữ ký để bù.
- Không cho phép webhook unsigned ở dev trong code production; test gửi fixture ký bằng secret test.
- Bỏ bank/account giả và fallback; config thiếu thì checkout bị khóa với thông báo rõ, không sinh QR.

Tests: body bị sửa, signature sai/thiếu, chữ ký hợp lệ nhưng field ngoài data
retarget, replay transaction sang phiên khác, payment failed/outgoing/wrong
receiver/currency, NaN/âm/0, provider chưa bật. Không truy cập tiền thật.

### M-10 — Tạo takeaway và áp thanh toán nguyên tử [P1; AUD-04]

Phụ thuộc: M-04/05/07/08/09; A-05 đã chốt. Files: TakeawayOrderView,
takeaway/create/payment RPC, webhook, admin payment-review tối thiểu.

- a: tạo PENDING_PAYMENT + toàn bộ item snapshots + total + payment_code unique cùng transaction; recovery timeout theo M-02.
- b: receipt unique transaction; khóa phiên và tồn; exact amount, hợp lệ nghiệp vụ mới activate + activated_at + ready timestamps + stock/log/outbox cùng commit.
- Không ghi lại created_at hoặc QUEUED cho đơn đã COOKING; replay trả kết quả cũ.
- c: REVIEW_REQUIRED có UI admin, reason và thao tác retry cùng event sau xử lý; không nút “bỏ qua xác minh”. Màn khách nêu chưa thể nhận đơn/không chuyển thêm. Event thiếu phiên/khác amount/thiếu tồn/lần thanh toán thứ hai cần điều tra, không âm thầm bỏ.
- Dine-in callback chỉ đóng phiên và giải phóng bàn khi khớp điều kiện M-08; cash close chạy đua webhook không ghi nhận hai lần.
- Thanh toán thành công không phải takeaway đã giao hàng; thao tác staff xác nhận giao riêng.

Tests: fault ở mọi bước trước commit rồi retry; callback đồng thời; server chết
sau commit; duplicate sau bếp bắt đầu; thiếu tồn lúc nhận tiền; over/underpay;
callback của bàn cũ sau mở bàn mới; tất cả đơn chưa xác nhận bị loại khỏi KDS,
queue customer, staff ready list, KPI bán hàng và push.

### M-11 — State transitions và KPI timestamps [P1; AUD-07]

Phụ thuộc: M-03/04/05/06/10. Files: KitchenKdsBoard, StaffDashboard,
transition RPC và shared state contracts.

- Kitchen/admin nhận nấu QUEUED→COOKING, hoàn thành COOKING→READY; staff/admin phục vụ READY→SERVED.
- Server lấy actor thật và timestamp DB; served_by_staff_id không lấy từ body.
- Cancel matrix đúng A-05; reason trim không rỗng cho cooked; món CANCELLED không bị resurrect.
- Batch IDs explicit, kiểm tra đủ tất cả rows/expected state trong transaction; một dòng conflict rollback cả batch và yêu cầu refresh, không báo cả mẻ thành công khi chỉ một phần.
- Giữ note riêng mỗi phần, batch_id và timestamps không reset do retry.

Tests: cancel vs start, complete vs cancel, hai staff serve, repeated completion,
batch mixed status/station/unpaid, staff cố hủy COOKING/READY/SERVED, reason
whitespace, spoof actor/time. KPI timestamp không âm, không bị ghi lại khi replay.

### M-12 — Realtime, outbox, Push/PWA/audio [P1; AUD-08]

Phụ thuộc: M-02/04/06/08/10/11. Files: 5 channel owners, push APIs, worker,
manifest, SW/Serwist config, audio/assets, publication/policies nếu cần.

- a: private invalidation + refetch scoped DTO; menu 86ing được publish theo đường an toàn đã chọn. Không chỉ ADD publication rồi mở toàn bộ menu chứa cost.
- Queue projection lọc session ACTIVE/REQUEST_BILL hợp lệ, không đọc global raw orders của khách khác. Effective queue time theo M-01; realtime session change phải refresh queue cả khi item chưa đổi.
- Sửa stale sessionMap bằng state/ref/update logic đúng; event duplicate/out-of-order không gây lùi trạng thái, debounce refetch.
- b: outbox cùng transaction READY/request-bill/new kitchen item; worker lease/retry/backoff; failed jobs nhìn thấy, không mất khi serverless kết thúc.
- Push target xác định từ assignment DB, fallback zone sau ready_at+120s nếu vẫn READY/chưa served. Worker kiểm tra trạng thái mới và dedupe trước gửi; không notify khách tự chọn staff.
- c: SW đăng ký, subscribe sau thao tác người dùng, unsubscribe/update profile, nhận push/notificationclick vào đúng màn; bảo vệ endpoint subscribe chỉ lưu subscription của chính user; bỏ endpoint 410, quản lý 404 theo provider push.
- Thay file audio hỏng bằng asset hợp lệ có quyền sử dụng, icons đầy đủ, cơ chế bật âm thanh do user gesture và xử lý browser deny.
- Serwist không cache API mutation/payment/PII/auth/session SSR; offline chỉ menu static hợp lệ và thông báo rõ, không báo order sent từ cache.
- Giữ cleanup channels/listeners/timers; WakeLock xin lại khi visible, release khi unmount, xử lý unsupported/rejected không crash.

Tests: mount/unmount nhiều lần không tăng subscription; reconnect refetch;
new session sau mount có audio; unpaid không beep; menu hết cập nhật mọi máy;
worker restart, push lỗi/duplicate, serve trước fallback; permission denied,
lock-screen/device PWA thật. Ghi giới hạn OS audio/push, không cam kết âm thanh
tùy chỉnh khi khóa màn hình nếu nền tảng không hỗ trợ.

### M-13 — Dashboard và báo cáo chính xác [P1]

Phụ thuộc: M-07/08/10/11. Files: 5 vw_kpi_* / RPC, admin page,
AdminKpiDashboard, database types, KPI tests.

- Giữ aggregate DB; đủ financial/menu/kitchen/waitstaff/peak-hours và filter đồng bộ.
- Thêm/hoàn thiện RPC peak hours theo khoảng thời gian; đổi range phải đổi heatmap, không state bất biến từ SSR.
- Chốt kỳ theo metric trong M-01: revenue theo closed_at, COGS theo served_at, wastage theo log created_at, serving theo served_at, mở bàn theo opened_at, queue theo effective time. Khoảng [start,end) theo Asia/Ho_Chi_Minh, không đếm trùng nửa đêm.
- Loại unpaid khỏi sold/queue analytics; full return quantity=0 và cancelled xử lý đúng. Giữ 5 views tương đương all-time, không tính lại KPI bằng JS browser.
- Lỗi truy vấn hiển thị lỗi/retry và last updated, không fake zero. Phân biệt no-data với 0 thật; không suy ra tốc độ “xuất sắc” khi không có dữ liệu.

Tests: fixture doanh thu/COGS/wastage/return có đáp án tính độc lập; đổi giá
không đổi kỳ cũ; phiên mở trước kỳ đóng trong kỳ; món qua nửa đêm; 5 views vs
RPC cùng khoảng toàn bộ; ngày rỗng và DB error khác nhau; filter peak hours.

### M-14 — Admin CRUD, ảnh, cấu hình và dữ liệu production [P1/P2]

Phụ thuộc: M-03/04/05; kết hợp M-07/08/13. Files: admin components/routes,
utils compression, storage policy, seed, env example, API cron.

- Chuyển toàn bộ CRUD menu/kho/zone/table/staff khỏi browser theo query inventory M-00; typed input, optimistic conflict và pending buttons.
- Không xóa menu/nhân sự/bàn đang được FK lịch sử tham chiếu bằng cascade làm mất chứng từ; dùng is_available/is_active khi phù hợp; báo lý do không thể xóa.
- Nén WebP **size < 80 × 1024 bytes** theo đơn vị dự án chốt, exact boundary phải reject/recompress; kiểm MIME/decode image thực, giới hạn dimensions và upload lỗi. Storage upload chỉ admin qua signed upload/scoped authorization; không bucket write public. Cleanup orphan có kiểm tra file đang được tham chiếu.
- Tách seed demo khỏi production bootstrap, không upsert reset tồn/trạng thái thật; sửa bill 986k/978k inconsistency; token demo chỉ test/dev.
- Rà mọi `mock`, `demo`, `fallback`, numeric sample trong src bằng search rồi đọc ngữ cảnh; giữ fallback UI hợp lệ (ảnh thiếu/text lỗi), bỏ giả business data và unsigned payment bypass.
- Validate env server/public riêng; không in secrets; keep-alive/worker secret và rate limits; deployment thiếu config phải fail rõ.

Tests: ảnh 81919/81920/81921 bytes theo chuẩn đã chốt; upload unauthorized,
file giả MIME, upload thành công DB save thất bại; seed guard trên target sai;
config missing không có bank giả/admin giả/zero KPI giả. Query inventory không
còn direct mutation client ngoài subscription được phép qua API.

### M-15 — Nâng chất lượng test và CI [P1]

Phụ thuộc: M-00 để dựng harness sớm; nghiệm thu cuối sau M-03…14 và UX.
Files: unit_test, automation_test, Vitest/Playwright configs, package/lock,
test tsconfig và CI theo cấu trúc spec đã bổ sung.

- a: unit test import production helpers/adapters; bỏ business logic copy trong test; fixture typed đúng schema, không cancelled_by_staff_id/returned_quantity giả.
- b: cài coverage-v8 đúng phiên bản Vitest thực trong lockfile; include server handlers/domain/store/customer logic, không chỉ src/lib. Report uncovered branches, không loại file khó để tăng số đẹp.
- c: DB integration trên project/container riêng cho RPC/RLS/concurrency/fault. Mocks chỉ test parsing/network, không chứng minh transaction/RLS.
- d: POM theo page/component hành vi; locator role/name/testid ổn định; SSR dùng dữ liệu test server thật. Không dùng browser route mock để giả SSR. Auth fixture cho admin/staff/kitchen/inactive/guest.
- e: assertion kiểm outcome DB/UI và error state; không chấp nhận sign-in|admin hoặc HTTP500 là pass; test takeaway thực tạo→pay fixture→receive, local persistence qua thao tác thật.
- f: typecheck cả test bằng tsconfig riêng; chạy build, unit+coverage, integration, Playwright trong CI. Kiểm script lint phù hợp installed Next thay vì giả định `next lint` chạy được.

Mục tiêu đề xuất: module tiền/quyền/state/idempotency ≥90% branch; phần source
liên quan sửa ≥80% line; bắt buộc đầy đủ kịch bản bảo mật/concurrency dù coverage
đạt. Đo baseline rồi ghi gap; không tuyên bố % hiện có. Không phải mọi JSX phải
unit test snapshot; ưu tiên hành vi và integration quan trọng.

## 6. Backlog UX — đưa toàn bộ 16 task vào kế hoạch chung

Chi tiết file scope, copy, từng bước, layout và acceptance tiếp tục dùng
`UX_UPDATE_IMPLEMENTATION_PLAN.md` mục 3–9. Tất cả task dưới đây nằm trong
scope master, không phải gợi ý tùy chọn. Mỗi task phải chạy test riêng và có
visual evidence nếu thay màn hình.

- **TASK-UX-00** baseline/spec: hợp nhất M-00/01, không làm duplicate.
- **TASK-UX-01** CustomerShell, typography, safe area, accessible dialog. Phụ thuộc M-01. 48×48 controls, 16px nội dung/input, focus/Escape/return focus, theme giữ nhận diện. Preview không dùng DB thật.
- **TASK-UX-02** stable cart lineId, note update theo dòng, persist migration, tách scope dine-in/takeaway. Phụ thuộc M-02. Không dùng note làm React key; giỏ cũ hydrate an toàn, không mất focus.
- **TASK-UX-03** status mapper production/pure tests. Phụ thuộc M-01/02. Không ACTIVE/CASH/REQUEST_BILL/localStorage trong copy khách, không hứa “đang bưng” từ READY.
- **TASK-UX-04** MenuCatalog/Card, tên đầy đủ, search/category/empty/error/soldout. Phụ thuộc UX-01/02/03; dữ liệu M-02/14. Không đoán đơn vị/khẩu phần hay “bán chạy”.
- **TASK-UX-05** dine-in menu/cart/review/send. Phụ thuộc UX-04 + M-06. Ba tab, cart đang chọn tách món cả bàn, submit pending, PRICE_CHANGED, operation recovery, không mất giỏ khi lỗi.
- **TASK-UX-06** món đã gọi/queue/trạng thái. Phụ thuộc UX-05 + M-11/12. Queue riêng an toàn; thời gian tham khảo không countdown giả; cancelled reason chỉ dữ liệu được phép.
- **TASK-UX-07** bill panel/confirm khóa cả bàn. Phụ thuộc UX-06 + M-08. Tổng chuẩn trước chia tiền; unsent cart lựa chọn rõ; clear sau thành công; REQUEST_BILL khóa mọi máy, CLOSED vô hiệu QR.
- **TASK-UX-08** takeaway review/form/store config. Phụ thuộc UX-04 + M-09/10. Địa chỉ, liên hệ và hướng dẫn nhận đã xác minh; thiếu bank bắt buộc thì disable checkout; tên/SĐT validation có label và lỗi dễ hiểu.
- **TASK-UX-09** thanh toán cùng điện thoại/recovery. Phụ thuộc UX-08 + M-10/12. Lưu QR hoặc mở ảnh fallback, copy từng thông tin await clipboard; focus/visibility refresh; trạng thái chưa xác nhận không khuyên chuyển lại. Manual check cooldown 5s; fallback poll 15s backoff tối đa60s chỉ khi visible, cleanup/abort/dedupe.
- **TASK-UX-10** tracking cả đơn/history được bảo vệ. Phụ thuộc UX-09 + M-02/10. Chỉ mời nhận khi mọi món hợp lệ READY/SERVED và ít nhất một dòng quantity>0; CLOSED là hoàn tất; REVIEW_REQUIRED cần quán xác nhận. Không mở tra cứu dữ liệu bằng SĐT đơn thuần.
- **TASK-UX-11** offline/realtime error/unknown request result. Phụ thuộc UX-05…10 + M-05/12. Giữ giỏ, tự đối soát đọc, không tự POST với key mới; phân biệt empty/error/stale. Không optimistic paid/served.
- **TASK-UX-12** homepage customer-first. Phụ thuộc UX-01/08 + M-03. Đặt mang về chính, đăng nhập nhân viên phụ, QR đi thẳng đúng bàn; không sửa quyền để tiện demo.
- **TASK-UX-13** staff ưu tiên món cần mang→bill→bàn, pending theo item/action, hỗ trợ bàn khác theo quyền. Phụ thuộc M-07/08/11/12 + UX-01. Return/transfer xác nhận rõ, 48px, không mất filter sau refresh.
- **TASK-UX-14** KDS batch/FIFO, notes mỗi phần, pending/conflict, WakeLock/audio feedback. Phụ thuộc M-11/12. Không gom làm mất ghi chú, không báo batch thành công một phần.
- **TASK-UX-15** regression/accessibility/usability. Phụ thuộc toàn UX + M-15. Kiểm 360/390/430px, tablet landscape, zoom200%, keyboard/screen reader/reduced motion; đo contrast thực, không suy từ CSS. Thử 5–8 khách mức quen công nghệ khác nhau khi có điều kiện, ghi lỗi/cần trợ giúp; chưa có test người thật thì ghi chưa thực hiện.

Thông tin quán thiếu chỉ chặn nghiệm thu checkout thực, không chặn xây component.
Mock fixture chỉ ở test/story harness riêng, không ship fallback giả trong src.
Không lấy hình preview làm bằng chứng backend, không lấy unit test làm bằng
chứng accessibility đã quan sát trên thiết bị.

## 7. Lộ trình giao cho model nhỏ

### Milestone 0 — Chốt nguồn và thiết kế có thể triển khai

M-00 → M-01 → M-02; bắt đầu M-15a harness. Đầu ra: spec amendment, contracts,
query inventory, progress và test environment. Reviewer xác nhận không còn
quyết định schema/auth/payment chưa chốt cho task kế tiếp.

### Milestone 1 — Foundation an toàn

M-03 → M-04 → M-05. Gate G1: fail closed, không public DB/RPC exposure,
idempotency và rate limit DB integration pass. Chỉ preview/test environment;
không đưa phiên bản đang thiếu các API chuyển đổi lên production.

### Milestone 2 — Luồng giao dịch đầy đủ

M-06 → M-07 → M-08 → M-09 → M-10 → M-11. Gate G2: bill/kho/payment/roles
đúng khi race và retry, không unpaid queue. M-09 có thể chuẩn bị parsing/test
độc lập sớm, nhưng không bỏ dependency lúc nghiệm thu.

### Milestone 3 — Vận hành và dữ liệu

M-12 → M-13 → M-14; M-15b/c hoàn thiện theo từng module. Gate G3: push/PWA,
realtime/menu86ing, KPI/filter, ảnh, config/seed và admin CRUD pass.

### Milestone 4 — Trải nghiệm khách và nội bộ

UX-01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14.
UI primitive/cart có thể làm sớm sau contracts, nhưng không đánh dấu luồng hoàn
thành trước backend. Review mẫu menu/giỏ tại UX-04 và toàn hành trình tại
UX-07/10, tránh làm hết rồi mới phát hiện thiết kế khó dùng.

### Milestone 5 — Release candidate và vận hành thử

M-15d/e/f + UX-15 → M-16 (dưới đây). Gate G4: test suite thực, visual evidence,
review độc lập và rehearsal. Không tự deploy khi duyệt plan.

### M-16 — Đối soát, migration rehearsal và runbook [release blocker]

Phụ thuộc: tất cả tasks liên quan DONE, quyết định hạ tầng/thanh toán đã chốt.
Files: release checklist/runbook, test fixtures, migration validation; thay
code chỉ khi có bug mới được ghi thành task.

- Reconcile dữ liệu cũ read-only: active sessions trùng bàn, bảng current_session lệch, bill khác sum, âm kho, thiếu timestamps, payment không khớp. Xuất báo cáo không có PII; không tự “sửa lịch sử” bằng suy đoán.
- Backup/restore trên test DB; migration upgrade schema hiện có và bootstrap mới; test forward-fix/rollback tương thích. Không rollback bằng DROP dữ liệu giao dịch.
- Cutover có cửa sổ kiểm soát gọi món: deploy schema additive/RPC rồi app tương thích, kiểm tra traffic cũ, khóa public grants theo thứ tự runbook; không để client cũ tiếp tục ghi bất an. Nếu cần maintenance ngắn ghi rõ trước rollout.
- Thực hiện ca diễn tập: nhiều bàn gọi cùng lúc, 2 máy một bàn, kitchen nhận/gom, staff bưng hộ, trả bia, chuyển bàn, cash/QR, takeaway, mạng chập chờn.
- Quan sát request latency/query count/realtime connections/worker lag và quota trên hạ tầng thực; budgets cụ thể đặt theo lượng bàn/thiết bị được quán xác nhận, không bịa benchmark.
- Log correlation operation/event ID, redact token/SĐT/secret; cảnh báo payment REVIEW_REQUIRED, outbox fail, bất biến kho/bill vi phạm.
- Runbook quán: mất mạng không gửi lại mù, tiền nhận nhưng đơn chưa kích hoạt, push bị từ chối, admin nghỉ/đổi nhân sự, khôi phục backup, hỗ trợ khách chuyển khoản nhầm.
- Chốt dữ liệu quán thật, bank/provider, admin bootstrap, scheduled jobs, HTTPS và service worker trên domain staging.

Nghiệm thu: checklist ký review với evidence mới, không còn P0/P1 mở; vấn đề
P2 còn lại phải được người dùng chấp nhận cụ thể, không gộp “known issues”.
Deploy production là hành động riêng sau khi có release candidate reviewable.

## 8. Truy vết toàn bộ phát hiện cũ và mới

### Critical audit

- AUD-01 default admin/role conflict/inactive → M-01/03/15; negative auth tests.
- AUD-02 DB/RLS/client writes/forged snapshots → M-02/04/05/06/14/15; direct DB/API tests và query inventory.
- AUD-03 unsigned payment fields/replay → M-09/10/15; signed retarget + provider transaction uniqueness.
- AUD-04 partial payment commit/requeue → M-05/10/11; fault/retry/concurrency.
- AUD-05 truncated bill/stale total → M-06/08/13; >500 items + simultaneous additions.
- AUD-06 lost stock/log mismatch → M-06/07/10; conservation invariant + simultaneous sale/return.
- AUD-07 stale status/privilege race → M-11; state matrix và CAS tại DB.
- AUD-08 push/audio/SW/in-memory delay → M-12/16; worker/device/fallback evidence.
- AUD-09 fake receiving account → M-09/14 + UX-08/09; config fail closed.

### Warnings audit — cấp ID để không bị mất trong backlog

- W-01 unpaid queue realtime customer → M-10/12, UX-06.
- W-02 thiếu menu86ing publication/delivery → M-12, UX-04.
- W-03 stale sessionMap KDS → M-12, UX-14.
- W-04 open/transfer/close nhiều request → M-08.
- W-05 peakHours không đổi theo range → M-13.
- W-06 query lỗi thành KPI zero → M-13, UX-11.
- W-07 rate limit chỉ client → M-05.
- W-08 updateNote nhiều dòng, key đổi mất focus → UX-02/05, M-15.
- W-09 36px controls → UX-01/04/05/13/14/15.
- W-10 ảnh đúng80KB lọt kiểm tra → M-14.
- W-11 thiếu SW/icons → M-12.
- W-12 seed reset/demo token/tổng VIP sai → M-14/16.
- W-13 service-role fallback anon → M-03/14.
- W-14 ép kiểu payload không validation → M-02/05/09/14.

### Chất lượng test audit

- TEST-01 thiếu coverage-v8/include quá hẹp → M-15b.
- TEST-02 business_rules copy logic → M-15a và unit của M-05…11.
- TEST-03 test bị loại khỏi typecheck → M-15f.
- TEST-04 thiếu auth/RLS/race/failure/replay → M-03…11 + M-15c.
- TEST-05 POM assertion sign-in|admin/500/no checkout thật → M-15d/e.
- TEST-06 SSR mock không tác dụng/fixture cột sai/locator cũ → M-15a/d.
- TEST-07 localStorage tự set/get, không hành vi thật → UX-02/09/10 + M-15e.

### Review UX mới

- REVIEW-UX-01 ngôn ngữ khách/trang chủ → UX-03/12.
- REVIEW-UX-02 tên/giá/chữ/CTA món → UX-01/04.
- REVIEW-UX-03 giỏ local vs cả bàn, note/focus/retry → UX-02/05, M-05/06.
- REVIEW-UX-04 hứa ETA/trạng thái vượt bằng chứng → UX-03/06/10, M-01/12.
- REVIEW-UX-05 bill hierarchy/khóa bàn/giỏ chưa gửi → UX-07, M-08.
- REVIEW-UX-06 same-phone QR/copy/recovery/đơn khác → UX-08/09, M-09/10.
- REVIEW-UX-07 trạng thái cả đơn/địa chỉ/closed → UX-08/10, M-10.
- REVIEW-UX-08 offline/error/expired token → UX-11, M-05/12.
- REVIEW-UX-09 dialog/focus/target/labels/zoom → UX-01/04/15.
- REVIEW-OPS-01 staff ưu tiên việc thật → UX-13, M-08/11/12.
- REVIEW-OPS-02 batch không mất ghi chú → UX-14, M-11.

### Những điểm đúng phải giữ và kiểm thử hồi quy

- Schema/type alignment, không explicit any → M-04/15, toàn bộ query inventory.
- Server initial fetch/await params → M-02/14, build/typecheck.
- Snapshot giá/cost và KPI timestamp → M-06/10/11/13, chuyển authority sang DB.
- Cleanup cả năm channel, WakeLock visibility → M-12, UX-14/15.
- Năm KPI views, không aggregate frontend → M-13.
- Dine-in no-login, dynamic QR, batch/FIFO → UX-05/14 + M-08/11/12.

### Rủi ro tích hợp cần giải quyết, không trình bày như lỗi đã tái hiện

- NEW-01 retry takeaway create mất capability → M-02/05/10, UX-09.
- NEW-02 payment đến khi không đủ tồn/overpay/double payment → M-01/10/16.
- NEW-03 full return vs positive quantity/admin-only cancel → M-01/07/13.
- NEW-04 JWT/channel privacy/role revocation/cache → M-02/04/12.
- NEW-05 created_at bị dùng cho cả đặt đơn và queue/payment → M-01/10/13.
- NEW-06 migration khóa grants làm hỏng client cũ → M-04/14/16.
- NEW-07 food-unit mapping chưa có recipe → M-01/07/14.

## 9. Bộ kiểm thử nghiệm thu xuyên luồng

Ngoài từng task, release candidate phải chạy ít nhất các tình huống sau với
DB test thật; UI tests không được thay thế database evidence.

1. **SEC-01:** anon trực tiếp Supabase không đọc staff/cost/PII/KPI và không ghi bảng/RPC.
2. **SEC-02:** new signup/inactive/unknown role không vào protected page hoặc mutate qua API.
3. **SEC-03:** staff không hủy COOKING/READY/SERVED kể cả replay request từ trang cũ.
4. **SEC-04:** session A không đọc/ghi/subscribe session B; token CLOSED không dùng lại.
5. **SEC-05:** user không tự đổi role/subscription người khác; secret không xuất client bundle/log.
6. **ORD-01:** 2 khách gọi cùng bàn, tổng đủ và giá snapshot đúng; request thứ ba vượt 2/10s bị chặn.
7. **ORD-02:** request bill đua add; một trật tự commit hợp lệ, không item mới sau lock.
8. **ORD-03:** timeout sau commit rồi reload/retry cùng key chỉ một lượt món/log.
9. **INV-01:** stock1 hai đơn gọi, chỉ một thành công; stock/log cân bằng.
10. **INV-02:** partial/full return, replay và concurrent return, total đúng/không mất audit.
11. **PAY-01:** signed data bị gắn payment_code top-level khác không retarget.
12. **PAY-02:** PENDING_PAYMENT không xuất hiện trong queue/staff ready/push/KPI sold.
13. **PAY-03:** callback lặp và crash giữa bước; chỉ một receipt applied, một export, không reset kitchen state.
14. **PAY-04:** nhận tiền thiếu tồn/sai amount/phiên cũ; admin thấy review và khách không bị nhắc trả lại.
15. **PAY-05:** tạo takeaway commit nhưng mất response; recovery scope lấy đúng đơn, không tạo đơn hai.
16. **TAB-01:** double-open/transfer/close/callback cũ không tạo hai phiên hoặc giải phóng sai bàn.
17. **KDS-01:** batch khác ghi chú, race cancel/start/complete, timestamps và served actor đúng.
18. **NOT-01:** bar READY/meal complete target staff, fallback zone sau mốc, serve sớm không gửi fallback.
19. **NOT-02:** worker restart, subscription expired, reconnect/mount cleanup, WakeLock visibility.
20. **KPI-01:** fixture xuyên kỳ/ngày, return/cancel/pricechange, 5 aggregates và range đúng; error không bằng zero.
21. **UX-AC-01:** món tên dài, sửa note không mất focus, cart local khác ordered shared, CTA48px.
22. **UX-AC-02:** bill confirm/unsent cart, bàn đóng, QR invalid, soldout khi đang chọn.
23. **UX-AC-03:** same-phone payment copy/saveQR, switch app/reload, whole-order-ready/history scope.
24. **UX-AC-04:** offline trước gửi, mất response sau gửi, realtime stale, retry không nhân đôi.
25. **UX-AC-05:** mobile/tablet, keyboard/SR, zoom200%, contrast thực, safe area/bàn phím ảo.

Lệnh baseline/thường dùng sau triển khai:

```text
npx tsc --noEmit
npm run test:unit
npx vitest run --coverage
npm run build
npm run test:e2e
```

M-15 bổ sung script integration và typecheck:test với tên chính thức trong
package.json; không ghi chúng đã chạy trước khi có script. CI chạy cùng lockfile.
Log phải ghi exit code, số tests, fail/skip, môi trường và thời điểm; test bị
skip vì thiếu config không được tính PASS. Không tái sử dụng HTML report cũ.

## 10. Definition of Done và cổng phát hành

Task DONE khi đồng thời có code/diff đúng scope, acceptance pass, test thực
chạy, bằng chứng DB hoặc visual phù hợp, spec/types/docs đồng bộ và reviewer
PASS. Phần thiếu hạ tầng/dữ liệu/browser là BLOCKED hoặc PARTIAL, không DONE.

- **G1 Foundation:** M-03/04/05 pass; không default admin, không public DB writes/PII, RLS/RPC permissions và replay/rate-limit có bằng chứng.
- **G2 Business:** M-06…11 pass; bill/kho/đơn/payment nguyên tử, không unpaid bếp, quyền hủy và timestamps đúng.
- **G3 Operations:** M-12…14 pass; realtime/push/SW/audio, báo hết, KPI filter, ảnh/seed/config/admin CRUD đạt.
- **G4 UX/Test:** UX-01…15 và M-15 pass; E2E theo role/guest, accessibility/thiết bị, scope bảo mật history.
- **G5 Release:** M-16 pass; dữ liệu đối soát, migration rehearsal, runbook và cấu hình quán/provider có thật; người dùng quyết định phát hành riêng.

Đối chiếu Phase gốc: Phase1=G1; Phase2=M-07/14; Phase3=M-06/07/08+UX tại bàn/staff;
Phase4=M-11/12+UX KDS; Phase5=M-09/10/13+UX mang về. Chỉ khi đủ G1…G5 mới
đề nghị vận hành thực. Các phase hiện tại chưa được đổi thành “đạt” bởi tài liệu này.

## 11. Handoff và theo dõi

Giao mỗi lượt **một task hoặc một phần a/b/c**. Model nhỏ không được tự rút gọn
acceptance, bỏ integration test hoặc mở quyền để làm UI chạy. Hạng mục tiền,
RBAC/RLS, migrations và webhook phải có review độc lập trước DONE.

Progress file đề nghị `docs/MASTER_IMPLEMENTATION_PROGRESS.md` được tạo ở M-00,
mỗi record có: ID, finding IDs, dependency, trạng thái TODO/IN_PROGRESS/PARTIAL/
BLOCKED/REVIEW/DONE, files, test command+exit/log, visual/DB evidence, reviewer,
remaining risk, next allowed task. Không sửa report audit lịch sử.

Thông tin cần trước các task phụ thuộc (không cần cung cấp secret trong chat):

- Chủ quán duyệt A-01…06 và amendment M-01; nhất là return toàn bộ, stock khi nhận tiền, queue timestamp.
- Provider và chế độ webhook, receiving account thật, môi trường test riêng (M-09/10).
- Domain/deployment/scheduler và thiết bị mục tiêu (M-02/12/16).
- Tên quán, địa chỉ nhận, SĐT hỗ trợ, giờ phục vụ hiển thị, ngân hàng đã xác minh (UX-08/09).
- Số bàn/thiết bị giờ cao điểm, nhân sự test và người duyệt nghiệm thu (M-15/16).

Không cần đưa số ngày cố định khi chưa đo tốc độ triển khai và chưa chốt các
điểm trên. Tiến độ đo bằng milestone và gate có bằng chứng, không bằng số file
đã sửa hoặc tỷ lệ checklist được tích thủ công.
