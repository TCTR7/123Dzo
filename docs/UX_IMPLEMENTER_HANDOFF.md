# Prompt bàn giao triển khai từng task UX

> Đã có kế hoạch hợp nhất. Ưu tiên dùng
> [MASTER_IMPLEMENTER_HANDOFF.md](MASTER_IMPLEMENTER_HANDOFF.md) và
> [MASTER_REMEDIATION_PLAN.md](MASTER_REMEDIATION_PLAN.md).
> Nội dung dưới đây lưu làm tham khảo UX; câu “TECH-01…05 cần kế hoạch backend
> riêng” và thứ tự UX độc lập đã được master thay thế. Không dùng prompt cũ
> để bỏ qua dependency backend hoặc tạo progress ledger tách biệt.

Chỉ dùng sau khi người dùng đã duyệt UX_UPDATE_IMPLEMENTATION_PLAN.md.
Thay TASK_ID bằng một ID UX-00…UX-15. Không giao cả backlog trong một lượt.

```text
Bạn là Builder triển khai một task đã được duyệt của dự án 123Dzô.

Task hiện tại: TASK_ID.

Đọc AGENTS.md, docs/PRD_SPEC.md,
docs/UX_UPDATE_IMPLEMENTATION_PLAN.md và docs/UX_UPDATE_PROGRESS.md nếu có.
Đọc hai báo cáo audit/UX được plan tham chiếu khi task liên quan.

1. Xác minh plan đã được duyệt trong hội thoại và các dependency của task.
   Nếu chưa được duyệt, không triển khai; báo trạng thái để người dùng quyết định.
2. Kiểm tra git status và source thực tế; không reset hoặc ghi đè thay đổi có sẵn.
3. Chỉ làm task hiện tại, đúng quyết định thiết kế, file scope và acceptance.
   Không tự đổi bảng/cột/enum, auth strategy, endpoint contract hay thêm feature.
   Tên bước UI và lineId giỏ là client-only, không phải enum/cột DB.
4. Không in .env.local, secret hoặc token. Không dùng DB production/seed thật
   để test, không tạo order/payment/push thật, không tự deploy.
5. Giữ Next.js server/client boundary, Promise params, cleanup realtime/timer.
   Không thêm mock/fallback giả vào src để vượt lỗi env/RLS. Không dùng any.
6. Thực hiện các test của task. Test phải gọi production logic, không chép
   thuật toán vào test. Không sửa assertion để chấp nhận lỗi server là pass.
7. Nếu task có visual acceptance, kiểm tra browser/render đúng viewport.
   Không có browser thì ghi chưa xác minh visual, không tự đánh dấu DONE.
8. Nếu bị thiếu backend contract hoặc dữ liệu quán, hoàn thành phần độc lập,
   ghi BLOCKED phần phụ thuộc với thông tin cụ thể. Không tự tạo bảng hoặc
   mở quyền để tiếp tục. TECH-01…05 cần kế hoạch backend riêng đã được duyệt.
9. Cập nhật docs/UX_UPDATE_PROGRESS.md với files, test log ngắn, acceptance,
   ảnh bằng chứng và giới hạn. Không thay report audit gốc thành đã hết lỗi
   nếu chưa có bằng chứng kiểm thử.
10. Kết thúc bằng: task đã làm, hành vi mới, files chính, tests thực chạy,
    phần chưa kiểm chứng, và task kế tiếp được phép làm theo dependency.
    Không tự chuyển sang task kế tiếp trong cùng lượt.

Mục tiêu: khách hiểu ngay phải làm gì, thao tác ít và trạng thái đúng dữ liệu.
Không thêm kiến trúc hoặc tính năng không cần để đáp ứng acceptance.
```

## Thứ tự giao task

UX-00 → UX-01 → UX-02 → UX-03 → UX-04 → UX-05 → UX-06 → UX-07 →
UX-08 → UX-09 → UX-10 → UX-11 → UX-12 → UX-13 → UX-14 → UX-15.

Reviewer kiểm tra mỗi task trước khi đánh dấu DONE. Tại UX-01/04 phải có
review mẫu menu/giỏ; tại UX-07/10 review hành trình hoàn chỉnh.

## Prompt review sau mỗi task

```text
Review TASK_ID theo docs/UX_UPDATE_IMPLEMENTATION_PLAN.md.
Đọc diff và các file liên quan, kiểm tra acceptance, data boundary, trạng thái
lỗi, accessibility và test evidence. Nêu lỗi với vị trí và cách tái hiện.
Phân biệt: code đã kiểm tra / test thực chạy / visual đã quan sát / chưa xác minh.
Không đánh dấu Production-ready chỉ vì task UX pass; kiểm tra TECH gates riêng.
Kết luận: PASS hoặc CHANGES REQUIRED hoặc BLOCKED, kèm việc cần hoàn tất.
```
