# Tiến độ 123Dzô

Cập nhật: 2026-10-23 · Batch 21 · Triển khai local; G1–G5 chưa đạt.

## Đọc nhanh

- Vừa triển khai: baseline8ảnh dựng từ Git gốc kèm hashes; preflight staging chỉ đọc23checks/NOT_RUN; WebKit phát hiện và sửa focus restore ở dialog chung, có regression test. Webhook tự động giữ tắt.
- Đã có: Auth/staff, ledger, order, kho/trả bia, lifecycle, item/menu/metadata API/RPC; journal recovery, full bill SQL, upload ảnh được kiểm quyền/giải mã.
- Cần trước vận hành: review độc lập, rehearsal/áp migration, kiểm Clerk/private realtime/push đích; cấu hình tài khoản nhận đã xác minh, worker scheduler và thiết bị thật.
- Review tổng thể sau toàn bộ implementation theo chỉ đạo mới; không dừng triển khai để chờ review từng task.
- Payment v1: theo quyết định người dùng, chủ quán/nhân viên tự kiểm tra tiền thực nhận; lưu actor/time/amount/reference. Không cần chọn PayOS/SePay. Chưa có số/tên tài khoản nhận nên checkout mặc định chưa bật.
- Điều kiện còn thiếu: chủ dự án xác nhận chưa có URL staging và chưa thể thử thiết bị/người dùng thật. M-02/M-15/M-16/UX-15 vẫn PARTIAL; không coi test local là33/33 hay đủ production.

## Trạng thái hiện tại

- M-00: REVIEW — references/inventory/git/test baseline và8ảnh reconstruct Git9f986ac có provenance/source hashes; giữ source gốc, fixture read-only không đọc env. Đây là baseline tái dựng, không phải ảnh deployment cũ. Chờ review cuối.
- M-01: REVIEW — amendments auth/order/kho/lifecycle/realtime/KPI và §12.20…22 chốt manual receipt, recovery/capability, pickup, request quota/retention; không còn quyết định provider cho v1. Chờ review cuối.
- M-02: PARTIAL — contracts/RPC/recovery/SDK local và preflight23checks có; staging NOT_RUN, thiếu URL app/positive Clerk/private policy proof trên Supabase đích. Không dùng7test Response-peer để tính nghiệm thu thật.
- M-03: REVIEW — guard + provisioning API/RPC/grants có test; chưa review độc lập/Clerk và UI thật.
- M-04: REVIEW — 8 bảng RLS/revoke table+column grants, KPI invoker/service-only RPC, guarded SSR/safe QR DTO, CHECK/preflight/unique/index và DB thật có test; chưa rollout/review cuối. Private realtime thuộc M-12, hiện refresh có guard.
- M-05: REVIEW — ledger/idempotency/quota/recovery dine-in/takeaway và request gate PostgreSQL theo mạng/global đủ code/local tests; không dùng limiter memory. Source IP phải được cấu hình tin cậy, HMAC/no raw IP; grant/race/expiry/fail-closed đạt local. Ingress thật/DDoS/load còn M-16; NAT/đổi mạng vẫn có rủi ro quota chung.
- M-06: REVIEW — customer/staff order RPC/UI, snapshot/kho/quota và outbox→worker đã có code/local tests; chưa review/E2E đích. PWA/realtime và nghiệm thu push thật vẫn M-12, scheduler/DB rollout M-16.
- M-07: REVIEW — code/local tests nhập/hủy/trả bia có; thiếu E2E đích và review cuối, không dừng implementation.
- M-08: REVIEW — lifecycle/full bill/list pagination và live scan đã có code/local tests; chờ E2E đích và review cuối.
- M-09: REVIEW — manual receipt staff/admin, current DB RBAC, unique session/reference, immutable actor/name/time/amount và lịch sử phân trang; local DB/API/UI đạt. Không triển khai webhook tự động trong scope v1 mới.
- M-10: REVIEW — create pending/snapshots/capability/recovery → manual activation/kho/outbox → pickup CLOSED nguyên tử, replay và race/rollback local đạt; chưa cấu hình nhận tiền hoặc nghiệm thu ngân hàng/hạ tầng thật.
- M-11: REVIEW — START/READY/SERVE/CANCEL API/RPC + journal/UI, batch/RBAC/timestamps local có test; chưa E2E/review cuối.
- M-12: REVIEW — a private Broadcast/ticket/policy/refresh, b worker, c PWA/audio/WakeLock đủ code/local tests; flag realtime mặc định off, chờ Supabase/OS/provider đích và review cuối. Chưa bật scheduler/push thật.
- M-13: REVIEW —5 views/RPC cùng kỳ, giờ Việt Nam/[start,end), revenue closed_at/COGS served hoặc prepared-cancel/waste log; peak filter và no-data/error/last-update; local DB/UI đạt, chưa nghiệm thu dữ liệu quán.
- M-14: REVIEW — CRUD/ảnh/cleanup, phân trang, guarded demo seed, env/cron và fake-data removal có code/local tests; chờ Storage/Clerk đích, rehearsal/review cuối. Payment legacy gate đóng; manual receipt theo scope v1.
- M-15: PARTIAL —911/911 unit84files,81,76%line/78,15%branch toàn src;7Node preflight tests riêng. Có baseline, Chromium/WebKit engine evidence và CI config. Còn gap branch một số adapter, Clerk E2E/CI remote/bank acceptance chưa chạy. Discovery/Response peer không là nghiệm thu đích.
- M-16: PARTIAL — health/read-only preflight, backup/restore/bootstrap/upgrade và rehearsal12bàn/48calls có local evidence; preflight đích NOT_RUN. Còn URL/ingress/account/scheduler/rollout, tải thật và review cuối; không deploy.
- UX-00: REVIEW —chung M-00:8ảnh Git baseline390px/tablet và before/after có manifest/source hashes, phân biệt reconstruction/current fixture với nghiệm thu thật. Không chạy duplicate task; còn nghiệm thu đích theo UX-15/M-16.
- UX-01…UX-07: REVIEW —shell/dialog/lineId/status/shared menu/cart/progress/bill có code+local behavior/browser evidence; chưa thiết bị/quán thật và review cuối.
- UX-08: REVIEW —shared menu/giỏ/form → final confirmation → create; giá đổi hiện giá cũ/mới và cần đồng ý, món hết cần bỏ khỏi giỏ; thiếu cấu hình giữ browse-only. Local UI/API/DB đạt.
- UX-09: REVIEW —copy tài khoản/tiền/nội dung, VietQR local/lưu PNG, pending/recovery/capability; polling15…60s visible/online, terminal dừng; chưa scan app ngân hàng/thiết bị thật.
- UX-10: REVIEW —own whole-order status/địa chỉ/liên hệ, mixed/all-ready/closed, lịch sử20 capability/lấy trạng thái server và xóa local có cảnh báo. Local tests/browser đạt.
- UX-11: REVIEW —dine-in/takeaway giữ giỏ và journal khi unknown, read-only recovery, explicit same-key retry, stale/offline/terminal/error không báo thành công giả; chưa nghiệm thu mạng/thiết bị đích.
- UX-12…UX-14: REVIEW —home customer-first, Staff READY→bill→tables/filter, KDS modes/notes/pending và queue activation; local evidence có, chưa nghiệm thu nhân sự/quán.
- UX-15: PARTIAL —Chromium/WebKit360/390/430+tablet, native focus/keyboard/contrast/zoom200/reduced-motion và ảnh; sửa focus restore WebKit có3test. Chủ dự án chưa thể thử thiết bị/người thật; chưa Safari/iOS/Android vật lý, screen reader và5–8khách.

Đếm theo task chính (không cộng subtasks a/b/c): kỹ thuật17 + UX16 = **33**.
**Hoàn tất implementation local/chờ review: 29/33** =14 kỹ thuật (M-00/01/03/04/05/06/07/08/09/10/11/12/13/14) +15 UX (00…14).
**Còn chưa hoàn tất: 4/33** =4 PARTIAL (M-02/15/16, UX-15),0 TODO. Production DONE0;
REVIEW29 không đồng nghĩa đủ nghiệm thu production. Không cộng subtasks hoặc số file vào tiến độ.

## Nhật ký kết quả

### B21 · 2026-10-23 · Xử lý một lượt6task còn lại

- M-00/UX-00→REVIEW:8ảnh nguyên bản dựng từ Git9f986ac, source/store/utils/CSS/lock hashes; canonical manifest ở artifacts/README. Current có menu/giỏ/progress/bill/takeaway/KDS/staff để đối chiếu. Không nhận là ảnh deployment trước đổi, không bật source cũ trong app.
- M-02: thêm CLI preflight23read-only checks, positive key control, deny tables/views/RPC/pages/API/capability; redaction/no redirects/timeouts, không service key/.env loader.7Node adapter tests đạt; môi trường thật NOT_RUN do chưa có URL/isolation config, không tính là pass.
- M-15:911/911 unit84files, coverage81,76%line/78,15%branch;3test pointer/keyboard/unmount mới. WebKit tái hiện lỗi focus về opener, đã sửa dialog chung; Chromium/WebKit engine tests và7Node preflight tests đạt. Source/unit/E2E typecheck, lint và build cuối đạt; CI thêm WebKit/preflight, chưa chạy remote. Logs `.temp/b21-coverage.log`, `b21-chromium.log`, `b21-build-final.log`.
- M-16: runbook/preflight có kết quả NOT_RUN và hướng dẫn cấu hình; release rehearsal4/4 với19migration trên DB loopback fixture đạt, gồm backup/restore và12bàn/48calls. Chưa có dữ liệu/domain/account/jobs/target evidence để ký gate release, không deploy.
- UX-15: WebKit desktop bổ sung cho Chromium, không thay physical Safari/iOS/Android/screen reader/5–8người. Chủ dự án xác nhận hiện chưa thể thử; giữ PARTIAL. Không giả lập người thật để đóng task.
- Kết quả: +2task baseline→**29/33 local**,4 PARTIAL/0 TODO. Chưa đủ33/33; không review tổng thể/phát hành khi các điều kiện nghiệm thu còn thiếu.

### B20 · 2026-10-23 · Request budget và staging POM mang về

- Code: spec§12.22 trước SQL0019/bootstrap/types; private quota bucket có TTL, RPC riêng commit trước create. Hạn network10/min120/h, global60/min600/h cấu hình được; serialize DB, bounded expiry cleanup, không xóa audit. Trusted Vercel/proxy + HMAC ngày, IPv4-mapped/IPv6/64; thiếu config/IP/gate khóa create, GET recovery vẫn dùng được.
- Tests:908/908 unit83files, coverage81,73%line/78,14%branch; gate100%line/94,20%branch. PG quota6/6: concurrency, commit deny, global không cấp row mới, TTL, grants và bootstrap/upgrade. Source/unit/E2E typecheck, lint, parity19/19 và build đạt. Log local `.temp/b20-coverage-final.log`.
- Staging: TakeawayPage POM + opt-in testcase tạo/replay/reload→synthetic CASH receipt/history/replay→pickup/replay/CLOSED. Workflow mặc định không ghi, cần role/phone/BAR fixture. Playwright discovery11ca/4files đạt, **chưa chạy môi trường thật**, không gửi tiền hoặc bật job.
- Recovery: request429 dùng mã riêng và giữ journal để tra GET/retry cùng key; request song song có thể đã commit, không được coi quota denial là bằng chứng cả operation rollback. Có test tái hiện và xác nhận chỉ GET recovery, không POST mới.
- Giới hạn: chưa chốt host/ingress, chưa xác minh trusted headers đích hoặc tài khoản nhận. Không đọc .env.local/áp SQL/deploy. Fixed windows/NAT/global exhaustion không là DDoS protection. Cập nhật delta contracts/query/runbook; review tổng thể cuối chưa thực hiện.
- Tiến độ:+1 M-05→REVIEW, **27/33 local**,6 PARTIAL/0 TODO, production DONE0. Không đóng task thiếu bằng chứng baseline/hạ tầng/thiết bị bằng unit test.

### B19 · 2026-10-22 · Thu tiền thủ công và mang về xuyên luồng

- Code: SQL0017/18 + bootstrap/types/spec§12.20/21; staff/admin xác nhận tiền thực nhận, DB actor/time/name snapshot, reference/session unique; tạo pending không xuất kho/queue/push, xác nhận mới activate/kho/outbox, giao đủ mới CLOSED. Journal/replay/rollback cùng transaction, không tự refund hoặc sửa/xóa receipt.
- UX: checkout cần verified store/account và explicit flag; QR/copy/lưu PNG không gọi dịch vụ QR ngoài; giỏ giữ khi lỗi/unknown, giá đổi cần đồng ý; lịch sử20 capability, không tra token bằng SĐT. Pickup polling dừng hidden/offline; tracking backoff15…60s, dừng CLOSED/401/403/404.
- Evidence: manual payment PostgreSQL12/12, takeaway9/9, release rehearsal4/4 sau migration cuối đạt (backup/restore,12bàn/48calls; timing local không là SLA). Chromium390px actual components tạo đơn→QR/lưu PNG→reload/history và staff receipt dialog đạt; peer API là fixture, không là Clerk/bank/DB app acceptance. Unit872/872 trong82files, coverage81,56%line/77,88%branch toàn src; lint, source/unit/E2E typecheck, build và18/18 migration parity đạt.
- Giới hạn: chưa đọc .env.local/áp SQL/gửi tiền/bật checkout/worker/deploy. Cần số và tên tài khoản nhận đã xác minh; Supabase/Clerk riêng là xác nhận của chủ dự án, chưa kiểm kỹ thuật. Phone/global quota bền vững giới hạn volume, còn edge/request abuse protection đích. Review tổng thể cuối chưa thực hiện.
- Tiến độ: +7 task local→26/33;7 PARTIAL/0 TODO, production DONE0. M-01/M-09/M-10 và UX-08…11→REVIEW theo scope manual v1; không coi hoãn webhook là đã triển khai webhook.

### B18 · 2026-10-22 · Recovery, thu ngân và bằng chứng xuyên luồng

- Sửa: HTTP5xx không xóa order journal dù body mang business code; Staff/thu ngân bỏ xác nhận tiền khi đổi phiên/tổng/phương thức; receipt dùng cấu hình quán đã xác minh, bỏ hotline mẫu. Admin staff SSR chỉ serialize cờ push, không endpoint/key. Các lỗi có test tái hiện trước sửa.
- Tests: 744/744 unit trong73files; coverage80,24%line/76,13%branch toàn src, không loại legacy; đặt gate80%line. Bổ sung thu ngân đầy đủ/timeout/unknown/recovery, role-safe SSR, menu/cart hỏng, mở/chuyển/bàn giao và CRUD danh mục/nhân sự. Source+unit/E2E typecheck, lint, build và Chromium UI cuối đạt.
- DB: focused release rehearsal4/4 đạt, gồm backup/restore và12bàn/48calls gọi/replay→batch→serve từng phần→trả bia→cash-close; bill/kho/KPI/counts khớp, fanout chỉ generic15topics. Không đổi SQL, không lặp full179ca cũ; fixture đã sửa đúng zone/catalog/SERVE contract. Local p50/p95≈1069/1784ms có overhead psql/fsync off, không là SLA staging.
- Nối tiếp: acceptance POM chọn món còn bán; optional order E2E kiểm snapshot server và replay cùng operation ID, không chỉ toast. Contracts/query inventory/runbook cập nhật delta B17/B18; chưa chạy Clerk E2E/CI remote, không dùng fixture để báo đạt nghiệm thu đích.
- Tiến độ: giữ19/33 local,10 PARTIAL/4 TODO, production DONE0. Payment provider chưa chốt; các phần takeaway/payment/recovery phụ thuộc còn mở, cùng Supabase/thiết bị/quán thật. Không áp DB app, bật worker/push/payment hoặc deploy.

### B17 · 2026-10-22 · KPI + UX độc lập provider + test/rehearsal

- KPI/DB:0015 activated_at nullable không đoán backfill,5views cùng RPC, effective queue, half-open giờ Việt Nam; COGS giữ prepared-cancel không xuất kho hai lần; server paging đủ menu/staff.0016 health admin read-only/counts, kiểm role; spec§12.17…19/types/bootstrap đồng bộ.
- UX: shared shell/menu/native dialog/lineId v2 migration/cart scope; menu→review→ack, nhóm progress không countdown giả; tổng bill trước chi tiết/chia đều thu gọn, whole-table confirmation/unsent choice. Mang về xem menu/form nhưng checkout tắt; home khách trước. Staff lọc việc và bill, KDS mode/notes/activation; offline/error/pending giữ dữ liệu.
- Tests:694/694 unit69files+coverage72.74%line/69.82%branch toàn src (chưa đạt target lúc B17); full PG179/179 gồm KPI6,health/restore3,private policies8 và các transaction cũ. Chromium local UI360/390/430/tablet/native focus/contrast/zoom200/reduced-motion, SW offline, source/unit/E2E typecheck, lint và build cuối đạt.
- Tooling: runner3→5.0.5+matchingcoverage vá critical dev dependency, ESLint thật, POM acceptance không browser-mockSSR/không chấp nhận500; CI local/staging có cấu hình. Chưa CI remote/Clerk E2E đích. npm còn advisory Next/PostCSS/Tailwind toolchain; không force major upgrade để báo sạch.
- Giới hạn/tracking:19/33 local,10 PARTIAL/4 TODO. Payment provider vẫn chưa chốt, checkout/webhook không bật; chưa áp DB app, scheduler/push thật hoặc deploy. Ảnh hiện tại ở automation_test/artifacts/ux là fixture production components, không chứng minh Clerk/RLS/payment hay baseline trước đổi. Review tổng thể cuối chưa thực hiện.

### B16 · 2026-10-22 · M-12a private invalidation, khép code local M-12

- Đổi: ticket POST kiểm Origin/capability hoặc Clerk+DB role, ES256120s không fallback key; mỗi owner một private channel, chỉ UUID/version invalidation→protected refetch. Renew/rejoin sau fresh auth, expiry/hide/offline/account/unmount cleanup, debounce/dedupe và dirty-read follow-up.
- DB:0014/bootstrap/types/spec§12.16, helper boolean recheck live/role; restrictive managed messages policies chặn sai topic/publish/presence kể cả legacy allow-all. Signal cùng commit, fanout live sessions cho menu/queue/session changes, CLOSED gửi cả former topic; lỗi realtime không rollback order, polling recovery.
- Tests:664/664 full unit/component62 files; sau chỉnh promise/visible cleanup, focused25/25 và middleware24/24 (thêm1 ca route mới); PG policy/transaction8/8, typecheck:tests/build cuối đạt. SDK cài thật + peer cô lập phát hiện/sửa first-join thiếu JWT bằng await setAuth; kiểm disconnect không reconnect, SDK timeout nội bộ10s tự hết.
- Giới hạn: feature flag mặc định off; chưa import key/áp DB app/tắt public channel trên Supabase, chưa test project join/publish/expiry/disable hoặc push/OS thật. Fanout O(live sessions) cần đo tải M-16; polling không được tính là nghiệm thu realtime. Runbook/contracts/query cập nhật delta.
- Tracking: M-12→REVIEW nghĩa code local a/b/c đủ, không đạt gate production;8/33 local,6 PARTIAL/19 TODO, production DONE0. M-02 còn kiểm chứng Supabase đích; kế tiếp M-13 KPI độc lập provider, không chờ review.

### B15 · 2026-10-22 · M-12c thiết bị/PWA/audio

- Đổi: SW root chỉ allowlist offline/icon/WAV, network-only SSR/QR/API/RSC/mutation, mất mạng không báo đã gửi; manifest/icon đủ, assets gốc có recipe. Staff opt-in/đăng ký lại/gỡ push có khóa bấm đúp, permission denied/unsupported rõ; một profile/một máy nhận được giải thích.
- Thiết bị: account owner chỉ Clerk ID local, đổi tài khoản/sign-out gỡ browser subscription/đóng notification; actor-version + body staffId chống opt-in đến muộn sang user mới. Unsubscribe local trước DB CAS, giữ endpoint tạm để retry nếu mất phản hồi; không tự đăng ký khi login.
- Chuông: thay MP3 giả16bytes bằng WAV2nốt tự tạo, audio reusable chỉ sau gesture, bật/thử/tắt/deny rõ; KDS/Staff chỉ kêu cho live actionable work, không unpaid/qty0/khác assignee. WakeLock single-flight, release hidden/unmount/kể cả late result, reacquire visible và theo dõi OS release.
- Tests:634/634 full unit/component +2 operational audio mới đạt =636 ca duy nhất; typecheck:tests/build đạt. Chromium headless loopback thật kiểm SW/cache migration/offline/reconnect/QR/API/RSC/mutation và WAV decode; push/click dùng handler cô lập, không provider thật. Không thay DB nên không lặp DB suite.
- Giới hạn: private Broadcast M-12a còn lại, vẫn guarded refresh; OS locked-device/iOS home-screen/provider/scheduler thật chưa nghiệm thu. Spec§12.15/runbook/contracts/query delta cập nhật;7/33 task chính giữ nguyên, không coi subtask c là hoàn tất M-12.

### B14 · 2026-10-22 · M-12b worker, khép local M-06

- Đổi: worker nhận việc SKIP LOCKED/lease45s, receipts từng người/subscription, retry10…300s/max8, fallback durable ready_at+120s và bill-request trigger cùng commit. Mỗi lần≤5 jobs/8 recipients/20s; kiểm assignment/READY/live trước gửi, không có zone thì không phát toàn quán.
- Bảo vệ: Bearer riêng/VAPID trước claim, URL provider/key/crypto validation chống SSRF, hash-CAS410, no redirects/timeout; subscribe/unsubscribe RPC recheck role/Origin, bỏ manual notify/setTimeout120s. Admin pending/failed/retry CAS, không lộ endpoint/key/payload.
- DB:0013 + bootstrap/types/spec§12.14, private receipts/outbox không raw grants; service push UPDATE cũ thu hồi. Tests600/600 unit/component (52 files), DB worker13/13 + lifecycle17/17 + read/grants2/2; typecheck:tests/build cuối đạt. Fixture NULL/SET đã sửa; không lặp full DB suite không bị tác động.
- Giới hạn: push at-least-once, crash sau provider trước receipt có thể lặp, stable tag; nhận bởi push service không chứng minh đã hiện/đổ chuông. Chưa áp DB app, chưa scheduler/gửi thật; cadence/backlog cần rehearsal M-16. Private Broadcast/SW/PWA/audio và device test còn M-12a/c.
- Tracking: M-12b code local có bằng chứng, chưa đóng toàn M-12; gỡ dependency worker của M-06→REVIEW. Tổng7/33 local,7 PARTIAL/19 TODO, DONE0 production. Cập nhật delta hiện có, không tạo tài liệu theo dõi mới.

### B13 · 2026-10-22 · Khép local M-04

- Reads: SSR sau guard dùng service client; QR snapshot RPC/API chỉ phiên DINE_IN ACTIVE/REQUEST_BILL, SQL queue positions, không giá vốn/kho/PII/bàn khác; Staff/KDS DTO hẹp, admin chỉ nhận cờ push. KPI filter qua admin API.
- DB:0012 + bootstrap/types/spec§12.13; 8 bảng RLS + restrictive deny, revoke table/column grants kể cả legacy service writes; KPI invoker, RPC service-only. CHECK hữu hạn/dấu kho, unique dine-in sống/bàn, preflight pointer/dirty data; EXPLAIN fixture24k items/12k bills/logs chứng minh index.
- UI: bỏ public row channels ở các luồng đang bật; refresh visible/online, timeout/no-overlap/cleanup, báo mất kết nối/expired; giữ âm thanh mới và chặn snapshot trễ mở lại gọi món sau REQUEST_BILL. Middleware cho phép capability snapshot không cần Clerk.
- Tests:536/536 full unit/component +9 ca mới đạt =545 ca duy nhất; focused không cộng lặp. Full DB148/149, fixture NaN cũ đã sửa/rerun đạt; read-boundary cuối11/11, EXPLAIN đủ3 index. Typecheck:tests/build cuối đạt; không áp DB app, cluster tạm đã dọn.
- Giới hạn: refresh10s khách/15s nội bộ chỉ fallback, chưa private Broadcast/push M-12; KPI correctness/date semantics vẫn M-13, provider chưa chốt. Rollout code+SQL cùng cửa sổ bảo trì theo runbook; chưa E2E/visual/review cuối. M-04→REVIEW,6/33 local, DONE0 production.

### B12 · 2026-10-22 · Khép local M-08/M-14

- Lists: bill/log DB25+1, filter trước range và priority bill, detail không history500; keyset catalog/live bỏ cap ngầm/limit300, paint25/filter, giữ thứ tự tên/số bàn; lỗi không giả rỗng/zero KPI.
- Seed/config: seed mặc định no-op; demo chỉ DB trống _demo+flag, không reset; total SQL978k. URL/key validate tách public/server; cron Bearer/cooldown60s/limit1, không mail/bank mẫu/unsigned-dev payment; giữ code legacy nhưng gate đóng.
- Tests:71/71 focused unit/component (12 files, gộp evidence không cộng overlap); seed PostgreSQL1/1 scenario gồm wrong-target/missing-flag/replay/stock/totals; typecheck:tests và build cuối đạt, Next PageProps lỗi đã sửa. POM cập nhật, chưa chạy browser.
- Giới hạn: chưa áp SQL/seed hoặc ping/push/payment thật. M-04 raw reads/grants, M-12 realtime/worker, M-13 analytics và rollout/review cuối còn lại; cron limiter per-instance, live scan không MVCC snapshot. Không coi payment provider đã xong.
- Tracking: M-08/M-14→REVIEW; metric chính5/33 code local,9 PARTIAL,19 TODO, DONE0 production. Không dừng để chờ review; tiếp tục M-04.

### B11 · 2026-10-22 · M-14c ảnh menu

- Đổi: upload raw WebP qua Admin API, stream<81920 + sharp full decode/size/pages; frontend nén lại exact81920, bỏ browser Storage/ô dán URL, khóa chọn ảnh/lưu món đồng thời.
- DB:0011 + bootstrap/types/spec§12.11; private image registry, immutable path/hash/actor và quota30/giờ; trigger chỉ gắn READY, restrictive bucket writes dù có policy permissive; chưa áp DB app.
- Cleanup: Admin claim≤20 orphan>24h, khóa/check mọi reference rồi DELETING→remove→DELETED; giữ ảnh khi save lỗi/unknown, retry failure và compensation tombstone; không tự xóa ảnh legacy/ngoài registry.
- Tests:103/103 focused unit/component (9 files, gộp evidence không đếm lại overlap); image DB8/8 + menu hồi quy11/11, typecheck:tests/build pass. Biên81919 qua size guard nhưng RIFF lẻ giả bị decoder chặn đúng; ảnh thật81918 decode đạt.
- Giới hạn/Finding: W-10 exact boundary đã sửa; tests dùng decoder thật/Storage policy fixture, chưa Storage Supabase/E2E/visual/review cuối. Lỗi fixture/teardown đã sửa, cluster tạm đã dọn; phân trang/seed/env/RLS còn lại, tổng task không đổi.

### B10 · 2026-10-22 · M-14b metadata

- Đổi: metadata kho/zone/table qua admin API/RPC + persistent journal/recovery, CAS fields, SSR refresh; hai màn hình Admin không còn browser DB mutations.
- DB:0010 + bootstrap/types/spec§12.10; role/active DB và revoke table/column writes, tạo tồn/cost0; unit đã có tồn/log/mapping không đổi, bàn đang phục vụ không sửa/xóa, FK RESTRICT giữ lịch sử; chưa áp DB app.
- UI: khóa bấm đúp/pending và thao tác kho/assignment liên quan; lỗi ngay trong modal, unknown đóng modal để đối soát; SSR đồng bộ zones/tables/staff/ingredients.
- Tests:66/66 focused unit/component (6 files), metadata DB11/11 + hồi quy lifecycle17/17 và staff8/8; typecheck:tests/build pass. Không chạy lại suite không bị tác động.
- Giới hạn/Finding: AUD-02/metadata cascade giảm; ảnh/storage, read RLS, phân trang/seed/env và takeaway/worker/UX còn lại; chưa E2E/visual/review cuối. Tổng task chính không đổi.

### B09 · 2026-10-22 · M-14a menu/86ing

- Đổi: Admin CREATE/UPDATE/DELETE và Admin/KDS86ing qua menu-actions API/RPC; CAS metadata/availability, journal trước POST, recovery GET và khóa bấm đúp/pending.
- DB:0009 + bootstrap/types/spec§12.9; thu hồi table/column writes menu, thêm publication menu, role/active DB; bảo vệ xóa/đổi routing/mapping món có lịch sử, snapshot/kho không đổi; chưa áp DB app.
- UI: lấy state hiện tại qua SSR refresh, không áp result replay cũ; lỗi lịch sử hiện rõ, recovery có trong drawer86ing; bỏ giá bán/vốn mẫu khi tạo món.
- Tests:63/63 focused unit/component (40 route/contracts,7 journal,4 admin,5 KDS,7 protected pages); DB menu11/11 (bootstrap/grants/history/concurrency/rollback); typecheck:tests/build pass. Không chạy lại suite cũ không bị tác động.
- Giới hạn/Finding: AUD-02 giảm ở menu writes, publication menu đã bổ sung; ảnh/storage vẫn caller cũ, metadata kho/bàn/phân trang/seed/env và private realtime/read RLS còn lại; chưa E2E/visual/review cuối. Tổng task chính không đổi.

### B08 · 2026-10-22 · M-11

- Đổi: chung item-actions RPC/API + journal/hook cho staff/admin/KDS; CAS status/quantity, đủ cả mẻ hoặc rollback, role DB và timestamp/served actor server.
- UI: khóa bấm đúp/pending, đối soát GET, admin hủy món đã chuẩn bị phải nhập lý do; không direct item/bill writes hoặc browser push ở3 màn hình.
- DB:0008 + bootstrap/types/spec§12.8; batch ID DB, note/snapshot giữ nguyên, cancel tính full bill và không hoàn/trừ kho lần nữa; READY/outbox cùng commit, chưa áp DB app.
- Tests:342/342 unit/component (31 files);31 API/client kiểm lại sau sửa narrowing DTO; DB transitions15/15 (races/rollback/role/snapshot/timestamps); typecheck:tests/build pass. Không chạy lại các DB suite cũ khi SQL của chúng không đổi.
- Giới hạn/Finding: AUD-05/07 giảm ở transitions; metadata/86ing/raw realtime/base grants/takeaway còn task khác, KPI loss M-13 chưa triển khai; chưa visual/E2E/review độc lập.

### B07 · 2026-10-22 · M-08 core/full bill

- Đổi: staff/admin/customer lifecycle qua API/RPC + journal; bỏ token Math.random/ghi bàn rời rạc và customer notify giả; thu tiền cần xác nhận, bill lệch cần xác nhận lại.
- DB:0006 lifecycle +0007 full bill, bootstrap/types/spec§12.7; tổng SQL toàn bộ items, token server64hex, khóa bàn/expected assignment, outbox và ledger cùng commit.
- UI: detail theo session không limit300/500, ẩn cost/actor/provenance, timeout/abort; chặn in/chốt khi chưa tải đủ; CLOSED lệch tiền lưu cần đối soát, không sửa doanh thu từ read.
- Tests: unit/component306/306 (28 files), typecheck:tests và build pass; DB sessions17/17, cộng B06 =92 ca nghiệp vụ pass;7 migration/bootstrap khớp, cluster tạm đã dọn.
- Giới hạn/Finding: AUD-05 giảm ở lifecycle/bill; còn phân trang list M-08/M-14, serve/cancel M-11 vẫn ghi tổng từ list cũ, base RLS/worker/payment chưa xong; chưa visual/E2E đích.

### B06 · 2026-10-22 · M-07b + KPI quantity0 compatibility

- Đổi: return API/RPC + journal/UI; xác nhận hàng chưa dùng, khóa expected quantity, snapshot cost, hoàn đúng export gốc; trả hết quantity0 giữ lịch sử.
- DB:0005 stock_export_log_id nullable + order RPC/KPI đồng bộ; legacy thiếu provenance bị chặn, không đoán mapping; seed demo bỏ2 food→kg giả, chưa sửa dữ liệu app.
- Tests: unit/component266/266 (23 files), typecheck:tests và build pass; DB returns14 + orders20 + inventory16 + ledger17 + staff8 =75/75.
- Giới hạn: review cuối/E2E/visual chưa có; RLS base tables và serve/cancel/lifecycle/takeaway còn caller cũ; outbox chưa worker.
- Finding: AUD-06 đã có transaction local cả4 loại kho; chưa đóng finding production trước RLS/rollout và đối soát dữ liệu cũ.

### B05 · 2026-10-22 · M-07a, một phần M-14/M-15

- Đổi: admin nhập/hủy kho qua API/RPC; khóa tồn, DB giá vốn/log/ledger cùng commit; pending journal + nút đối soát, chặn bấm đúp.
- UI: bỏ override tồn/giá vốn và phiếu bán/trả bia thủ công; khởi tạo tồn0/giá vốn0, giá hủy lấy DB, refresh dữ liệu hiện tại sau xác nhận.
- DB:0004 manual inventory + bootstrap/types/spec§12.5; chưa áp DB app.
- Tests: unit/component229/229 (20 files), typecheck:tests và build pass; DB inventory16/16 + orders20/20 + ledger17/17 + staff8/8 =61/61; UI cuối kiểm lại5/5.
- Giới hạn/Finding: AUD-06 mới giảm rủi ro IMPORT/WASTAGE; return/takeaway/base grants/metadata writes còn cũ; chưa visual/E2E/coverage/review độc lập.

### B04 · 2026-10-22 · M-05b/c, M-06, một phần M-12

- Đổi: customer/staff đặt món qua API/RPC; DB snapshot/quota/stock/log/total, persistent key/recovery; giỏ chỉ giảm sau xác nhận.
- DB:0003 order RPC + outbox + nâng result64KiB, bootstrap/types đồng bộ; chưa áp DB app.
- Tests: unit/component189/189 (17 files), typecheck:tests và build pass; DB orders20/20 + ledger17/17 + staff8/8 =45/45.
- Giới hạn: return/cancel/checkout/takeaway/RLS vẫn caller cũ; outbox chưa có worker; chưa visual/E2E đích/coverage.
- Finding: AUD-05/06 giảm rủi ro ở bước tạo món; các finding tổng chưa đóng, thiếu review và các luồng còn lại.

### B03 · 2026-10-22 · M-05a

- Đổi: private ledger claim/complete, SHA256 JSONB, key/scope isolation, result bất biến, deferred trigger chặn commit dở.
- DB: migration 202610220002_operation_ledger.sql + bootstrap/private types; không expose helpers/table, chưa áp DB app.
- Tests: ledger PostgreSQL 17/17, staff DB hồi quy 8/8; unit/component 147/147 (14 files); typecheck:tests pass. B02 build cuối pass.
- Giới hạn: fixture DB chứng minh helper, chưa tích hợp order/payment hoặc rate limit/recovery API.
- Finding: nền tảng cho AUD-04/06/07; chưa đóng các finding đó khi caller cũ chưa chuyển transaction.

### B02 · 2026-10-22 · M-03/M-04/M-14/M-15

- Đổi: admin staff POST + strict input/Origin/body limit; create xác minh Clerk; RPC kiểm actor/expected/last-admin trong transaction; UI không ghi staff_profiles trực tiếp.
- DB: migration 202610220001_admin_staff.sql + schema bootstrap/type đồng bộ; chưa áp lên DB ứng dụng.
- Tests: PostgreSQL 17.5 local 8/8; typecheck:tests và build pass; unit/component sau sửa fixture mount: 147/147.
- DB evidence: create/update, role/column grants, stale/rollback, last-admin concurrent, bootstrap=upgrade; cluster tạm loopback đã tự dừng/dọn.
- Giới hạn: unit mock Clerk/network; chưa E2E Clerk hoặc visual thật. Toàn bộ RLS và nghiệp vụ tiền/kho vẫn mở.
- Finding: AUD-01 sửa tới boundary API/DB staff, chờ review/rollout; AUD-02 mới xử lý staff writes, chưa đóng toàn bộ.

### B01 · 2026-10-22 · Auth foundation

- Guard DB role/active trước page/API; bỏ auto-admin/provision và service-role fallback.
- Tests: 98/98; source/test typecheck và build pass. Inventory baseline: 137 call sites.

## Quy ước cập nhật ngắn

1. Chỉ sửa dòng trạng thái có thay đổi; không chép lại master plan hoặc finding gốc.
2. Thêm một batch 4–6 dòng: Đổi / DB nếu có / Tests / Giới hạn / Finding. Batch mới đặt trước.
3. Chỉ ghi tổng test, pass/fail và phần chưa chạy; log lỗi dài nằm ở tool/artifact, không lặp trong progress.
4. Hành vi/API/schema ghi ở spec/contracts; vị trí source dùng tìm symbol, không giữ số dòng dễ lỗi thời.
5. DONE cần acceptance + evidence + review; code có nhưng chưa kiểm môi trường đích thì REVIEW/PARTIAL.
6. Các task cùng trạng thái được nhóm bằng dải ID; khi một task đổi thì tách riêng.
7. REVIEW là hàng chờ review tổng thể cuối, không phải điểm dừng triển khai; tiếp tục task độc lập đã được duyệt.

Tham chiếu: MASTER_REMEDIATION_PLAN.md (phạm vi), IMPLEMENTATION_CONTRACTS.md
(contract), SUPABASE_QUERY_INVENTORY.md (snapshot B01 + delta), STAFF_ACCESS_RUNBOOK.md (cấp quyền).
