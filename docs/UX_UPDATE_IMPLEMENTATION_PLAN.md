# Kế hoạch cập nhật UX 123Dzô — bản chờ duyệt

> Cập nhật 2026-10-22: tài liệu này là **phần đặc tả UX** của
> [MASTER_REMEDIATION_PLAN.md](MASTER_REMEDIATION_PLAN.md).
> Master plan bao phủ cả sửa lỗi audit, thay thế thứ tự triển khai và TECH gates
> chung ở tài liệu này. Giữ chi tiết layout/copy/acceptance UX bên dưới; dùng
> dependency, quyết định kỹ thuật và tiến độ chung của master. Người dùng đã
> cho phép bắt đầu triển khai master; tiến độ ghi tại MASTER_IMPLEMENTATION_PROGRESS.md.
> Không còn yêu cầu lập một backend plan khác: M-00…M-16 trong master chính là
> kế hoạch sửa lỗi kỹ thuật. Thay đổi spec vẫn cần amendment M-01 được duyệt.

Ngày: 2026-10-22 · Phiên bản: 1.0 · Trạng thái: **Được phép triển khai theo dependency của master**.

Mục đích: bàn giao cho model nhỏ triển khai tuần tự, mỗi lần một task có phạm vi
và điều kiện nghiệm thu cụ thể. Tài liệu này là kế hoạch, không phải bằng chứng
đã sửa lỗi hoặc đã vượt kiểm thử.

## 1. Mục tiêu và phạm vi duyệt

Khách mới có thể tự gọi món, biết quán đã nhận gì, theo dõi đúng trạng thái,
và yêu cầu tính tiền mà không phải hiểu phần mềm. Khách mang về có thể thanh
toán bằng chính điện thoại đang đặt và biết khi nào tới nhận đủ đơn.

Phạm vi đề nghị duyệt:
- Làm lại cách trình bày hai luồng khách, trang chủ và các trạng thái lỗi.
- Sửa giỏ cục bộ, accessibility và lỗi diễn đạt trạng thái.
- Tinh gọn các thao tác staff/kitchen có ảnh hưởng trực tiếp đến khách.
- Bổ sung kiểm thử hành vi thực tế, kiểm thử UI và tiêu chí nghiệm thu.
- Cập nhật tài liệu spec về cách trình bày được duyệt, không tự thêm nghiệp vụ.

Phạm vi ngoài đợt UX này:
- Đổi toàn bộ admin dashboard; thêm loyalty, voucher, delivery, booking,
  recommendation engine, chia thanh toán nhiều người hoặc giỏ đồng bộ đa máy.
- Tự thêm bảng/cột/enum, đổi URL đang dùng, nâng major dependencies.
- Cài đặt hết các sửa lỗi backend AUD-01…09 trong cùng một task giao diện.
- Áp migration, chạy seed, gửi giao dịch thật hoặc deploy Production.

Không dùng câu “UX hoàn thành” để thay cho “Production-ready”. Mục 10 liệt kê
các điều kiện kỹ thuật bắt buộc trước phát hành.

## 2. Tài liệu và nguồn dữ liệu

Đọc theo thứ tự trước khi làm:
1. AGENTS.md.
2. docs/PRD_SPEC.md, đặc biệt mục 3/5/6/7/10/12/13.
3. docs/CODEBASE_AUDIT_2026-10-22.md.
4. docs/CUSTOMER_UX_REVIEW_2026-10-22.md.
5. Tài liệu này và task đang được giao.

AGENTS.md hiện ghi PRO_SPEC.md nhưng file tồn tại là PRD_SPEC.md. Task UX-00
sửa tham chiếu tài liệu sau khi plan được duyệt; không tạo một bản spec thứ hai.

Line number trong audit chỉ là mốc tham khảo. Tìm lại tên hàm/component trong
source trước khi sửa. Không in nội dung .env.local hoặc secrets trong log.

Review trước dựa trên code; chưa có quan sát browser render vì browser tool
không khả dụng. Task UX-00 phải thu baseline hình ảnh khi có môi trường.

## 3. Các quyết định thiết kế đề nghị duyệt cùng plan

### D-01. Giữ nhận diện hiện tại, giảm nhiễu

Giữ nền tối, màu vàng ấm, font hệ thống và tên 123Dzô. Chưa thêm theme switch.
Thử ngoài trời/trong quán rồi mới quyết định cần theme sáng. Giảm viền màu,
badge, chữ in hoa, emoji trang trí, hiệu ứng nhấp nháy và mô tả kỹ thuật.
Một khu vực chỉ có một hành động chính nổi bật.

### D-02. Ba mục cố định cho khách tại bàn

Gọi món / Món đã gọi / Tính tiền, nằm ở thanh điều hướng cuối màn hình.
Header chỉ giữ tên quán, số bàn rõ ràng và Mời bạn cùng bàn.
Thanh giỏ hiện phía trên thanh điều hướng khi có món chưa gửi.
Giỏ ghi Món bạn đang chọn — chưa gửi cho quán; tiến độ ghi Món cả bàn đã gọi.
Không tuyên bố giỏ đồng bộ giữa các điện thoại.

### D-03. Thêm món nhanh; xác nhận một lần ở giỏ

Bấm Thêm chỉ thay đổi giỏ. Không mở modal xác nhận từng món. Giỏ cho sửa
số lượng, ghi chú và xóa; nút cuối ghi Gửi món cho Bàn XX. Chỉ chuyển sang
Món đã gọi sau xác nhận dữ liệu từ hệ thống. Không tự bỏ giỏ khi lỗi.

### D-04. Gọi tính tiền là thao tác chính

Tổng tạm tính → phương thức → Gọi nhân viên tính tiền → Chia đều tiền thu gọn.
Có xác nhận vì thao tác khóa gọi thêm cho cả bàn. Nếu giỏ chưa gửi, cho hai
lựa chọn rõ: Quay lại giỏ hoặc Bỏ món chưa gửi và tiếp tục; không âm thầm mất giỏ.
Chỉ xóa giỏ sau khi yêu cầu tính tiền được xác nhận thành công.

### D-05. Mang về có các bước rõ ràng trên cùng URL

Chọn món → Xem lại và thông tin nhận → Thanh toán → Theo dõi đơn.
Không thêm route hoặc enum DB cho các bước UI. Đơn gần đây là lối phụ, có
thể khôi phục đơn khi quay lại sau chuyển khoản. Không tự hủy đơn khi đóng panel.

### D-06. Trạng thái trung thực

Không hiển thị “nhân viên đang đến/đang bưng” khi chưa có tín hiệu tương ứng.
Không hứa thanh toán sẽ xác nhận trong 2–5 giây. Không dùng công thức queue
position × thời gian món × 0.6 để cam kết ETA. Giữ queue position theo spec
ở phần chi tiết và giải thích thứ tự lên món có thể khác do nấu gộp.
Thời gian chuẩn menu có thể hiện “Thời gian chế biến tham khảo: khoảng N phút”;
đây không bao gồm chờ bếp. Khi đang nấu, hiện số phút đã nấu; không đếm ngược
giây và không tự chuyển thông điệp thành “sắp xong”.

### D-07. Tiện ích mới chỉ ở mức đã có dữ liệu

Không thêm nút Gọi nhân viên chung, khẩu phần, giờ đóng/mở bán tự động, refund,
QR hóa đơn sau khi bàn đóng, thanh toán chia người trong lần này.
Hỗ trợ tại bàn bằng chỉ dẫn nhờ nhân viên; mang về bằng số điện thoại đã xác minh.
Không ghi nội dung tài khoản/ngân hàng/địa chỉ mẫu vào giao diện.

### D-08. Bàn đóng vẫn vô hiệu hóa QR

Hiển thị “Bàn đã thanh toán. Muốn gọi thêm, vui lòng nhờ nhân viên mở bàn.”
Không dùng QR cũ để mở lại dữ liệu hóa đơn nhằm giữ đúng spec hiện tại.
Chức năng nhận hóa đơn riêng là một scope khác.

## 4. Đặc tả màn hình mục tiêu

### 4.1 Gọi món tại bàn

Thứ tự từ trên xuống:
1. Header: 123Dzô, Bàn XX, khu vực nếu có; Mời bạn cùng bàn.
2. Banner trạng thái chỉ khi cần: bàn chờ tính tiền, lỗi mạng hoặc lỗi tải.
3. Tìm món (label truy cập được), danh mục kéo ngang có tín hiệu còn nội dung.
4. Danh sách món: ảnh, tên đầy đủ, giá, trạng thái tạm hết nếu có, nút Thêm.
5. Thanh giỏ: “Đang chọn: N phần · X đ” và “Xem món”.
6. Điều hướng: Gọi món / Món đã gọi / Tính tiền.

Tên món được xuống dòng, không truncate hoặc line-clamp che nội dung.
Không suy ra đơn vị bán từ nguyên liệu. “N phần” ở thanh giỏ là tổng quantity;
danh sách có thể nói “N loại món” theo số menu ID khác nhau nếu thực sự cần.
Không gọi số order_items là số lượt gửi vì schema chưa có order batch submission.

Giỏ mở dưới dạng dialog/bottom sheet: số bàn, chữ Chưa gửi cho quán, từng dòng,
ghi chú tùy chọn, tổng lượt này, nút gửi. Nút gửi disabled khi giỏ trống, đang
gửi, cooldown hoặc phiên không ACTIVE. Giữ thông báo lý do disabled nhìn thấy.

### 4.2 Món đã gọi

Ưu tiên nhóm Chưa lên bàn; nhóm Đã lên bàn thu gọn; món hủy nằm mục riêng
với lý do nếu dữ liệu được phép hiển thị. Không tiết lộ internal ID hoặc lỗi DB.
Mỗi món: tên, số lượng, ghi chú, trạng thái có chữ. Không dựa chỉ vào màu.
Có Gọi thêm đưa về menu. Không lấy món đang chọn ở máy này làm món đã gửi.

Mapping hiển thị (không đổi enum DB):
- QUEUED/KITCHEN: Quán đã nhận món — đang chờ chế biến.
- COOKING: Bếp đang chuẩn bị.
- READY/KITCHEN: Món đã sẵn sàng — chờ phục vụ.
- READY/BAR_INSTANT: Đồ uống/vật dụng đã sẵn sàng — chờ phục vụ;
  dùng “Đã sẵn sàng, chờ phục vụ” khi category không phải đồ uống.
- SERVED: Đã lên bàn.
- CANCELLED: Đã hủy.

Không công bố dữ liệu khách/bàn khác để tính queue; lớp dữ liệu an toàn là
điều kiện release ở mục 10. Trong UI chỉ cần queuePosition đã tính hợp lệ.

### 4.3 Tính tiền

Tổng tạm tính lớn; chi tiết món truy cập bằng một nút; phương thức Tiền mặt /
Chuyển khoản; nút Gọi nhân viên tính tiền. Tiện ích Chia đều tiền nằm dưới,
mặc định đóng, ghi “Ước tính; nhân viên sẽ xác nhận hóa đơn cuối cùng”.
Nhắc trả bia chưa dùng trước khi chốt; không cho khách trực tiếp hoàn kho.

Xác nhận: “Bàn sẽ tạm dừng gọi thêm món sau khi yêu cầu tính tiền.”
Thành công: “Đã gửi yêu cầu tính tiền. Vui lòng chờ nhân viên.”
REQUEST_BILL: mọi máy khóa thêm món, vẫn xem món/tổng tạm tính.
Không có nút khách tự chuyển REQUEST_BILL về ACTIVE.

### 4.4 Mang về

Menu dùng cùng cấu trúc thẻ/giỏ với tại bàn, ghi rõ Mang về. Khi qua xác nhận:
tên người nhận, SĐT, danh sách món, tổng tiền, địa chỉ nhận và thông tin liên hệ.
Quay lại menu không mất giỏ. Chỉ tạo phiên khi bấm Tiếp tục thanh toán.

Thanh toán: mã đơn, số tiền, ngân hàng/chủ tài khoản/số tài khoản, nội dung,
QR, Lưu mã QR, copy từng thông tin và Kiểm tra thanh toán. Không hiển thị nút
“Tôi đã thanh toán” mà có tác dụng kích hoạt đơn. Sao chép phải await thành công.
Tải QR lỗi vẫn có thông tin chuyển khoản text; không tạo QR chỉ chứa payment_code.

Quay về từ app ngân hàng hoặc reload: tải lại trạng thái server. Nếu chưa nhận
xác nhận: “Chưa nhận được xác nhận thanh toán. Nếu bạn đã chuyển khoản, vui
lòng kiểm tra lại hoặc liên hệ quán; không chuyển lại ngay.” Không gán timeout
thành thất bại thanh toán. “Đặt đơn khác” chỉ tạo luồng mới sau xác nhận, giữ
đơn trước trong lịch sử; không tuyên bố đơn trước đã hủy.

Theo dõi toàn đơn:
- PENDING_PAYMENT: Chờ xác nhận thanh toán.
- ACTIVE với món QUEUED/COOKING: Quán đang chuẩn bị đơn.
- ACTIVE, có ít nhất 1 món không CANCELLED, tất cả món đó READY/SERVED:
  Đơn đã chuẩn bị xong — bạn có thể đến nhận.
- ACTIVE nhưng không có món hợp lệ: Liên hệ quán để kiểm tra đơn; không mời nhận.
- CLOSED: Đơn đã hoàn tất. Không khẳng định đã giao nếu DB chỉ ghi đóng phiên.
- REQUEST_BILL ở TAKEAWAY: không phải trạng thái UI chuẩn; hiển thị cần kiểm
  tra với quán, không tự diễn giải thành đã nhận hàng.

Quy tắc mời nhận trên là đề xuất nghiệm thu cần được duyệt cùng D-05/D-06.
Đóng gói chưa có tín hiệu riêng trong schema; nếu quán yêu cầu bước đóng gói,
phải chốt spec khác trước, không tự thêm status PACKED.

## 5. Quy chuẩn giao diện và component

### 5.1 Thông số đề nghị

- Phạm vi CSS dưới .customer-app để không làm đổi toàn bộ admin/kitchen.
- Nội dung chính, tên món, giá, input: 16px; phụ: 14px; heading: 20–24px.
- Nút chạm tối thiểu 48×48 CSS px; khoảng cách thao tác cạnh nhau ít nhất 8px.
- Lề trang 16px, khoảng cách nội dung 8/12/16/24px; không dùng nhiều scale tùy ý.
- Container khách tối đa 640px; điện thoại dùng toàn chiều rộng.
- Nav dưới cao tối thiểu 56px + safe-area; giỏ nằm ngay trên, cao tối thiểu 64px.
  Nội dung có padding tương ứng để không bị che. Modal phủ và vô hiệu hóa nền.
- Input focus nhìn rõ; không bỏ outline nếu chưa có thay thế. Text dài và số
  tiền lớn được wrap đúng; không giảm font để chữa overflow.
- Khi bàn phím ảo mở, input và nút cuối sheet vẫn cuộn tới được; dùng dynamic
  viewport nếu phù hợp và test Safari/Chrome thật, không chỉ giả lập viewport.
- Giảm chuyển động theo prefers-reduced-motion. Không animate-ping trạng thái đơn.

Các số này là đặc tả dự án cần kiểm thử, không phải tuyên bố đã đạt WCAG.
Mục tiêu đo tương phản: chữ thường 4.5:1; chữ lớn và thành phần UI theo tiêu
chí WCAG liên quan. Không đạt thì chỉnh palette scoped, không chỉ tăng opacity mò.

### 5.2 Phân chia file dự kiến

Giữ DineInOrderView.tsx và TakeawayOrderView.tsx làm coordinator; không xây
framework generic hoặc abstraction cho mọi vai trò.

Component chung có thể tạo dưới src/components/customer/:
- CustomerShell.tsx: header, vùng nội dung, nav/footer, safe-area.
- MenuItemCard.tsx: trình bày món và thêm vào giỏ; không truy vấn DB.
- MenuCatalog.tsx: tìm kiếm/danh mục/empty state; nhận data qua props.
- CartSheet.tsx: giỏ, số lượng, note, tổng, CTA; nhận handler qua props.
- OrderStatusLabel.tsx: mapping trạng thái và station sang ngôn ngữ khách.
- ConnectionNotice.tsx: chỉ trình bày trạng thái kết nối được truyền vào.
- BillPanel.tsx và TakeawayPaymentPanel.tsx: riêng theo nghiệp vụ.

Primitive dùng chung: src/components/ui/AccessibleDialog.tsx.
Ưu tiên native dialog/showModal nếu không có primitive sẵn, xử lý lifecycle,
Escape, accessible name và restore focus. Không tự dựng focus trap bằng vài
event listener nếu không bao phủ đầy đủ. Nếu cần thư viện mới, trình bày lý do
và phiên bản ở task UX-01 trước khi thêm; không thêm cả design system mới.

Logic thuần dưới src/lib/customer/ (thư mục con của lib, cập nhật mục 13 spec):
- order-status.ts: labels và deriveTakeawayStatus.
- cart-lines.ts: tạo/migrate/update dòng giỏ, không biết Supabase.
- customer-config.ts: đọc/validate cấu hình công khai của quán.

Tên và thư mục mới phải được ghi vào mục 13 của spec trong UX-00.
Không tạo file trống để đánh dấu tiến độ. Chỉ tách component khi task cần.

## 6. Backlog triển khai tuần tự

Tất cả task đang TODO. Mỗi task = một lượt triển khai và một lượt review.
Không sửa task sau khi task trước chưa đạt điều kiện phụ thuộc.

### UX-00 — Chốt baseline và đồng bộ tài liệu [S]

Phụ thuộc: người dùng duyệt plan.
Files: AGENTS.md, docs/PRD_SPEC.md, tài liệu tiến độ ở mục 12.

Công việc:
1. Đọc lại git status, ghi nhận thay đổi của người dùng, không reset.
2. Sửa tham chiếu PRO_SPEC → PRD_SPEC trong AGENTS.md; không tạo spec trùng.
3. Ghi các quyết định D-01…08 vào spec phần giao diện, thêm cấu trúc file
   dự kiến; ghi rõ routes khách thực tế giữ /customer/order/[token] và
   /customer/takeaway. Không đổi DB enum vì đổi nhãn UI.
4. Chạy baseline tsc/unit; ghi đúng pass/fail, không lấy log cũ.
5. Chuẩn bị local/test DB riêng. Thu ảnh ở 390px: menu, giỏ, trạng thái món,
   bill, takeaway menu/payment; thêm 1194×834 cho KDS. Chưa có browser/test env
   thì ghi BLOCKED phần visual, không bịa ảnh hoặc coi SSR screenshot là đủ.

Nghiệm thu: diff chỉ tài liệu; dữ liệu test không trỏ production; baseline
và những phần chưa chạy được được ghi nhận.

### UX-01 — Shell, typography và dialog truy cập được [M]

Phụ thuộc: UX-00.
Files: globals.css (scoped), CustomerShell.tsx, AccessibleDialog.tsx,
DineInOrderView.tsx, TakeawayOrderView.tsx.

Công việc: thêm tokens/class scoped theo mục 5; shell khách; dialog primitive;
áp dụng đầu tiên cho QR share và giỏ tại bàn. Mở dialog đưa focus vào trong,
Tab không đi ra nền, Escape đóng khi an toàn, đóng trả focus về nút mở.
Đang submit không được hủy request bằng đóng dialog; nếu khóa đóng, giải thích
trạng thái và luôn có timeout/recovery từ lớp dữ liệu, không khóa vô thời hạn.

Nghiệm thu: không có horizontal overflow ở 360/390/430px; số tiền dài không
che CTA; background không tương tác khi dialog mở; zoom 200% đọc/đóng được.
Test: keyboard flow, role/name, focus restoration bằng test component hoặc
Playwright; screenshot trước/sau. Không test snapshot HTML khổng lồ.

### UX-02 — Giỏ có định danh dòng ổn định [M]

Phụ thuộc: UX-00; có thể làm trước UX-01 nếu chia lượt.
Files: src/lib/store/useCartStore.ts, cart-lines.ts,
DineInOrderView.tsx, TakeawayOrderView.tsx, unit_test/cart_store.test.ts.

Contract client-only: CartLine gồm lineId, menu_item_id, quantity, note và
metadata hiển thị hiện có. lineId sinh một lần khi thêm; không gửi xuống DB.
updateQuantity/updateNote/removeItem dùng lineId. React key = lineId.
Thêm cùng món và note đã chuẩn hóa thì cộng vào dòng sẵn có; sửa note không
tự gộp/xóa dòng để tránh nhảy focus. Hai dòng cùng món được giữ độc lập.

Migrate Zustand persist sang version mới: dữ liệu cũ hợp lệ giữ lại và gán
lineId; quantity phải nguyên dương hữu hạn, menu ID hợp lệ dạng string;
dữ liệu hỏng không crash. Không xóa giỏ hợp lệ chỉ vì version đổi.
Takeaway dùng helper dòng chung, nhưng không dùng chung state giỏ tại bàn.
Đổi session token phải tách giỏ đúng bàn như hiện tại.

Nghiệm thu: gõ câu ghi chú 20 ký tự không mất focus; sửa 1 trong 2 dòng cùng
món không đổi dòng kia; giảm về 0 xóa đúng dòng; reload giữ giỏ; đổi bàn không
mang giỏ cũ qua. Unit test production helper và browser test nhập note.

### UX-03 — Từ vựng và trạng thái thuần [S]

Phụ thuộc: UX-00.
Files: order-status.ts, OrderStatusLabel.tsx, unit_test/customer_status.test.ts.

Công việc: implement mapping ở mục 4; hàm deriveTakeawayStatus nhận session
và items, không mutate dữ liệu. Xử lý rõ CLOSED, PENDING_PAYMENT, zero items,
all-cancelled, mixed-ready/queued, all-ready, served và REQUEST_BILL bất thường.
Không dùng fallback “thành công” cho trạng thái không nhận diện được.

Nghiệm thu: không có raw enum trong UI labels; không suy ra toàn đơn xong chỉ
từ một món READY; CLOSED không thành “bếp đang nấu”. Test những branch này.

### UX-04 — Menu chung dễ đọc, tìm và thêm [M]

Phụ thuộc: UX-01, UX-02.
Files: MenuItemCard.tsx, MenuCatalog.tsx, hai customer views, POM customer.

Công việc: ảnh không làm co tên; tên xuống dòng; giá rõ; Thêm thống nhất;
đã chọn hiện số lượng cạnh nút, không đổi nghĩa nút. Tạm hết có text và disable.
Search có label, clear và empty state; nếu data load lỗi không dùng empty
menu để che lỗi. Không thêm bộ lọc/phân loại mới ngoài category hiện có.

Nghiệm thu: tên dài 80 ký tự, không ảnh, giá lớn, không kết quả, hết món;
thêm nhiều món không mở modal; thao tác 48px. Cả tại bàn và mang về cùng hành vi.
Test: tìm→thêm→giỏ; xóa tìm kiếm; không thể thêm món unavailable.

### UX-05 — Điều hướng tại bàn và gửi món [M]

Phụ thuộc: UX-01…04.
Files: DineInOrderView.tsx, CartSheet.tsx, CustomerShell.tsx,
automation_test/features/customer_dine_in/.

Công việc: nav ba mục ở đáy; header gọn; cart bar ở trên nav; QR share copy
ngắn. Chọn menu không tự ghi DB. Review sheet hiện đúng bàn/tổng lượt và nút
gửi. Kết quả gửi: success chỉ sau acknowledgement, clear cart đúng snapshot
đã gửi (không xóa món người dùng thêm sau thời điểm request); lỗi giữ giỏ.
Trong khi gửi khóa chỉnh giỏ để đơn giản hóa snapshot; mở lại được khi kết thúc.

Task này có thể dùng dữ liệu/adapter hiện tại cho preview test nhưng không
được ghi nhận “đã giải quyết chống trùng” nếu chưa có backend idempotency.
Không mở thêm direct Supabase writes để vượt qua RLS.

Nghiệm thu: ba hành trình gửi thành công/lỗi/phiên vừa khóa; total lượt khác
total bill; hai thiết bị thấy order chung nhưng không thấy giỏ của nhau.
Test request gửi đúng 1 lần khi double-click ở UI; không đánh đồng với bảo đảm server.
Nếu giá hoặc khả dụng thay đổi giữa review và gửi, hiển thị thay đổi và yêu cầu
khách xem lại trước khi gửi với giá mới. Không âm thầm đặt giá mới cao hơn tổng
khách vừa xác nhận. Cần backend kiểm tra điều kiện giá mà không trust giá client;
ghi dependency TECH-03 nếu contract hiện tại chưa hỗ trợ.

### UX-06 — Món đã gọi và kỳ vọng thời gian [M]

Phụ thuộc: UX-03, UX-05.
Files: DineInOrderView.tsx, OrderStatusLabel.tsx, customer dine-in tests.

Công việc: nhóm món chưa lên trước, served thu gọn, hủy tách rõ; xóa countdown
theo giây/ETA công thức; thời gian chuẩn ghi tham khảo. Giữ queue detail đúng
spec nhưng chỉ từ tập phiên hợp lệ; không thêm món pending vào queue realtime.
Không đổi ready/served trong DB để khớp label. Các cập nhật trạng thái không
làm nhảy focus hoặc tự kéo trang khỏi phần khách đang đọc.

Nghiệm thu: món vượt thời gian vẫn nói đang chuẩn bị; BAR_INSTANT không nói
“đã chín”; món của bàn khác không hiện trong danh sách bàn mình; chưa có món
có CTA Gọi món. Test stream update và nhóm món thay đổi.

### UX-07 — Tính tiền rõ ràng và xác nhận tác động cả bàn [M]

Phụ thuộc: UX-01, UX-03, UX-05.
Files: BillPanel.tsx, DineInOrderView.tsx, customer dine-in tests.

Công việc: áp dụng mục 4.3; total ưu tiên; chi tiết và chia tiền thu gọn.
Dialog xác nhận có Quay lại / Gửi yêu cầu. Giỏ chưa gửi cần lựa chọn riêng.
Chỉ xóa giỏ sau xác nhận request thành công. Request lỗi giữ dữ liệu và cho
retry qua adapter phù hợp. REQUEST_BILL từ thiết bị khác cũng khóa đặt món.
Không tự hoàn bia, reopen session hoặc tạo payment per person.

Nghiệm thu: tìm nút mà không cuộn qua chia tiền; chặn submit khi total=0;
cancel confirmation không đổi state DB; lỗi không mất giỏ; closed hiển thị
thông điệp đúng. Tổng cuối do server tính; UI total chỉ tạm tính (TECH-03).

### UX-08 — Takeaway chọn món và xác nhận nhận hàng [M]

Phụ thuộc: UX-01…04.
Files: TakeawayOrderView.tsx, CartSheet.tsx, customer-config.ts,
.env.example (chỉ tên biến và mô tả), customer takeaway tests.

Công việc: flow UI MENU / REVIEW / PAYMENT / TRACKING / HISTORY (local union,
không DB enum). Giỏ luôn tìm được; review có form label liên kết, name/tel
autocomplete, error gần field và summary khi cần. Validate tên sau trim,
SĐT theo rule hiện có được làm nhất quán; không tự đổi thị trường/quốc gia.

Cấu hình công khai đề xuất: NEXT_PUBLIC_STORE_NAME, NEXT_PUBLIC_STORE_ADDRESS,
NEXT_PUBLIC_STORE_PHONE, NEXT_PUBLIC_STORE_HOURS_TEXT. STORE_HOURS_TEXT là text
tham khảo, chưa phải rule tự động đóng đơn. Giữ các env VietQR đang dùng,
không log secrets. Thiếu địa chỉ/liên hệ/tài khoản hợp lệ: menu vẫn xem được,
nhưng checkout bị khóa với thông báo chưa sẵn sàng. Không dùng thông tin mẫu.

Nghiệm thu: back không mất giỏ; mở review không tạo session; bấm tiếp tục chỉ
gửi một thao tác UI; errors không xóa tên/SĐT; cấu hình thiếu không sinh QR giả.
Giá thay đổi hoặc món hết khi bấm tiếp tục phải quay lại review với thông tin
cụ thể; không sinh QR theo tổng khác mà không cho khách xác nhận lại.

### UX-09 — Thanh toán trên một điện thoại và khôi phục đơn [M]

Phụ thuộc: UX-08; xác nhận payment server là release gate TECH-04.
Files: TakeawayPaymentPanel.tsx, TakeawayOrderView.tsx, customer takeaway tests.

Công việc: payment panel mục 4.4; copy awaited có lỗi rõ; text account/amount/
content có thể chọn nếu clipboard bị từ chối. QR tải từ nguồn cấu hình hợp lệ;
nút lưu dùng blob download khi CORS cho phép. Nếu không tải được, mở QR để
người dùng lưu thủ công và hướng dẫn ngắn; không thêm open proxy nhận URL bất kỳ.
Không deep-link ngân hàng nếu chưa có contract được xác minh.

Persist reference của đơn đang theo dõi, không trust total/status localStorage.
Khôi phục từ server theo capability/token hợp lệ. Dữ liệu cũ chỉ có sessionId
không được dùng làm bằng chứng quyền truy cập; xử lý migration theo TECH-02.
visibilitychange về visible và reload phải refresh; dedupe request, AbortController
cleanup; không refetch mỗi giây. Nút Kiểm tra có pending và cooldown 5 giây.
Nếu realtime không dùng được, fallback polling giới hạn 15 giây khi visible,
backoff tối đa 60 giây; ngừng khi hidden/closed/unmount. Không chạy nhiều timer.

Nghiệm thu: denied clipboard, QR lỗi, app ngân hàng→quay về, refresh trong
pending/active/closed; không tạo session mới chỉ vì reload; không báo đã thanh
toán từ local state. Test fake timers cleanup và response delay.

### UX-10 — Theo dõi toàn đơn và lịch sử [S]

Phụ thuộc: UX-03, UX-09.
Files: TakeawayOrderView.tsx, order-status.ts, customer takeaway tests.

Công việc: header trạng thái tổng; địa chỉ/liên hệ nhận; chi tiết từng món;
CLOSED tách khỏi ACTIVE. Một phần READY không mời nhận toàn đơn. Lịch sử ghi
Đơn gần đây, không raw status/localStorage; empty state có Chọn món.
Giữ reference đơn cũ khi đặt đơn khác; không gắn nhãn đã hủy nếu chưa có nghiệp vụ.

Quyền riêng tư: không mở rộng lookup SĐT trả token/PII. Truy cập lịch sử có
bằng chứng sở hữu qua token thiết bị; lookup chéo thiết bị bằng SĐT cần lớp
xác minh ở TECH-02, chưa hoàn tất thì ghi blocked, không mock là đã an toàn.

Nghiệm thu: empty/all cancelled/mixed/all ready/closed và lịch sử reload;
không có trạng thái thành công mặc định khi dữ liệu thiếu.

### UX-11 — Trạng thái lỗi, mất kết nối và khôi phục [M]

Phụ thuộc: UX-05…10; TECH-03 để nghiệm thu retry không trùng.
Files: ConnectionNotice.tsx, customer views, customer pages (server fetch),
tests liên quan. Có thể tạo hook dưới components/customer/hooks nếu được ghi spec.

Công việc: phân biệt online browser, realtime connected và request confirmed.
navigator.onLine không chứng minh server hoạt động. Xử lý CHANNEL_ERROR,
TIMED_OUT, reconnect; subscribe/removeChannel cleanup; reconnect refetch snapshot.
Chỉ một banner ngắn, không toast lặp. Các page trả load error rõ thay vì []
giả menu trống. Lỗi quyền/token không retry vô hạn. Không đưa error.message DB
thô vào customer UI.

Write timeout: trạng thái Chưa xác nhận được; tra cứu operation ID trước khi
gửi lại; không tự POST mới. Nếu backend chưa cung cấp operation ID, task chỉ
được nghiệm thu hiển thị lỗi, phải đánh dấu phần retry-safe BLOCKED.

Nghiệm thu: mất mạng trước/sau server commit, reconnect, token closed, lỗi tải
menu, lỗi auth; không clear cart khi chưa biết kết quả. Test hậu quả DB ở TECH-03.

### UX-12 — Trang chủ và lối vào nhân viên [S]

Phụ thuộc: UX-01, UX-08.
Files: src/app/page.tsx, ui_quality POM/spec.

Công việc: tên quán + Đặt mang về là chính; chỉ dẫn khách tại bàn quét QR do
nhân viên cung cấp; Đăng nhập nhân viên là link phụ tới /sign-in. Không đưa
admin/kitchen/staff thành bốn CTA cạnh tranh cho khách. Không thay role redirect
trong task này, phụ thuộc sửa Auth TECH-01. Không đưa token demo lên landing page.

Nghiệm thu: customer không phải chọn vai trò; locator khớp copy mới; đi vào
luồng nhân viên vẫn tới auth, không bypass quyền.

### UX-13 — Staff ưu tiên phục vụ và thao tác bàn [M]

Phụ thuộc: UX-01; TECH-01/03 cho kiểm thử ghi dữ liệu thật.
Files: StaffDashboard.tsx, staff_portal POM/spec.

Công việc: ưu tiên Món chờ mang ra / Bàn cần tính tiền / Sơ đồ bàn. Bộ lọc
Bàn tôi phụ trách mặc định; có Tất cả bàn theo quyền hiện có để hỗ trợ.
Chi tiết bàn: Gọi món hộ, Xác nhận đã phục vụ, Tính tiền dễ thấy; Chuyển bàn,
Bàn giao, Trả bia nằm nhóm thao tác khác có nhãn rõ. Trả bia chỉ nhân viên xác
nhận; modal hiện số đã gọi, số trả, số tính tiền còn lại trước gửi.
Không thêm thao tác Admin cho staff; không che warning chờ xử lý chỉ để UI gọn.

Nghiệm thu: đúng bàn và quantity trên ready card; không gọi người phụ trách
là người bưng thực tế; không tạo/hủy món thử trên production.

### UX-14 — KDS đọc ghi chú và batch an toàn [S/M]

Phụ thuộc: UX-03; TECH-03/05 cho state và âm thanh.
Files: KitchenKdsBoard.tsx, kitchen_kds POM/spec.

Công việc: giữ hai cột Batch/FIFO theo spec; tên món, tổng lượng, từng bàn và
ghi chú dễ đọc ở tablet. Ghi chú khác nhau trong batch phải hiện cạnh số phần,
không chỉ tổng chung. Nhận nấu/Hoàn thành là CTA rõ; pending disable thao tác
đang xử lý; không dùng màu là tín hiệu duy nhất. 86ing có text và phản hồi lỗi.
Giữ Wake Lock/cleanup; không tái cấu trúc cả bếp trong task này.

Nghiệm thu: ba bàn cùng món, một không hành, một ít cay không mất ghi chú;
không thấy đơn pending payment; tablet 1194×834 và trạng thái mất mạng.

### UX-15 — Kiểm thử cuối, accessibility và nghiệm thu [M]

Phụ thuộc: UX-01…14; backend gates để nghiệm thu production flows.
Files: unit_test/, automation_test/, vitest.config.ts, playwright.config.ts,
package.json/lock khi thêm đúng dependency test, tài liệu kết quả.

Công việc:
- Bổ sung coverage-v8 cùng phiên bản Vitest thực tế; mở coverage vào phần
  logic customer và API đã có test, không tuyên bố % toàn app từ src/lib.
- Test import production helpers, không chép lại thuật toán vào file test.
- POM dùng role/name/label hiện có; tránh selector .first() mơ hồ cho nút món.
- Tests phải thao tác và kiểm tra kết quả; bỏ expectation chấp nhận cả trang
  bị cấm lẫn trang đăng nhập, bỏ 500 là kết quả pass của security test.
- Browser mocks phục vụ UI test; SSR data phải được cung cấp bằng test server
  hoặc DB fixture riêng. Không thêm runtime mock fallback vào src production.
- Mỗi role có auth state test riêng; anonymous và inactive là kịch bản riêng.
- Update checklist chỉ tick khi có test hoặc manual evidence thực tế.

Nghiệm thu: tsc + unit + production build (với cấu hình test) + E2E liên quan;
manual keyboard/screen reader/zoom/thiết bị. Coverage đo rõ phạm vi; mục tiêu
branch >=90% cho cart-lines/order-status và case critical đầy đủ, không ép
100% UI bằng test vô nghĩa. Có ảnh trước/sau, không có secret trong artifact.

## 7. Dependency và cách giao việc

Chuỗi đề nghị: UX-00 → UX-01 → UX-02 → UX-03 → UX-04 → UX-05 → UX-06 →
UX-07 → UX-08 → UX-09 → UX-10 → UX-11 → UX-12 → UX-13 → UX-14 → UX-15.

S = nhỏ; M = vừa, chỉ để chia phạm vi, không phải ước lượng số giờ hay cam kết.
Task M nếu cần chia thì chia theo logic/component, không chia “làm 50% file”.
Mỗi lượt chỉ một task; đọc task trước và acceptance của task sau có phụ thuộc.
Không tự spawn agent, không yêu cầu model nhỏ hoàn thành cả file dài trong một lượt.

UX-01/04 thay đổi visual cần reviewer xem ảnh sớm; không chờ UX-15 mới phát hiện
bố cục sai. Nếu chưa có môi trường render, ghi Visual verification pending.

## 8. Kịch bản kiểm thử bắt buộc

Tại bàn:
- C01: QR ACTIVE → thêm 2 món → sửa note/số lượng → gửi → thấy món đã gọi.
- C02: hai dòng cùng món khác note; sửa một dòng không đổi dòng kia/mất focus.
- C03: hai máy một bàn; giỏ riêng, món đã gửi chung; một máy yêu cầu tính tiền
  thì máy kia khóa gửi thêm sau refresh/realtime và DB cũng chặn.
- C04: giỏ chưa gửi → gọi tính tiền → quay lại giữ nguyên; xác nhận bỏ giỏ
  chỉ clear sau server success; server lỗi giữ giỏ.
- C05: món sold out giữa chọn và gửi; chỉ rõ món, giữ món còn lại, không gửi lén.
- C05b: giá tăng sau review; không tự gửi hoặc thu tổng mới khi chưa xác nhận lại.
- C06: tắt mạng ngay trước gửi và ngay sau server commit; không tạo đơn trùng.
- C07: served/cancelled/ready update không nhảy focus; READY không nói đang bưng.
- C08: CLOSED/invalid token không mở lại bàn, không lộ dữ liệu phiên khác.

Mang về:
- T01: chọn→review→back→payment, dữ liệu không mất và không tạo đơn sớm.
- T02: cấu hình ngân hàng/địa chỉ thiếu → checkout khóa, không QR giả.
- T03: clipboard denied/QR download lỗi → hướng dẫn text hoạt động.
- T04: chuyển app/reload khi pending → khôi phục cùng đơn; server ACTIVE →
  đúng trạng thái; không dựa localStorage để kết luận đã thanh toán.
- T05: một món ready, một cooking → chưa mời nhận; tất cả ready → mời nhận.
- T06: all cancelled/empty/closed → thông báo riêng, không nhận đơn giả thành công.
- T07: webhook trễ → không khuyên chuyển khoản lần hai; check status không tạo đơn.
- T08: lookup không trả dữ liệu người khác chỉ vì đoán SĐT; đối soát ở TECH-02.

Accessibility/visual:
- A01: tab/focus/Escape/restore với mọi dialog, input có label, icon button có name.
- A02: 360/390/430px, desktop 1280px; zoom chữ 200%; tên dài, giá lớn, không ảnh.
- A03: bàn phím ảo mở, safe-area iPhone, portrait/landscape, giảm chuyển động.
- A04: screen reader đọc feedback một lần, không spam timer; trạng thái có chữ.
- A05: đo contrast, vùng chạm, CTA không bị fixed bar hoặc keyboard che.

Nội bộ:
- O01: staff nhận việc, bưng đúng bàn; trả bia hiện đúng số còn tính tiền.
- O02: bếp batch không mất note, FIFO không có unpaid, hai bếp không ghi đè state.

## 9. Kiểm thử người thật và điều kiện duyệt thiết kế

Sau technical tests, đề nghị 5–8 người với mức quen smartphone khác nhau,
có khách lớn tuổi. Không coi mẫu này là bằng chứng thống kê cho mọi khách.
Đưa nhiệm vụ, không chỉ từng nút. Ghi time-on-task, lỗi, cần trợ giúp, lời khách.

Mục tiêu để đánh giá (chưa đo): nhận ra bàn/hành động trong 5 giây; gọi hai món
sau khi quyết định món trong 60–90 giây; tìm tính tiền trong 10 giây; hiểu món
đang chọn khác món đã gửi; thanh toán trên một điện thoại không cần hỗ trợ.
Nếu khách không đạt, sửa điểm mắc trước khi thêm tính năng. Review screenshot
không thay được kiểm thử thao tác hoặc quan sát người thật.

## 10. Các điều kiện kỹ thuật chặn Production

Những task dưới đây là công việc nền cần kế hoạch backend riêng được duyệt.
Không giao model nhỏ tự thiết kế schema/auth trong lúc sửa UI. UI có thể làm
trên fixture cô lập, nhưng release chỉ khi toàn bộ gate liên quan PASS.

### TECH-01 — Auth fail closed

Liên quan AUD-01. Không default admin; kiểm tra userId, role và is_active
trước thao tác. Chốt một nguồn role có thẩm quyền, tránh vòng redirect.
Không fallback service key về anon. Test anonymous/new-account/inactive/3 roles.

### TECH-02 — Data access, RLS và quyền sở hữu phiên

Liên quan AUD-02. Cần quyết định kiến trúc được ghi riêng trước triển khai:
Clerk JWT nối Supabase/RLS hoặc server APIs với read/realtime authorization
phù hợp. Không pha trộn hai cách nửa vời; không mở bảng để chữa lỗi truy cập.
Customer chỉ thấy dữ liệu cho phép và phiên sở hữu; public menu không lộ giá
vốn; queue trả thông tin tổng hợp an toàn; lịch sử SĐT cần xác minh bổ sung.
RLS bao phủ tables/views/RPC; test trực tiếp API bypass UI.

### TECH-03 — Transaction, idempotency và tổng tiền authoritative

Liên quan AUD-04/05/06/07. Gửi món, chốt bill, trả bia, đổi bàn, stock/log là
transaction có khóa phù hợp. Server copy price/cost và timestamp/actor.
Expected-state update ngăn ghi đè. Tổng bill không tính từ limit 300/500.
Submit cần operation ID ổn định + lưu kết quả bền vững để retry/reconcile;
không tự thêm cột/bảng vào spec trong UX task. Rate limit theo session ở server.

Contract UI cần backend cung cấp, tên endpoint sẽ chốt trong kế hoạch backend:
- Submit: request identity + session capability + menu IDs/quantity/note;
  không trust giá/tổng/role/timestamp từ client.
- Result: confirmed operation identity, canonical orders và canonical total.
- Reconcile: trả confirmed/pending/not found có phân quyền; not found chỉ được
  retry theo protocol idempotency, không tạo request identity mới tùy ý.
- Request bill: khóa phiên và trả canonical total/status atomically.
- Read status: session/order snapshot đúng quyền, không tin localStorage.

Không đưa chữ pending/not found của protocol này vào enum table_sessions.

### TECH-04 — Payment đúng giao dịch, đúng số tiền, commit nguyên tử

Liên quan AUD-03/04/09. Parser từng provider chỉ dùng dữ liệu xác thực; kiểm tra
success/chiều tiền/tài khoản nhận; chống replay và duplicate; activation+stock
nguyên tử. Không QR tài khoản giả. Test signed payload với field ngoài phần ký
bị sửa, trả thiếu tiền, webhook retry/concurrency/partial failure.

### TECH-05 — Realtime, push và âm thanh hoạt động thật

Liên quan AUD-08. Publication menu, cleanup và snapshot reconnect; không stale
closure. Server phát push sau READY; subscription/SW đầy đủ; fallback bền vững,
audio hợp lệ, không setTimeout trong serverless để đảm bảo nhắc 2 phút.
Không tự tạo public notify endpoint cho mọi khách gửi arbitrary notifications.

Các lỗi KPI/seed/admin khác trong audit vẫn ở backlog kỹ thuật. Hoàn tất UX
không đóng các issue ấy. Phát hành cả app phải nghiệm thu chúng theo audit.

## 11. Dữ liệu còn cần trước khi phát hành

- Tên hiển thị chính thức, địa chỉ nhận mang về, số hỗ trợ và giờ phục vụ text.
- Tài khoản nhận tiền và provider webhook thực tế đã xác minh; nhập secret qua
  cấu hình an toàn, không dán vào tài liệu hoặc prompt bàn giao.
- Môi trường test DB/Clerk và fixture theo role; không dùng seed trên production.
- Người chịu trách nhiệm review ảnh/thiết bị và xác nhận món sẵn sàng nhận.

Không cần các dữ liệu này để duyệt hướng UX hoặc làm component với fixture.
Cần chúng để cấu hình checkout, kiểm thử tích hợp và phát hành. Thiếu thì đánh
dấu blocked phần tương ứng, không thay bằng dữ liệu mẫu trong src.

## 12. Quy trình bàn giao và bằng chứng hoàn thành

Tạo docs/UX_UPDATE_PROGRESS.md khi bắt đầu triển khai sau duyệt. Mỗi task ghi:
- ID và trạng thái TODO / IN_PROGRESS / REVIEW / DONE / BLOCKED.
- Files thay đổi và hành vi trước/sau.
- Lệnh test thực sự chạy, kết quả/exit code và phạm vi.
- Ảnh hoặc video ở automation_test/artifacts/ux-update/<task>/, chỉ dữ liệu test.
- Acceptance đã kiểm tra; phần chưa kiểm tra và lý do.
- Dependency cần cho task tiếp theo. Không ghi DONE nếu acceptance chính còn thiếu.

Định nghĩa DONE của một UX task: code trong phạm vi + tsc/unit liên quan pass
+ kiểm thử hành vi được nêu + visual evidence nếu task đổi layout + reviewer
xác nhận. Không chỉ dựa compile hoặc ảnh một màn hình.

Định nghĩa READY FOR PRODUCTION: UX-15 đạt + TECH gates đạt + cấu hình quán
được xác minh + smoke test trên staging + không còn lỗi P0/P1 chặn hành trình.
Deploy là bước riêng sau review kết quả; plan được duyệt không có nghĩa đã deploy.

Rollback: mỗi gói commit riêng nếu người dùng yêu cầu commit; UI giữ route/data
contract cũ trong quá trình chuyển. Không hoàn tác DB để rollback visual. Persist
cart version có migration; lưu mô tả tương thích trước khi thay version.
Không xóa thay đổi của người dùng khi một test thất bại.

## 13. Các mốc người dùng duyệt

- Mốc A — duyệt plan này: D-01…08, thông số mục 5 và scope UX-00…15.
- Mốc B — duyệt màn mẫu sau UX-01/04: menu + giỏ ở điện thoại thực/render.
- Mốc C — nghiệm thu tại bàn sau UX-07 và mang về sau UX-10.
- Mốc D — duyệt release sau UX-15 và TECH gates; chưa xác định ngày phát hành.

Hiện chỉ chuẩn bị Mốc A. Chưa task nào được triển khai bằng việc tạo tài liệu này.

## 14. Đối chiếu với các phát hiện review

- UX review 01 (copy): UX-03/05/07/10/12.
- UX review 02 (đọc/chọn món): UX-01/04.
- UX review 03 (giỏ riêng, note): UX-02/05; TECH-03 cho chống trùng.
- UX review 04 (trạng thái trung thực): UX-03/06/09/10.
- UX review 05 (tính tiền): UX-07; TECH-03 cho tổng chính xác/khóa phiên.
- UX review 06 (thanh toán một máy): UX-08/09; TECH-04.
- UX review 07 (nhận cả đơn): UX-03/10; dữ liệu quán ở mục 11.
- UX review 08 (lỗi/hỗ trợ): UX-04/09/11; TECH-02/03 cho quyền và retry-safe.
- UX review 09 (accessibility): UX-01/04/15 và acceptance mỗi task có UI.
- AUD-01/02 → TECH-01/02; AUD-03/04/09 → TECH-04 và TECH-03.
- AUD-05/06/07 → TECH-03; AUD-08 → TECH-05.
- KPI date filter, seed an toàn, image compression boundary, cấu hình service
  role và các cảnh báo audit còn lại: backlog kỹ thuật riêng, không đánh dấu
  đã xử lý bởi plan UX này.
