# Review trải nghiệm khách hàng — 123Dzô

Ngày: 2026-10-22 (Asia/Bangkok).
Trạng thái: đề xuất thiết kế, chưa thay đổi giao diện hoặc nghiệp vụ.

## Mục tiêu được người dùng xác nhận

Giao diện và tính năng đơn giản, dễ hiểu, dễ tiếp cận; giải quyết việc thực tế
của khách hàng với ít thao tác và ít nhầm lẫn. Dùng mục tiêu này để đánh giá
các thay đổi giao diện tiếp theo. Không mặc định rằng thêm tính năng là tốt hơn.

## Phương pháp và giới hạn

Review trực tiếp JSX, CSS, state và các luồng tại bàn/mang về, cùng cấu trúc
màn hình staff/kitchen. Đọc AGENTS.md và docs/PRD_SPEC.md. Công cụ browser
không có browser kết nối; thử mở in-app browser trả Browser is not available.
Chưa quan sát màn hình render, chưa đo tương phản, overflow, tốc độ tải hoặc
chạy usability test với khách thật. Các rủi ro thị giác cần kiểm chứng trên máy.
Các nhận định dưới đây là heuristic/code review, không phải kết quả user research.

## Kết luận

Đúng hướng về tính năng cốt lõi: QR vào đúng bàn, không cần đăng nhập, có
giỏ hàng trước khi gửi, danh mục, trạng thái món, hóa đơn và lưu đơn mang về.
Chưa nên chốt thiết kế hiện tại: giao diện còn thể hiện mô hình kỹ thuật quá
nhiều, nhiều chữ nhỏ, thứ tự thao tác chưa ưu tiên việc khách cần nhất,
và một số thông báo tạo kỳ vọng vượt quá dữ liệu đã xác nhận.

Không kết luận dark theme là sai. Giữ nhận diện màu ấm, giảm trang trí cạnh
tranh với nội dung; thử nghiệm độ đọc ngoài trời và trong quán trước khi đổi theme.

## UX-01 — Dùng ngôn ngữ khách hàng, bỏ trạng thái kỹ thuật [P1]

Bằng chứng: DineInOrderView.tsx:729 lộ REQUEST_BILL; :1175/:1187 lộ VIETQR/CASH;
TakeawayOrderView.tsx:599 lộ ACTIVE, :992 lộ localStorage, :1058 in status thô.
Trang chủ src/app/page.tsx đặt bốn phân hệ và đường dẫn kỹ thuật ngang hàng.

Đề xuất copy:
- Thực đơn → Gọi món; Tiến độ Bếp → Món đã gọi; Hóa đơn → Tính tiền.
- Giỏ hàng → Món đang chọn. Ghi rõ: Chưa gửi cho quán.
- Hiện QR bàn → Mời bạn cùng bàn.
- Chia tiền Campuchia → Chia đều tiền (tiện ích tùy chọn).
- REQUEST_BILL → Bàn đã yêu cầu tính tiền. Muốn gọi thêm, vui lòng nhờ nhân viên.
- Đơn đặt gần đây trên thiết bị này (localStorage) → Đơn gần đây của bạn.
- Tạo đơn & Lấy mã thanh toán VietQR → Tiếp tục thanh toán.
- Trang chủ ưu tiên Đặt mang về; Đăng nhập nhân viên là liên kết phụ.
  Khách quét QR bàn vẫn vào thẳng menu, không phải chọn vai trò.

## UX-02 — Chọn món dễ đọc và không phải đoán [P1]

Bằng chứng: DineInOrderView.tsx:783–841, TakeawayOrderView.tsx:795.
Tên món bị truncate, tên/giá 14px, nhãn 10–12px. Không có màn chi tiết để
đọc phần tên bị cắt; nút Chọn/Thêm(n) có thể bị hiểu khác nhau.

Đề xuất: tên món được xuống dòng; ảnh, tên đầy đủ và giá là ba cấp chính.
Một nhãn nhất quán Thêm, sau khi chọn hiện số lượng rõ ràng. Giá cần nêu đơn
vị bán nếu thông tin đã có và được xác minh; không tự đoán từ category hoặc
đơn vị nguyên liệu. Thêm metadata khẩu phần/đơn vị phải cập nhật spec trước.
Nội dung chính và input ưu tiên 16px; nhãn phụ không dùng chữ quá nhỏ để nhét.
Ảnh thật là hữu ích nhưng không bắt buộc để đọc/đặt món; có fallback rõ tên.
Không tự gắn Bán chạy hoặc ước tính khẩu phần nếu chưa có dữ liệu xác thực.

## UX-03 — Giỏ đang chọn và món cả bàn đã gửi phải rõ ràng [P1]

Store hiện chỉ lưu giỏ cục bộ trên từng trình duyệt, còn order_items dùng
chung theo bàn. Không được gọi đây là giỏ đồng bộ giữa mọi người.
Đề xuất nhãn: Món bạn đang chọn — chưa gửi; Món cả bàn đã gọi.
Trước gửi hiển thị Bàn 05, số lượng, ghi chú và tổng lượt này. Sau gửi hiển thị
Đã nhận 3 món cho Bàn 05, kèm Xem món đã gọi và Gọi thêm.
Cần đối soát server khi mất phản hồi để retry không tạo đơn trùng (liên quan AUD-02/04/05).

Lỗi tương tác cụ thể: DineInOrderView.tsx:1251 dùng key gồm item.note, :1301
đổi note mỗi lần gõ. Key đổi làm remount input, có nguy cơ mất focus mỗi ký tự.
useCartStore.updateNote còn đổi mọi dòng cùng menu_item_id. Cần ID dòng giỏ
ổn định và update note theo dòng trước khi nghiệm thu nhập ghi chú.

## UX-04 — Trạng thái phải đúng với điều hệ thống biết [P1]

Bằng chứng: DineInOrderView.tsx:909 dùng queuePosition * prepMinutes * 0.6
để dự đoán phút; :1003 hết đếm ngược luôn nói Sắp ra đĩa; :1021 nói nhân viên
đang bưng dù READY chỉ thể hiện món đã sẵn sàng. :1203 nói nhân viên đang ra bàn
ngay khi gửi yêu cầu. TakeawayOrderView.tsx:598 hứa 2–5 giây.

Đề xuất: dùng Đã nhận món / Đang chuẩn bị / Món đã sẵn sàng, chờ phục vụ /
Đã lên bàn. Với đồ uống dùng Đang chuẩn bị đồ uống, không dùng Món đã chín.
Thời gian chỉ ghi Dự kiến khi có cơ sở; quá mốc ghi Quán đang chuẩn bị, lâu hơn
dự kiến. Giữ vị trí queue theo spec ở chi tiết, không biến nó thành cam kết
thứ tự lên món vì bếp có nấu gộp. Không dùng đồng hồ theo giây tạo độ chính xác giả.
Sau gọi tính tiền chỉ nói Đã gửi yêu cầu; chưa có tín hiệu nhân viên nhận việc.

## UX-05 — Tính tiền phải dễ tìm, báo trước việc khóa gọi món [P1]

Bằng chứng: DineInOrderView.tsx:1089–1205 đặt tiện ích chia tiền và nhiều nút
chọn số người trước thao tác chính. Bấm tính tiền khóa cả bàn, ảnh hưởng mọi máy.

Đề xuất thứ tự: tổng tạm tính + xem chi tiết → phương thức thanh toán →
Gọi nhân viên tính tiền → Chia đều tiền (thu gọn). Một xác nhận có ích trước
khi khóa: Sau khi yêu cầu tính tiền, bàn tạm dừng gọi món. Bạn muốn tiếp tục?
Nếu còn giỏ chưa gửi, nêu rõ để khách gửi hoặc bỏ lựa chọn trước khi xác nhận.
Cho biết bia chưa dùng sẽ được nhân viên kiểm tra/điều chỉnh trước khi chốt.
Chia đều chỉ là phép tính tham khảo, không tuyên bố mỗi người đã thanh toán.
Khi bàn đóng, cân nhắc hóa đơn chỉ đọc qua cơ chế được bảo vệ; không mở lại QR
đã hết hiệu lực trái spec. Đây là đề xuất cần thiết kế quyền riêng.

## UX-06 — Mang về cần một luồng thanh toán dùng được trên cùng điện thoại [P1]

Bằng chứng: TakeawayOrderView.tsx:823 giỏ nằm sau danh sách menu; :593–655
chủ yếu hướng dẫn Quét mã, chỉ có copy nội dung chuyển khoản. Không có nút
lưu QR hoặc copy riêng số tài khoản/số tiền. :589 Đặt đơn khác chỉ ẩn đơn cũ.

Đề xuất: thanh giỏ cố định như tại bàn → xác nhận tên/SĐT và món → thanh toán →
theo dõi đơn. Trên bước thanh toán cho lưu QR và hướng dẫn mở app ngân hàng,
chọn QR từ thư viện nếu ngân hàng hỗ trợ; luôn có thông tin chuyển khoản dạng
text với nút copy. Không giả định mọi app ngân hàng hỗ trợ deep link.
Khi quay về app phải kiểm tra lại trạng thái server; Chưa nhận xác nhận không
đồng nghĩa thanh toán thất bại. Có Kiểm tra thanh toán và liên hệ quán; không
tự đánh dấu đã trả tiền từ nút khách bấm.
Đặt đơn khác không được ngầm hủy đơn chờ thanh toán; cần mô tả rõ việc đang làm.
Nút copy hiện báo thành công mà không await clipboard: chỉ báo sau khi copy thành công.

## UX-07 — Mang về cần biết khi nào và ở đâu nhận đủ đơn [P1]

TakeawayOrderView.tsx:702–705 ghi Mời ghé lấy theo từng món READY: một món sẵn
sàng chưa có nghĩa cả đơn đã xong. Nhánh ngoài PENDING_PAYMENT ở :657 dùng
chung thông báo đang chế biến, kể cả khi mở đơn CLOSED.

Đề xuất: header trạng thái toàn đơn; chỉ mời nhận khi mọi món hợp lệ đã sẵn
sàng/được phục vụ theo quy tắc nhận hàng đã thống nhất. Đơn CLOSED hiện Đã hoàn tất.
Hiển thị địa chỉ nhận, giờ phục vụ, liên hệ và hướng dẫn nhận đơn trước trả tiền.
Các thông tin này phải được chủ quán xác nhận, không tự bịa hoặc dùng mẫu.
Thiết kế kiểm tra giờ mở cửa/công suất nhận đơn cần cập nhật spec nếu bổ sung nghiệp vụ.

## UX-08 — Trường hợp mất mạng, không tìm thấy và cần hỗ trợ [P1]

Không thấy xử lý online/offline hoặc trạng thái lỗi channel trong customer
components. subscribe() không có phản hồi trạng thái kết nối. Thông báo thành
công đôi khi dựa vào thao tác gửi, không phải xác nhận của nhân viên.

Đề xuất: thông báo mất kết nối gọn, giữ món đang chọn; phân biệt Đang gửi /
Đã nhận / Chưa xác nhận được. Retry phải đối soát đơn trước. Có empty state
Không tìm thấy món với Xóa tìm kiếm; không tải được menu có Thử lại.
QR hết hiệu lực cần hướng dẫn nhân viên mở lại bàn, không chỉ thông báo kỹ thuật.
Lối hỗ trợ ban đầu có thể là hướng dẫn gọi nhân viên tại bàn và số liên hệ
đã xác minh cho mang về. Nút Gọi nhân viên chỉ thêm khi có người nhận và phản
hồi thật, có chống spam; đây là đề xuất nghiệp vụ mới cần chốt spec.

## UX-09 — Accessibility và dùng bằng một tay [P1]

DineInOrderView.tsx:1233,1340: drawer/modal là div, chưa thấy dialog semantics,
focus management, Escape, trả focus hoặc ngăn tương tác nền.
Nhiều nút chỉ icon không có accessible name. Nút +/- tại :1274/:1290 là 36px;
không đạt mục tiêu 48px của dự án (không đồng nghĩa tự động vi phạm WCAG AA).
Form có placeholder nhưng nhiều label chưa liên kết id/htmlFor. Tabs chưa
thể hiện lựa chọn qua aria. Không thấy live status announcement.

Đề xuất: primitive dialog đã xử lý focus, tên nút rõ, thông báo aria-live
ngắn cho kết quả thao tác, không đọc đồng hồ mỗi giây; target 48×48px theo
mục tiêu dự án. Kiểm tra bàn phím, screen reader, zoom 200%, giảm chuyển động,
safe-area và bàn phím ảo. Dark theme cần đo tương phản thực tế trước kết luận.

Nguồn đối chiếu:
- W3C target size AA tối thiểu 24×24 CSS px hoặc ngoại lệ phù hợp:
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- W3C modal dialog: focus trong dialog, Escape, quản lý focus khi đóng:
  https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

## Ảnh hưởng từ giao diện nhân viên và bếp

Đề xuất màn staff ưu tiên Món chờ mang ra → Bàn cần tính tiền → Sơ đồ bàn;
lọc bàn phụ trách mặc định, vẫn cho hỗ trợ bàn khác theo quyền. Chi tiết bàn
ưu tiên Gọi món hộ và Tính tiền; chuyển bàn/bàn giao là thao tác phụ, có xác nhận
khi thay đổi. Nhận thông báo và xử lý phải liên thông, tránh thông báo trùng.
KDS giữ Batch/FIFO theo spec, nhưng làm rõ ghi chú khác nhau của từng phần
trước gom mẻ. Không che ghi chú không hành/ít cay để đổi lấy thẻ gọn.
Đây là hướng thiết kế, chưa được kiểm chứng bằng quan sát nhân viên vận hành.

## Luồng mục tiêu tối giản

Tại bàn:
1. Quét QR → Bàn 05 và menu; không đăng nhập, không cài app.
2. Thêm món → thanh Món đang chọn, tổng lượt này.
3. Xem lại → Gửi món cho Bàn 05 → nhận xác nhận từ hệ thống.
4. Món đã gọi → trạng thái rõ, biết món cả bàn, có cách nhờ hỗ trợ.
5. Tính tiền → tổng tạm tính → xác nhận dừng gọi thêm → yêu cầu nhân viên.

Mang về:
1. Chọn món → giỏ cố định dễ mở.
2. Xác nhận món, tên, số điện thoại và nơi nhận.
3. Thanh toán trên cùng điện thoại → quay lại kiểm tra xác nhận.
4. Theo dõi toàn đơn → thông báo đủ món để nhận → hoàn tất.

## Thứ tự triển khai đề xuất

1. Sửa các lỗi P0 kỹ thuật đã ghi nhận để lời hứa UI có cơ sở.
2. Đổi copy, phân biệt đang chọn/đã gửi, sửa key ghi chú, giảm chữ nhỏ,
   tên món đầy đủ, target và modal accessibility, chuyển chia tiền xuống phụ.
3. Thống nhất giỏ/checkout mang về; trạng thái kết nối, thanh toán và nhận đơn.
4. Chốt thông tin quán và các nghiệp vụ mới trước khi mở rộng schema/spec.
5. Usability test trên điện thoại thật rồi mới tinh chỉnh thị giác/theme.

## Tiêu chí nghiệm thu đề xuất — chưa phải kết quả đo

- Khách mới nhận ra đang ở bàn nào và nút bắt đầu chọn món trong 5 giây.
- Khách tự gọi hai món, sửa số lượng, ghi chú và gửi trong khoảng 60–90 giây
  sau khi đã quyết định món, không cần hướng dẫn thao tác.
- Phân biệt được món chưa gửi và món cả bàn đã gọi; hiểu tổng nào là tổng lượt.
- Tìm Gọi tính tiền trong 10 giây và hiểu tác động khóa gọi thêm trước xác nhận.
- Gõ ghi chú nhiều ký tự không mất focus; tăng/giảm không ảnh hưởng dòng khác.
- Thanh toán mang về dùng được với một điện thoại; biết nơi nhận và không
  bị khuyên chuyển lại khi giao dịch còn chờ xác nhận.
- Mất mạng/đóng app/mở lại không tạo đơn trùng, không báo đã nhận nếu chưa xác minh.
- Không cắt tên món hoặc che CTA tại 360/390/430px và zoom chữ 200%; test bằng
  touch, bàn phím, screen reader. Các kích thước này là kịch bản test đề xuất.
- Thử với 5–8 người có mức quen công nghệ khác nhau, có khách lớn tuổi; ghi
  tỷ lệ hoàn thành, lỗi, lần cần trợ giúp. Chưa tuyển người hoặc đo trong lượt này.

## Quyết định phạm vi

Chưa thay đổi enums, tables, cột, routes hay code ứng dụng. Những đề xuất
gọi nhân viên, thông tin khẩu phần/đơn vị, kiểm tra giờ bán và hóa đơn sau khi
đóng phải được phản ánh trong spec khi được chọn triển khai.
