# Bàn giao triển khai master plan 123Dzô

Trạng thái: người dùng đã cho phép bắt đầu master plan, 2026-10-22.
Đọc MASTER_IMPLEMENTATION_PROGRESS.md trước task kế tiếp. Quyền triển khai
local không phải quyền production deploy hoặc thao tác dữ liệu vận hành.

## Điểm bắt đầu

Đọc `MASTER_REMEDIATION_PLAN.md`. Bản này hợp nhất toàn bộ lỗi audit và UX.
`UX_UPDATE_IMPLEMENTATION_PLAN.md` vẫn là đặc tả giao diện chi tiết. Không dùng
năm TECH gate cũ để bỏ qua task backend hoặc để tự thiết kế lại auth/schema.

Task đầu tiên sau duyệt là M-00. M-01 tạo amendment cụ thể để chốt các thay đổi
schema/nghiệp vụ trước phần code phụ thuộc. Nếu người dùng đã duyệt amendment
đó trong phiên làm việc, tiếp tục; không hỏi lại từng bước đã được phép.

## Prompt Builder — thay TASK_ID và TASK_PART nếu cần

```text
Bạn triển khai TASK_ID / TASK_PART của 123Dzô theo master plan đã được duyệt.

Đọc:
- AGENTS.md và docs/PRD_SPEC.md (file thực tế; không tạo PRO_SPEC bản thứ hai).
- docs/MASTER_REMEDIATION_PLAN.md, đặc biệt quyết định, dependency, task,
  traceability và Definition of Done.
- docs/MASTER_IMPLEMENTATION_PROGRESS.md nếu đã có.
- docs/IMPLEMENTATION_CONTRACTS.md nếu task yêu cầu và file đã được chốt.
- docs/UX_UPDATE_IMPLEMENTATION_PLAN.md nếu TASK-UX hoặc liên quan UI.
- Các finding tương ứng trong hai báo cáo audit/UX gốc.

1. Kiểm tra phạm vi đã được duyệt trong hội thoại, dependency và trạng thái
   amendment. Không triển khai quyết định schema/role/payment còn chưa chốt.
   Không coi tên task có trong plan là bằng chứng task đã hoàn thành.
2. Đọc git status và source liên quan; giữ thay đổi hiện có. Không reset,
   chạy seed hoặc migration trên production, không đọc/in .env.local.
3. Đọc query inventory/contract. Chỉ thực hiện task hiện tại; sửa các file
   phụ thuộc thực sự cần thiết và giải thích lý do. Không tự thêm feature,
   table/column/enum/endpoint, dependency major hoặc quyền truy cập ngoài spec.
4. Mọi dữ liệu runtime phải thật. Test fixture chỉ ở test harness; không thêm
   fake bank, mock order, default admin, unsigned webhook hoặc fake KPI để
   UI chạy được. Không dùng any/unsafe cast để giấu lỗi type/schema.
5. Ghi dữ liệu qua API/RPC đúng contract, kiểm auth và expected state tại
   server/DB. Không mô phỏng transaction bằng nhiều request browser.
6. Viết/chạy test acceptance của task trên production functions. Với quyền,
   RLS, transaction hoặc concurrency, cần DB test thật riêng; mock không đủ.
   Nếu thiếu môi trường, hoàn thành phần độc lập và ghi phần còn BLOCKED.
7. UI thay đổi phải kiểm render ở viewport yêu cầu và các trạng thái lỗi.
   Không có browser thì ghi chưa kiểm chứng visual, không tự ghi PASS visual.
8. Chạy typecheck và tests phù hợp phạm vi. Không chấp nhận HTTP500/sign-in
   là expected success, không giảm assertion/coverage chỉ để pass.
9. Cập nhật MASTER_IMPLEMENTATION_PROGRESS: finding IDs, files, test commands,
   exit codes, evidence, phần chưa kiểm chứng và next task hợp lệ.
10. Theo chỉ đạo mới của người dùng: tiếp tục hết task theo dependency, review
    tổng thể sau triển khai. Kiểm thử mỗi đợt vẫn bắt buộc; không dùng thiếu
    review độc lập để dừng implementation. Giữ rõ phần chưa nghiệm thu;
    không tự đánh dấu Production Ready, deploy hoặc gửi push/payment thật.

Output:
- Task và hành vi đã thay đổi.
- Files chính và các quyết định trong spec đã áp dụng.
- Tests thực chạy / kết quả / giới hạn.
- Acceptance còn thiếu và blocker cụ thể.
- Finding IDs được đề nghị đóng, kèm bằng chứng.
- Task kế tiếp theo dependency, chưa triển khai.
```

## Prompt Reviewer

```text
Review TASK_ID / TASK_PART theo MASTER_REMEDIATION_PLAN và spec đã duyệt.
Đọc diff, source và tests liên quan; không chỉ đọc báo cáo Builder.

Kiểm tra:
1. Finding gốc có được sửa tại đúng boundary không, hay chỉ che bằng UI?
2. Auth/role/active/capability; client có giả actor/price/status được không?
3. Transaction, race, replay, rollback, lỗi mạng và dữ liệu lịch sử.
4. Schema/types/contracts/spec và tất cả callers của hàm đã đổi.
5. Tests gọi code thật; DB/RLS và visual evidence có đúng môi trường không?
6. UX có trung thực với dữ liệu, dễ hiểu, accessible và giữ giỏ khi lỗi không?
7. Có regression ở behavior đúng cũ, secret/PII leak hoặc runtime mock không?

Báo cáo theo AGENTS:
- Critical: file/line, trigger, tác động, spec, đề xuất sửa.
- Warnings: race/performance/realtime/UX và phần chưa kiểm chứng.
- Test log thực chạy, phân biệt log Builder với test reviewer chạy.
- Phase/task readiness: PASS / CHANGES REQUIRED / BLOCKED.

Chỉ đóng finding có evidence. PASS một task không phải PASS production.
Không sửa audit gốc để xóa lịch sử; ghi kết quả mới vào progress ledger.
```

## Quy tắc chia task

- M-00/M-01/M-02 là nền tảng; không giao “fix hết backend” một lượt.
- M-04 có thể chia migration → policies/grants → types/DB tests; chỉ DONE
  khi đủ cả ba và không triển khai riêng phần khóa quyền gây hỏng client.
- M-05 tách operation/replay → rate limit → recovery tests.
- M-10 tách create → payment apply → review/recovery; cả ba cần nghiệm thu chung.
- M-12 tách realtime → outbox/worker → PWA/push/audio/device test.
- M-15 dựng harness từ sớm, bổ sung test cùng từng task; không dồn toàn bộ
  test đến cuối rồi mới phát hiện contract không thể kiểm chứng.
- UX giữ acceptance chi tiết theo plan UX và dependency backend của master.

Progress dùng quy ước ngắn ngay trong MASTER_IMPLEMENTATION_PROGRESS.md:
patch trạng thái thay đổi + một batch 4–6 dòng; không chép lại scope/acceptance
hoặc log test dài. Đọc snapshot trước, chỉ đọc batch liên quan khi cần evidence.

Không được coi thu hẹp scope, bỏ task hoặc đổi architecture là cách tự xử lý
blocker. Ghi rõ phần còn thiếu để reviewer/người dùng quyết định đúng chỗ.
