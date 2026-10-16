# Bật thông báo màn hình khóa

CRAZII gửi thông báo đẩy của trình duyệt như một thông báo ứng dụng. Điện thoại cần cho phép thông báo của trình duyệt/ứng dụng; iPhone cần cài CRAZII vào Màn hình chính và mở bằng biểu tượng.

## Cấu hình máy chủ

1. Tạo cặp khóa VAPID một lần bằng `npx web-push generate-vapid-keys --json`.
2. Cấu hình các biến môi trường khi chạy máy chủ:
   - `VAPID_PUBLIC_KEY`: khóa public trong kết quả.
   - `VAPID_PRIVATE_KEY`: khóa private trong kết quả; giữ bí mật.
   - `VAPID_SUBJECT`: địa chỉ liên hệ dạng `mailto:you@example.com`.
3. Chạy CRAZII trên HTTPS và dùng Firestore đã cấu hình như hiện tại.

## Bật trên điện thoại

1. Đăng nhập CRAZII trên điện thoại.
2. Android: mở bằng Chrome. iPhone/iPad: trong Safari chọn Chia sẻ → Thêm vào Màn hình chính, rồi mở CRAZII từ biểu tượng mới.
3. Nhấn biểu tượng chuông trên thanh công cụ và cho phép thông báo. Một thông báo thử sẽ xác nhận thiết lập.
4. Kiểm tra phần cài đặt thông báo của điện thoại nếu thông báo không xuất hiện trên màn hình khóa.

Tín hiệu giao dịch mới được tạo khi trang biểu đồ đang chạy; kết quả TP/SL của tín hiệu đã lưu được máy chủ theo dõi và gửi kể cả khi điện thoại đóng CRAZII.