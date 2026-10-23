# Implementation contracts — các phần đã triển khai

2026-10-22. Auth/staff/order/operation của M-02, chưa phải contracts toàn bộ master plan.
Các amendment trong PRD_SPEC quy định phạm vi; không suy ra RLS/payment hoặc
các endpoint còn lại đã được triển khai.

## Identity boundary

`getCurrentStaffAccess()` trong `src/lib/supabase/sync-staff.ts` chỉ đọc:

- Clerk `auth().userId`, không dùng metadata role.
- Service-role query `staff_profiles.select('id, role, is_active').eq('id', userId).maybeSingle()`.
- Authorized: `{ status: 'authorized', staff: { userId, role, isActive: true } }`.
- Không login: unauthenticated. Không profile/invalid role/inactive: forbidden.
- Lỗi Clerk/DB/config: unavailable. Không trả identity trong trường hợp denied.
- Không insert/upsert, không fallback admin, không cache qua request.

## Page guard

`requireStaffPage(allowedRoles)` phải chạy trước data client của từng page.
Admin: `['admin']`; staff: `['staff','admin']`; kitchen: `['kitchen','admin']`.
Sai role chuyển về home từ role DB, không metadata. Unauthenticated tới
sign-in; forbidden tới access-denied; unavailable tới access-denied với reason.
Trang từ chối không trả dữ liệu nội bộ; redirect page không phải HTTP403 API.

## API guard

`requireStaffApi(allowedRoles)` trả `{ staff, response: null }` khi allowed,
hoặc `{ staff: null, response }` với 401/403/503 và JSON error
`{ code, message, retryable }`. Mọi handler phải return denied response trước
parse hoặc business query. Chỉ unavailable là retryable.

Push subscribe: staff/admin active, chỉ user ID hiện tại; body staffId khác
bị 403. Notify: active staff/kitchen/admin tạm thời; quyền gửi nội bộ bền vững
và outbox vẫn là M-12, chưa được hoàn thành bởi guard này.

## Config và rollout

Service-role module được đánh dấu server-only. Thiếu/blank service-role key
là lỗi cấu hình ngay cả khi có anon key. Không log nội dung key.

Nếu user trước đây chỉ có metadata role nhưng chưa có hồ sơ DB, sau thay đổi
sẽ bị chặn theo chủ đích. Không tự dùng metadata để khôi phục quyền. Người
vận hành provision hồ sơ được xác minh theo runbook bootstrap.

Batch02 đã chuyển staff mutations sang API/RPC; batch03/04 có private ledger/
outbox RLS, chưa bảo vệ toàn bộ base tables. G1 chưa đạt.

## Admin staff POST — B02

`POST /api/admin/staff`: admin active, cùng Origin, JSON≤8192 bytes thực.
Body `{ action, profile, expected }`: strict field allowlist theo spec amendment;
create expected=null, update expected là snapshot 5 trường trước sửa. Unknown
actor/subscription/extra fields bị từ chối. Tạo mới phải xác minh user Clerk
tồn tại, không banned/locked; Clerk lỗi thì không ghi DB.

RPC `fn_admin_save_staff(actor, profile, expected)`: service_role-only;
SHARE ROW EXCLUSIVE khóa bảng staff_profiles cho transaction quản trị ngắn,
kiểm lại actor active admin và giữ ít nhất một admin active. Subscription
không thuộc snapshot và không bị ghi đè. SQLSTATE: 42501→403, P0002→404,
23505/40001/P0001→409, 23503/22023→400; lỗi khác→503, không lộ raw SQL.

Migration `202610220001_admin_staff.sql` thu hồi cả table/column write grants
của PUBLIC/anon/authenticated. Chưa enable toàn bộ RLS hoặc thu hồi read trong
batch này vì các màn còn dùng reads cũ. Không áp migration ở production tự động.
Không claim retry idempotent bền vững trước M-05; client không tự POST lại khi
mất mạng, hướng dẫn tải lại để đối soát.

Test DB: `npm run test:integration:staff`, dùng PostgreSQL local qua
POSTGRES_BIN (mặc định PostgreSQL17 trên Windows); không nhận connection URL,
khởi tạo cluster tạm loopback và tự dừng/dọn. Không cần DB app hoặc secret.

## Operation ledger — M-05a / B03

Migration `202610220002_operation_ledger.sql` + Database private types theo
amendment mục12 của spec. Không có endpoint operation công khai trong batch này.
Hai private helpers chỉ được gọi bên trong RPC nghiệp vụ có xác thực; service
role không được gọi helpers hoặc đọc ledger trực tiếp. DTO kết quả không secret.

Wrapper phải: xác thực và khóa session theo lock order → begin_operation → nếu
replay trả result → nếu mới thực hiện nghiệp vụ → complete_operation → commit.
Cả chuỗi là **một RPC/transaction**, không hai lần gọi HTTP. Input được validate/
normalize trước hash JSONB (đặc biệt quantity integer và note); scope do server
suy ra, không lấy trực tiếp từ browser. Retry dùng cùng key và body đã normalize.

SQLSTATE: 22000 key/content conflict hoặc cố đổi result; 22023 invalid bounds;
55000 claim lặp chưa complete trong cùng transaction; 23514 commit claim dở;
P0002 complete chưa claim. SQL errors rollback business và ledger cùng nhau.
Deferred trigger chạy SECURITY DEFINER, fixed search_path và không public execute,
để kiểm tra được dữ liệu private khi caller service_role commit sau RPC.

Test `npm run test:integration:operations`: dùng fixture transaction SQL riêng
để chứng minh helper atomicity/concurrency; **chưa** chứng minh quyền capability,
rate limit, payment replay hoặc các luồng đặt món hiện tại đã dùng ledger.
Batch04 đã dùng ledger trong order tại bàn/gọi hộ; payment/takeaway vẫn M-10.
Retention chưa tự chạy, phải chốt trước release. Result limit hiện là64KiB từ
migration0003, thay cho16KiB ban đầu; request tối đa32KiB.

## Dine-in order/recovery — B04

Chi tiết fields/RPC/auth/error nằm ở amendment dine-in transaction trong spec;
code contract chung: `src/lib/orders/contracts.ts`, server: `route-handlers.ts`,
browser journal: `client.ts`. Hai nhóm `/api/customer/{orders,operation}` và
`/api/staff/{orders,operation}` gọi cùng transaction engine, khác identity boundary.

Rate quota2/10s được kiểm dưới session lock và chung khách/staff; replay trả
result cũ không trừ kho hoặc quota thêm. Snapshot/cost/station/menu availability
chỉ lấy DB. Export stock/log, items, total, ledger và outbox commit cùng RPC.
DTO không cost/actor IDs. Giá khác quote → rollback, người gọi xem lại giá mới.
FOOD linked kg không được tự trừ1:1; phải sửa mapping được xác minh trước dùng.

Client lưu journal trước POST, giữ cả operationId và payload khi mạng/5xx lỗi.
Retry hỏi GET đã được bảo vệ trước; null mới POST lại cùng key. Timeout15s,
cleanup timer; không auto retry hoặc tạo key mới. Giỏ khóa khi kết quả chưa rõ;
cart+acceptedOperationIds persist trong một Zustand update trước acknowledge
journal, tránh trừ giỏ hai lần khi reload giữa bước xác nhận. Không ghi lùi
state đã biết từ realtime khi nhận lại result ban đầu.

Outbox trong batch này mới ghi sự kiện, **chưa có worker gửi push**. Return/
cancel/checkout và takeover payment còn caller cũ; chưa an toàn để rollout
riêng batch. Thứ tự staging: review/apply0001→0002→0003 rồi app tương ứng;
không mở quyền RPC public để né lỗi thiếu migration. Không áp DB thật tự động.

Test DB: `npm run test:integration:orders`. Test UI dùng React/jsdom và API
network mock; test DB dùng PostgreSQL thật riêng. Chưa E2E Clerk/Supabase
deployment, visual/touch thật hoặc đo coverage.

## Manual inventory — B05 / M-07a

Spec§12.5 là contract chi tiết; `src/lib/inventory/contracts.ts` kiểm DTO chung.
POST `/api/admin/inventory` nhận `{operationId,input}`, input đúng5fields:
ingredientId/type/quantity/unitCost/note. IMPORT nhận giá nhập; WASTAGE gửi
unitCost:null và lý do, DB lấy giá vốn hiện tại. Chỉ admin active; actor từ guard
và kiểm lại DB. GET chỉ operationId, scope actor do DB suy ra; no-store.

Migration0004: record/get RPC service-only dùng ledger, khóa chung operation
cho POST/GET rồi ingredient FOR UPDATE. Stock/log/cost/ledger cùng commit;
giá nhập0 có hiệu lực, thiếu tồn không clamp, dữ liệu kho bất hợp lệ bị chặn.
Replay trả result tối thiểu bất biến, không trả snapshot tồn để UI ghi lùi.
400 INVALID_INVENTORY,404 INGREDIENT_NOT_FOUND,409 OUT_OF_STOCK/INVENTORY_INVALID
là lỗi business rollback; OPERATION_CONFLICT/403/5xx/network giữ journal để
đối soát, không tự cấp key mới. JSON lỗi không chứa SQL/detail nội bộ.

Client journal theo actor lưu trước POST; pending thì GET trước, null mới POST
cùng payload/key. Timeout15s gồm đọc body; không auto retry. UI dùng ref chặn
double-submit, khóa form pending, có nút đối soát ngoài modal khi mất mạng;
xác nhận xong refresh dữ liệu hiện tại thay vì cộng tồn local từ result cũ.
Không có override tồn/giá vốn trong form danh mục, không manual sale/return.

Giới hạn: metadata ingredient còn browser writes (M-14); staff return/takeaway
và base-table grants vẫn caller/chính sách cũ (M-07b/M-10/M-04), không rollout
riêng0004 để coi là bảo mật xong. Multi-tab và Clerk/Supabase E2E chưa kiểm chứng.

## Beer return — B06 / M-07b

Spec§12.6 và `src/lib/returns/contracts.ts` định nghĩa POST/GET /api/staff/returns.
Staff/admin active, DB kiểm lại actor, session/item lock và expectedQuantity;
confirmedUnused=true bắt buộc. Giá vốn lấy order snapshot, ingredient theo FK
stock_export_log_id tới export gốc; thay mapping/cost hiện tại không làm trả
sai kho/giá. Dòng cũ thiếu FK phải đối soát, không backfill theo tên/menu.

Quantity0 giữ status/timestamps, không generic cancel. Kho/log/bill/outbox/ledger
cùng commit. Staff replay/lookup CLOSED được đối soát kết quả cũ, không tạo return
mới; auth vẫn kiểm hiện tại. Browser không update item/stock/total trong return,
không dùng result replay ghi lùi state; refresh staff SSR đã guard sau xác nhận.
Pending journal theo actor, lưu trước POST, GET trước retry; lỗi unknown giữ key,
khóa thao tác và có nút recovery ngoài modal. OUT_OF_STOCK không phải return
error; RETURN_CHANGED/NOT_ALLOWED/PROVENANCE_MISSING phải kiểm lại trước lượt mới.

Migration0005 thay order RPC để lưu export provenance và sửa peak/kitchen/staff
KPI bỏ quantity0 (cả views/RPC). Các call sites serve/cancel/close/takeaway/base
grants còn task khác. M-07 code local không đồng nghĩa an toàn rollout riêng.

## Session lifecycle/full bill — B07 / M-08

Spec§12.7 và `src/lib/sessions/contracts.ts` là contract cho OPEN/TRANSFER/
HANDOVER/REQUEST_BILL/CLOSE. Staff sessions POST/GET, guest customer/bill POST/
GET (capability header); actor từ guard và DB role/active. GET lookup cùng lock
operation, replay không tạo lần mở bàn/thu tiền mới. OPEN result/ledger không
lưu session token; UI refresh staff page lấy QR hiện tại. Chuyển bàn giữ token
và người phụ trách, thay người phải HANDOVER có expected assignment.

CLOSE yêu cầu confirmedReceived + expectedTotal; DB tính full bill, chặn món
chưa xử lý và pointer bàn không khớp. BILL_CHANGED trả quote hữu hạn, client
bỏ confirmation cũ và yêu cầu xem lại/click mới. Không giả đây là xác minh
webhook. Provider chưa chốt nên không bật/hoàn tất payment integration.

Full detail GET /api/staff/bill → fn_get_session_bill chỉ staff/admin. Một
session aggregate và mọi item DTO không cost/actor/provenance, không bị Data
API row limit vì RPC trả JSON aggregate. Quantity0 được giữ trong lịch sử;
order submit result vẫn không chấp nhận quantity0. CLOSED stored total lệch
chi tiết bị chặn đối soát; API đọc không sửa bill/paid revenue.

Hook useSessionBill không dùng response sai phiên, abort khi đổi selection/
unmount, timeout15s gồm đọc body; lỗi không trở thành bill0. Staff/admin cập
nhật detail từ read API và không in/chốt khi chưa tải xong. Auto print sau
close bị bỏ để tránh in DOM cũ; sau refresh có thể in lại bill đầy đủ. List
tổng vẫn cần phân trang, Realtime raw và serve/cancel còn M-12/M-11/M-04.

## Item transitions — B08 / M-11

Spec§12.8, `src/lib/item-actions/contracts.ts` và migration0008 định nghĩa
POST/GET /api/staff/item-actions. START/READY kitchen/admin, SERVE staff/admin,
CANCEL staff chỉ QUEUED hoặc admin với reason. Expected status/quantity/IDs
kiểm DB dưới session/item locks; mọi dòng phải đúng, không nhận một phần mẻ.
Batch ID, timestamps và served actor do DB lấy, không nhận từ body. Snapshot,
note và created_at không đổi. Closed/unpaid/quantity0 không được transition mới.

Ledger theo actor, sorted item IDs và reason trim tạo fingerprint; replay không
reset timestamp/batch hoặc tạo event mới. Lookup/replay kiểm lại quyền hiện tại,
kể cả admin bị hạ quyền sau khi cancel món đã chuẩn bị. Result chỉ IDs và
from/to status, không đủ để ghi đè state hiện tại; client refresh SSR đã guard.
Unknown giữ journal, GET trước retry; ref khóa double-click, pending chặn thao
tác mới. Known business rollback mới bỏ key để người dùng kiểm tra và click mới.

CANCEL tính full bill SQL, giữ mốc trước hủy, không hoàn kho và không thêm
WASTAGE lần hai. M-13 còn phải đưa chi phí prepared-cancel vào KPI; chưa coi báo
cáo tài chính đã khắc phục. READY ghi ORDER_READY vào outbox, không push browser;
worker M-12 chưa có. Staff/admin/KDS không còn order/bill direct writes trong
các thao tác này; KDS 86ing còn menu write M-14 và raw realtime còn M-04/M-12.

## Menu metadata/86ing — B09 / M-14a

Spec§12.9, `src/lib/menu/contracts.ts`, migration0009: POST/GET staff/menu-actions
nhận actor từ guard. CREATE/UPDATE/DELETE chỉ admin; AVAILABILITY kitchen/admin.
Expected full9 fields cho editor/delete, narrow boolean cho86; không gửi actor,
stock, timestamps hoặc trạng thái order. Menu UUID mới và body lưu trong journal
trước POST. GET null mới được POST cùng body/key; role hiện tại kiểm cả replay.
Result chỉ operationId/action/menuItemId; luôn refresh SSR thay vì apply snapshot.

Row lock menu tương thích SHARE của order RPC: báo hết trước thì đơn mới bị chặn,
order commit trước thì giữ snapshot đã đặt. Metadata update không sửa kho/bill.
Món có history không xóa/đổi category/station/stock link; cập nhật giá không sửa
order snapshot. Menu table/column writes anon/authenticated đều bị revoke;
publication menu bổ sung cho86ing hiện hữu. Ảnh/storage và read RLS/private realtime
chưa thuộc batch này; không coi menu cost/metadata đã được phân vùng đọc an toàn.

## Admin metadata — B10 / M-14b

Spec§12.10, `src/lib/metadata/contracts.ts` và migration0010: admin metadata
POST/GET kiểm quyền hiện tại ở API và DB. Ingredient chỉ name/unit/min_threshold;
zone chỉ name; table chỉ table_number/zone_id. Không nhận stock/cost, assignment,
status/current_session_id hoặc created_at. CAS so metadata, không so tồn động;
sửa định mức đồng thời nhập hàng giữ cả hai kết quả. Tạo ingredient tồn/cost0,
tạo table AVAILABLE/current_session_id=null; DB sở hữu mọi giá trị này.

Unit đổi bị chặn khi tồn khác0, đã có phiếu hoặc menu mapping. Table edit/delete
bị chặn khi pointer/status hoặc live session cho thấy đang phục vụ. FK zone→table,
zone→staff và table→session dùng RESTRICT, kể cả caller đặc quyền không vô tình
cascade/xóa liên kết lịch sử. Xóa zone cần chuyển bàn/nhân sự; bàn có bill lịch sử
không xóa. Không thêm archive field hay suy diễn lại đơn vị hàng cũ.

Ledger scope metadata:<actor>, result tối thiểu chỉ identity/action/resource.
Journal lưu trước POST, GET đối soát, null mới retry cùng key/body; refresh SSR
không apply snapshot cũ. Hai màn hình Admin không còn direct DB mutations.
Thu hồi table/column writes ingredients/zones/tables; base read grants, ảnh/
storage, takeaway provider/transaction và private realtime vẫn task còn lại.

## Menu images — B11 / M-14c

Spec§12.11, migration0011 và `src/lib/menu-images/`: raw WebP POST admin/menu-images
kiểm guard/Origin/actual stream<81920; MIME+RIFF và sharp full decode, tĩnh≤1024px.
Sharp là dependency trực tiếp; metadata không thay việc decode pixels
([tài liệu Sharp](https://sharp.pixelplumbing.com/api-input/)). Browser chỉ nén
và gửi file; không Storage client/key/signed write. Exact81920 bị nén lại/reject.

UUID+actor+SHA256 định danh reservation, immutable path/upsert=false; object trùng
phải download đối chiếu hash trước READY. READY replay không upload lại. Registry
private/RLS không public grants, admin kiểm lại DB; quota30 reserve mới/giờ.
Menu trigger khóa registry và chỉ gắn URL READY; legacy giữ nguyên URL vẫn sửa
metadata được, URL tùy ý mới bị chặn. Role/bucket/pixel checks không dựa extension.

Upload khác transaction menu: giữ ảnh cũ khi upload lỗi; menu save lỗi/unknown
không xóa ảnh vừa tải. Admin cleanup claim≤20 orphan>24h, FOR UPDATE + check mọi
menu reference trước DELETING; trigger FOR SHARE tránh attach/race. Remove Storage
qua API rồi finish DELETED; failure còn DELETING để retry. Tombstone chặn revive,
late READY bị từ chối và remove bù. Không tự cleanup ảnh legacy hoặc object ngoài
registry. Storage thật/late failure reconciliation vẫn cần rehearsal M-16.

Bucket config81919/image-webp và restrictive write policies được kiểm bằng Storage
schema fixture có permissive legacy policy; không thay kiểm thử Supabase Storage
thật. Migration branch bỏ qua khi Storage schema không có; không tự áp DB app.

## Lists/seed/config — B12 / M-14d và M-08 list completion

Spec§12.12: bill/log server25+1, status/type DB trước range, timestamp+id ổn định;
REQUEST_BILL ưu tiên trước page slicing. Không load order history cho bill list;
detail vẫn full RPC và không dùng subtotal trang. URL giữ filter khi chuyển trang;
đổi tab/type về trang1. Search client ghi rõ chỉ trang hiện tại. Catalog paint25
sau filter, live/cached catalog fetch bằng keyset250 cho đến trang rỗng để không
dựa default Data API cap; max200 lượt, duplicate/cursor lỗi fail rõ. Staff/KDS
items inner join phiên ACTIVE/REQUEST_BILL, không mất việc do limit300 lịch sử.
Scan live không phải MVCC snapshot; private realtime/invalidation M-12 vẫn còn.

seed.sql no-op; demo/seed.sql chỉ DB trống suffix _demo + app.seed_mode=demo, lock
và từ chối chạy lại. Seed fixture total SQL từ items; không986k/978k lệch. Guard
được thử trên PostgreSQL tạm gồm target sai, thiếu flag, replay và tồn đã sửa.
Không chạy seed trên DB app. Nhân sự demo không phải Clerk provision thật.

Config public URL/key validation không in giá trị; private cron/push subject riêng.
Cron xác thực constant-time trước DB, cooldown60s/instance, limit1 không count;
thiếu secret503/sai401, SQL/config lỗi không lộ chi tiết. Global edge limiting và
rollout config thuộc M-16. Dashboard lỗi DB không trả số0 giả; analytics correctness
và filter tháng vẫn M-13. QR read projections/base RLS vẫn M-04, không tự coi an toàn.

Provider chưa chốt: giữ code legacy payment nhưng khóa entry takeaway/webhook bằng
onlinePaymentsEnabled=false, không bật từ env/credentials. Webhook unsigned luôn
bị từ chối; bỏ bank/account/merchant mẫu và VAPID subject giả. POM/E2E đổi kỳ vọng
sang thông báo chưa mở, chưa chạy browser thật. Không coi M-09/10 đã triển khai.

## Read boundaries — B13 / M-04

Spec§12.13 + migration0012: 8 bảng RLS/restrictive deny; revoke table/column
PUBLIC/anon/authenticated và legacy service grants; service chỉ SELECT và
UPDATE(push_subscription), mutations qua RPC. KPI views invoker; fn_* chỉ service.
Default privileges không mở bảng/functions mới; private tables/helpers giữ kín.

Guest fn_get_dine_in_snapshot chỉ DINE_IN ACTIVE/REQUEST_BILL, own display rows,
public menu và SQL queuePositions; không trả global rows/cost/stock/contact/actor.
SSR và GET customer/snapshot cùng parser projection; x-session-token, no-store,
404 capability không đọc được,503 config/DB/data lỗi; không giả expired/rỗng.
Middleware cho public endpoint này, không Clerk gate khách. Guarded SSR dùng
service; Staff/KDS DTO hẹp, admin không nhận push subscription secret. KPI filter
qua admin API; công thức/date/filter correctness vẫn M-13.

Public row subscriptions đã bỏ ở các luồng bật. Tạm refresh10s khách/15s nội bộ,
visible/online và cleanup; guest no-overlap/abort12s, giữ dữ liệu cũ + unavailable
khi lỗi,404 khóa UI. REQUEST_BILL đã thấy không bị snapshot trễ đổi về ACTIVE.
Âm thanh so sánh IDs mới từ snapshot có quyền; không thay private Broadcast/push.

Finite/nonnegative CHECK và dấu inventory logs, unique dine-in chưa CLOSED/bàn,
preflight duplicate/pointer/dirty data không tự sửa; full-return quantity0 hợp lệ.
EXPLAIN fixture cho bill/log paging và own-item index, queue dùng index hiện có.
DB thật kiểm anon/auth/service, permissive policy + legacy column grants; runbook
đòi rollout code+SQL cùng bảo trì. Chưa áp DB đích hoặc nghiệm thu realtime thật.

## Durable notifications — B14 / M-12b

Spec§12.14/migration0013: private outbox thêm lease_token/failed_at/outcome;
private receipts PK event+staff+subscription_hash. Owner RPC claim1/45s SKIP LOCKED,
prepare current targets, ack receipt/hash-CAS invalid/410 và finish retry/skip/sent.
Max8 attempts,10…300s backoff; crash lease reclaim, FAILED có admin list25/counters
và retry expectedAttempts, giữ receipts. Service không raw private/push UPDATE.
READY claim tạo fallback due ready_at+120s trước trả; bill-request enqueue cùng
transaction. Chỉ live/READY/unserved/qty>0; primary current active assignee, missing/
inactive→current zone; fallback chỉ current zone, không có zone không mở rộng shop.

POST cron/notifications Bearer NOTIFICATION_WORKER_SECRET riêng≥32 constant-time,
VAPID pair validate trước DB;≤5 jobs/8 targets/20s, mỗi job≤3 targets. Validate
legacy subscription/HTTPS provider/P-256/auth trước HTTP, fetch4500ms/no redirects;
generic payload/tag, không PII. Provider acceptance→receipt; failure safe code,
404 retry,410 hash-CAS. Không exactly-once khi crash sau provider trước receipt.
POST/DELETE subscribe same-origin/body bounds/current actor + DB role recheck;
DELETE expected endpoint. Manual notify410; không caller-chọn target/title/fallback.

Code/local tests M-06 order→outbox→worker đủ, chuyển REVIEW; không đồng nghĩa đã
gửi push thật. Scheduler≤30s và kiểm backlog/rehearsal đích M-16, M-12a/c private
realtime/PWA/audio/OS acceptance còn lại. Không bật scheduler hoặc áp DB app ở B14.

## Device notifications/audio/offline — B15 / M-12c

Spec§12.15: native root SW thay vì bật Serwist runtime cache mặc định; allowlist
static offline/icons/WAV, network-only navigation/SSR/QR, không can thiệp API/RSC/
mutation/remote. Offline generic không chứa session/user/menu và không gửi nền.
Push handler chỉ generic text + stable tag; click chỉ focus /staff hoặc mở /staff,
không tin URL payload/không điều hướng cart khách. PNG192/512/maskable/apple180 và
PCM WAV gốc từ SVG/recipe repo, bỏ16-byte MP3 giả. Không dựa artwork ngoài.

Staff button gọi permission trực tiếp trước await, subscribe sau active SW, POST
chỉ success khi server xác nhận. Một profile/một subscription, không auto-register
khi login. Local owner Clerk ID; account-version ngăn pending enable đổi user và
staffId body đối chiếu guard. Đổi account/sign-out unsubscribe/close notifications;
localStorage lỗi hiển thị hướng dẫn. Tắt local trước DB exact-endpoint CAS; lỗi DB
giữ endpoint trong memory để explicit retry, reload có thể cần provider410 cleanup.

Chuông off mỗi lần mở/đổi user, reusable audio unlock bằng gesture; denied playback
chuyển BLOCKED, auto events chỉ live READY/QUEUED theo role/assignment. WakeLock
single-flight, release hidden/unmount/late, reflect OS release/reacquire visible.
Chromium local fixture chứng minh cache/offline/assets; unit/component chứng minh
permission/account race/audio/wakelock. Không chứng minh push provider hoặc OS khóa
màn hình. Private realtime M-12a và staging/device acceptance vẫn chưa hoàn thành.

## Private invalidation — B16 / M-12a

Spec§12.16/SQL0014: POST customer/realtime-ticket header capability + Origin,
live DINE_IN ACTIVE/REQUEST_BILL; staff/realtime-ticket guard active DB role, không
nhận actor/topic body. ES256 imported EC P-256 key/kid riêng server, authenticated
role,120s TTL, random sub, app/scope/actor/topic claims; no-store response gồm
token/topic/actorId/expiresAt, chỉ memory. Mặc định feature off; không suy ra key
từ anon/service key và không auto-enable theo credentials.

Một dedicated client/channel per owner, scope session UUID hoặc current internal
role. await realtime.setAuth trước subscribe tránh first-join race thực tế SDK;
accessToken callback chỉ ticket còn hạn. Renew85…90s bằng fresh API guard/rejoin;
expiry/hide/offline/account/unmount abort/removeChannel/disconnect/clear handlers.
SDK disconnect hiện giữ timeout nội bộ10s dù socket đã đóng; test chứng minh tự
hết và không reconnect, không sửa node_modules. Retry backoff2…30s;401/403/404
ngừng retry tự động và recheck qua protected read. Không persist ticket/token mới.

RLS managed messages giới hạn receive broadcast cùng topic và claims/current DB,
restrictive chống legacy permissive, deny app publish/presence/update/delete.
Helper boolean public duy nhất authenticated gọi được; không grant base/business
RPC hoặc private helpers. Không ALTER managed RLS. Trigger fanout chỉ {v,id}
cho live dine-in sessions +3 internal roles, closure gửi former session, commit
atomic; realtime error không rollback sale. O(live sessions)/statement cần đo tải.

Invalidation không áp state trực tiếp, bounded100 UUID dedupe/debounce250ms;
refetch scoped DTO, dirty guest read chạy thêm một lượt sau read hiện tại. Guarded
polling10s/15s chỉ recovery. Local evidence: actual ES256 crypto, real installed
SDK with fixture peer, PostgreSQL restrictive policy/transaction tests; chưa là
Supabase key trust/cached permission/expiry acceptance. M-12 code local→REVIEW;
M-02 staging proof và M-16 rollout/device acceptance còn mở.

## KPI, UX and reconciliation — B17 / B18

Spec§12.17…19/SQL0015…16: five KPI views derive from the corresponding SQL
RPCs; every date filter updates all five projections. Calendar dates use
Asia/Ho_Chi_Minh, half-open [start,end). Revenue uses closed_at; sold/serving
uses served_at; prepared cancellation costs use snapshot cost once. Invalid or
missing timing samples are excluded, not replaced with zero-time performance.
Menu/staff aggregates page until empty; dependency errors reject the whole read.
SSR provides updatedAt; subsequent errors retain the last good charts and label
them stale. Takeaway activated_at is nullable without speculative backfill.

Public takeaway browsing uses a server-only safe menu projection, no stock/cost.
Shared menu/cart/dialog use scoped 16/14px text, 48px controls and immutable
client-only lineId. Persist v2 validates/migrates lines; takeaway/dine-in stores
are separate. Only confirmed order acknowledgment reduces a cart. Foreground
order recovery is GET-only; a missing result never silently posts. Explicit
retry can reuse the original journal after GET confirms no committed result.
HTTP5xx retains the journal even if the body contains a business rejection code;
only the allowlisted HTTP4xx rollback responses may release the identity.

Request-bill confirmation explains the whole table pauses ordering; unsent items
require an explicit choice and are cleared only after success. Progress groups
actionable work first, collapses served/cancelled history, and promises no fake
countdown. Takeaway browsing/recipient validation is available, while checkout
and webhook were disabled at B17/B18; B19 below supersedes the provider dependency.
Home/contact/receipt use the verified store
configuration, with no sample address/phone/bank. Cashier and Staff invalidate
received-payment confirmation when the session, amount or payment method changes.

GET /api/admin/data-health and /admin/release require current active admin;
fn_admin_data_health rechecks that actor and returns only counts/check codes.
No endpoint repairs history. Ledger/payment/outbox replay identities are not
automatically pruned. Admin staff SSR converts push_subscription to a boolean
has_push_subscription before serializing Client Component props; provider
endpoints/auth keys stay server-side. TypeScript structural compatibility alone
does not enforce this runtime projection; SSR behavior tests verify it.

Evidence: local PostgreSQL backup/restore and a 12-table/48-call replay rehearsal
exercise the production RPCs, including batch cooking, individual serving,
unused-beer returns and cash close. The Realtime peer records generic signals,
not managed delivery. Browser fixtures mount shipped components outside src;
they do not prove Clerk, Supabase Storage, payment or real-device acceptance.
Acceptance Playwright uses an explicitly isolated deployment, no SSR route mocks;
the optional real order test verifies snapshot rows and same-operation replay.
Legacy feature tests are retained but excluded from default acceptance. CI/staging
configuration exists; no remote CI run or authenticated staging result is claimed.

## Manual receipt and takeaway — B19 (supersedes provider-only activation)

PRD§12.20/21 and migrations0017/18 define the shipped v1. No PayOS/SePay webhook
is enabled. Current active staff/admin verifies actual money, exact expected
amount, method and bank reference; DB supplies immutable identity/name/role/time.
Unique receipt/session and normalized reference prevent duplicate confirmation.
Receipt activates once with stock/export/outbox and assigns the confirming staff;
pickup is a separate guarded action, requiring all positive items ready/served,
then closes with serving actor/time. No unconfirm/edit/delete/refund workflow.

POST /api/staff/payments {operationId,command:{sessionId,expectedTotal,
paymentMethod,reference,confirmedReceived}}. GET operationId recovers scoped result;
GET pendingPage/historyPage reads25+1 projections. Actor is guard-derived only.
POST /api/staff/takeaway {operationId,sessionId}; GET operationId recovers;
GET page returns25+1 ready-for-pickup rows. All writes Origin/JSON/body bounded,
no-store, DB-role rechecked; durable journals precede POST. Known rollback4xx may
clear identity; ambiguous5xx/network retains it. Explicit retry uses the same key.

POST /api/customer/takeaway {operationId,command:{customerName,customerPhone,lines}}
uses x-takeaway-token with a browser-generated256-bit secret persisted before POST.
GET operationId uses the same secret to recover; GET without it reads own snapshot,
including CLOSED. Secret never goes into API URL/result/audit/plaintext scope;
no phone-only lookup. Names/phone/cost/receipt actor are absent from public DTO.
Server/DB snapshots price/cost, line routing and total; unpaid drafts have no
stock/log/outbox. Durable ledger quotas under a global advisory lock bound100
pending/global,3/phone,2 creates/10min/phone,10/day/phone,100/day/global. These
are volume limits; rotating phone numbers can exhaust shared capacity. Edge
request-abuse protection was outstanding at B19; B20 implements the gate below.

Checkout requires verified merchant/account and explicit enable, default off.
VietQR is generated locally; PNG/copy actions need no QR/bank API. Actual receiving
account and banking-app scan acceptance are outstanding. Tracking polls only
visible/online15s, backs off to60s, stops CLOSED or401/403/404; stale is explicit.
History stores at most20 capability references and warns shared-device access.
Menu conflicts preserve the cart and refresh server props; displayed price changes
require explicit consent before changing a cart. Browser tests mount shipped
components with an isolated API peer; they do not establish bank/Clerk acceptance.

## Request budgets — B20

PRD§12.22/SQL0019 add private.request_limits and service-only
fn_takeaway_request_gate. Configured trusted ingress yields canonical IPv4 or
IPv6/64, then daily HMAC-SHA256 fingerprint; never trust generic XFF or expose
secret/IP in a DTO. Vercel requires explicit source and real platform runtime;
proxy mode requires constant-time credential match and ingress-overwritten peer
IP. Missing/invalid source, secret, address, quota config => fail closed.

Validated public create/retry claims a separately committed request budget before
business RPC. Defaults network10/min,120/hour; global60/min,600/hour, strict
server configuration. Dedicated advisory lock+DB time+fixed-window counters
coordinate instances; expired buckets prune<=200/request. Global denial allocates
no network row; counters saturate. Quota denial returns normally (commit) and API
429/Retry-After/TAKEAWAY_REQUEST_RATE_LIMIT; this also keeps journal because a
concurrent same-key request could have committed. Business quota rejection is a
different code, serialized after replay lookup in create. Transient failure503
keeps journal too. Own GET recovery still works.
No business ledger/receipt pruning; no anonymous quota RPC or raw-table grants.

Local tests verify concurrency, persistence, bounded cleanup, bootstrap/upgrade,
spoofed headers, IPv4-mapped and IPv6 normalization, gate-before-write and failure
recovery. Fixed windows/NAT/distributed exhaustion and infrastructure ingress
verification remain rollout constraints; this is not DDoS prevention. Real staging
takeaway POM has explicit mutation opt-in and synthetic CASH receipt/pickup, no
bank transfer. Test compilation/discovery does not establish external acceptance.

## Evidence and remaining acceptance — B21

The owner confirms there is no staging app URL and real devices/users are not
available yet. Target acceptance is NOT_RUN. scripts/staging-preflight.mjs never
loads .env.local and accepts only explicitly isolated origins/public anon JWT;
service keys are rejected. A positive key control precedes23 bounded read-only
checks, no redirect following/body logging or business mutations. Reports omit
credentials and never approve release. Seven Node adapter tests are local only.

Pinned Git9f986ac UI source/CSS/store/utils can be rendered in a loopback-only
read peer, all writes/external traffic blocked. Eight screenshots and hashes
form a reconstructed visual baseline, not a past deployment screenshot. Current
runtime never imports that source. Native dialog focus restoration now remembers
pointer triggers while closed, clears stale pointer targets for keyboard input,
and removes handlers on open/unmount: WebKit may leave a clicked opener unfocused.
Engine tests do not substitute for physical Safari/iOS, screen reader or users.
