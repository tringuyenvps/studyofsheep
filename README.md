# MY EXAM WEB V4

Bản nâng cấp có tài khoản, đăng nhập, lịch sử và thống kê theo tài khoản.

## Chạy

Yêu cầu Node.js 18+.

```bash
node server.js
```

Mở:

`http://127.0.0.1:5500`

Hoặc Windows: chạy `start.bat`.

## Tài khoản admin mặc định

- Username: `admin`
- Password: `Admin@123`

Sau khi đăng nhập admin, bấm nút ⚙ để cấp tài khoản học sinh.

## Tính năng

- Tài khoản do admin cấp mới làm bài.
- Mật khẩu được hash bằng Node `scrypt`.
- Session dùng cookie HttpOnly.
- Lịch sử thi lưu server theo user.
- Điểm cao nhất / điểm trung bình riêng cho VSAT và THPTQG.
- Lần thi gần nhất và số lần thi.
- Admin tạo, khóa/mở tài khoản học sinh.
- Giữ ngân hàng đề JSON + manifest.json.
- Toán/Văn 90 phút; môn khác 50 phút.
- Không tạo câu hỏi demo.

## Dữ liệu server

Tự tạo tại:

`server-data/users.json`
`server-data/attempts.json`

Đây là database JSON nhẹ để chạy local/demo. Nếu triển khai internet nhiều người dùng, nên chuyển hai file này sang PostgreSQL/MySQL/Supabase/Firebase và thêm HTTPS, rate limit, CSRF/CORS policy phù hợp.

## Lưu ý bảo mật

Điểm hiện được client tính rồi gửi server để lưu. Đây là bản V4 chạy được và có account/permission, nhưng chưa phải hệ thống chống gian lận tuyệt đối. Nếu triển khai thi chính thức, bước tiếp theo nên chuyển phần chấm điểm sang server: server tự đọc question JSON, nhận answer/question IDs và tự chấm trước khi lưu điểm.
