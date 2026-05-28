# HƯỚNG DẪN BÀN GIAO VÀ TRIỂN KHAI HỆ THỐNG
## VIETRAVEL ENGLISH PLACEMENT TEST PLATFORM

Chào mừng bạn đến với hệ thống Đánh giá Năng lực Tiếng Anh đầu vào dành cho ứng viên và nhân viên Vietravel. Đây là bộ mã nguồn sạch (Clean Version) đã được loại bỏ thông tin nhà phát triển, làm sạch dữ liệu kiểm thử và sẵn sàng cho việc bàn giao, vận hành mới.

> [!IMPORTANT]
> **Bản quyền học liệu:** Bài tập trên nền tảng được phát triển bởi **MM Publications Vietnam**.

---

## 1. TỔNG QUAN HỆ THỐNG & KIẾN TRÚC

Hệ thống được thiết kế theo mô hình Client-Server gọn nhẹ, tối ưu hóa cho hiệu năng cao và dễ dàng bảo trì:
- **Backend:** Node.js (Express framework) chịu trách nhiệm xử lý logic nghiệp vụ, quản lý phiên thi, tính toán điểm số và tương tác với cơ sở dữ liệu.
- **Cơ sở dữ liệu:** SQLite (sử dụng thư viện `better-sqlite3`). Cơ sở dữ liệu tự động được tạo mới và chạy seeding (nạp dữ liệu câu hỏi) khi hệ thống được khởi chạy lần đầu tiên. Không cần cấu hình server cơ sở dữ liệu độc lập.
- **Frontend:**
  - **Trang thi cho ứng viên (`/exam`):** Viết bằng HTML, CSS thuần phối hợp với framework Tailwind CSS. Tích hợp sẵn cơ chế chống gian lận (anti-cheat) như cảnh báo/ghi nhận hành vi khi chuyển tab, vô hiệu hóa click chuột phải, cấm sao chép/dán.
  - **Trang quản trị viên (`/admin`):** Dashboard dạng Single Page Application (SPA) chuyên nghiệp, hỗ trợ chuyển đổi giao diện sáng/tối (Dark/Light mode) linh hoạt.
- **AI Chấm điểm Tự luận (Writing):** Tích hợp AWS Bedrock (mô hình Amazon Nova-lite) để tự động chấm điểm và xếp hạng năng lực theo thang CEFR. Nếu không có khóa AWS, hệ thống sẽ lưu bài viết dưới dạng "Chờ chấm tay" (`pending_review`) để nhân sự (HR) tự đánh giá trên admin.
- **Bảo mật Audio:** Các file nghe được mã hóa bằng thuật toán XOR (lưu tại `public/audio_enc/*.vta`) có kèm theo header bảo mật, ngăn chặn tối đa việc thí sinh tải trực tiếp file âm thanh gốc về máy.

---

## 2. CẤU TRÚC THƯ MỤC BÀN GIAO

Mã nguồn sạch bao gồm các thư mục và tệp tin chính sau:
```
vietravel-exam/
├── server.js                # Tệp chạy chính của server Express
├── package.json             # Khai báo thư viện và scripts vận hành
├── railway.json             # Cấu hình triển khai nhanh trên Railway
├── nixpacks.toml            # Cấu hình môi trường build cho Railway
├── Dockerfile               # Tệp cấu hình Docker (nếu dùng)
├── .env.example             # Mẫu cấu hình biến môi trường
├── .gitignore               # Cấu hình bỏ qua các file tạm trong Git
├── setup-ssl.sh             # Script cấu hình Nginx & SSL Certbot (Ubuntu)
├── deploy-aws.sh            # Script triển khai tự động lên AWS EC2 (Ubuntu)
├── HANDOVER.md              # Tài liệu hướng dẫn này
│
├── src/                     # Mã nguồn Backend
│   ├── lib/
│   │   ├── db.js            # Kết nối và tự động khởi tạo cơ sở dữ liệu SQLite
│   │   ├── auth.js          # Quản lý mã hóa mật khẩu, JWT & phân quyền
│   │   ├── scoring.js       # Logic tính điểm trắc nghiệm & phân loại CEFR
│   │   └── bank.js          # Logic tải câu hỏi từ ngân hàng
│   └── routes/
│       ├── exam.js          # API xử lý bắt đầu thi, lưu tiến trình & nộp bài
│       ├── audio.js         # API stream audio bảo mật có xác thực token
│       ├── ai.js            # API gửi bài viết sang AI chấm điểm
│       ├── speaking.js      # API xử lý bài nghe/nói (nếu có)
│       └── admin.js         # API quản trị (thống kê, xuất Excel/PDF, quản lý phiên thi)
│
├── public/                  # Giao diện Frontend tĩnh
│   ├── index.html           # Trang chào mừng / Bảng trạng thái
│   ├── logo-vietravel.svg   # Logo thương hiệu Vietravel
│   ├── admin/               # Trang quản trị viên dành cho nhân sự (HR)
│   │   ├── index.html       # Dashboard chính
│   │   ├── login.html       # Trang đăng nhập admin
│   │   ├── admin.css        # Định dạng trang quản trị
│   │   └── admin.js         # Logic xử lý API quản trị
│   ├── exam/                # Trang làm bài thi của thí sinh
│   │   ├── index.html       # Giao diện thi (có credits MM Publications)
│   │   ├── exam.css         # Định dạng trang thi
│   │   └── exam.js          # Logic xử lý bài thi và đếm ngược thời gian
│   └── audio_enc/           # Các file nghe đã mã hóa XOR (.vta)
│
├── scripts/                 # Các công cụ hỗ trợ quản trị viên
│   ├── init.js              # Khởi tạo admin mặc định khi chạy lần đầu
│   ├── seed.js              # Công cụ import dữ liệu câu hỏi mẫu
│   ├── migrate-bank.js      # Công cụ di trú câu hỏi từ ngân hàng
│   ├── change-admin-pw.js   # Công cụ đổi nhanh mật khẩu tài khoản quản trị
│   └── reset-password.js    # Công cụ reset mật khẩu admin về mặc định
│
└── data/                    # Thư mục lưu trữ dữ liệu (sẽ lưu file DB tại đây)
    └── banks.json           # File ngân hàng câu hỏi gốc (176 câu trắc nghiệm & tự luận)
```

---

## 3. HƯỚNG DẪN CẤU HÌNH BIẾN MÔI TRƯỜNG (`.env`)

Trước khi khởi chạy hệ thống, hãy tạo tệp tin `.env` từ tệp `.env.example` và thiết lập các biến sau:

| Tên biến | Bắt buộc | Mặc định | Mô tả |
| :--- | :--- | :--- | :--- |
| `PORT` | Không | `3000` | Cổng HTTP mà server lắng nghe. |
| `NODE_ENV` | Không | `production` | Chế độ chạy ứng dụng (`development` hoặc `production`). |
| `DATA_DIR` | **Có** | `./data` | Thư mục lưu trữ file database (`exam.db`) và câu hỏi. |
| `JWT_SECRET` | **Có** | *(Tự sinh)* | Chuỗi khóa bí mật dùng để ký và xác thực mã thi của thí sinh. |
| `ADMIN_JWT_SECRET` | **Có** | *(Tự sinh)* | Chuỗi khóa bí mật dùng để ký token đăng nhập của HR/Admin. |
| `ADMIN_USERNAME` | Không | `admin` | Tên đăng nhập tài khoản quản trị tối cao đầu tiên. |
| `ADMIN_PASSWORD` | Không | `Vietravel2026!` | Mật khẩu tài khoản quản trị tối cao đầu tiên (được nạp lúc DB trống). |
| `ADMIN_DISPLAY_NAME`| Không | `HR Admin` | Tên hiển thị của tài khoản quản trị tối cao đầu tiên. |
| `EXAM_DURATION_SEC` | Không | `1800` | Thời gian thi (tính bằng giây). Mặc định là 1800 giây (30 phút). |
| `MAX_LISTENS_PER_AUDIO`| Không| `2` | Số lần tối đa thí sinh được phép phát mỗi file âm thanh nghe. |
| `AWS_ACCESS_KEY_ID` | Không | *(Trống)* | Khóa truy cập AWS (để dùng AI chấm điểm tự luận). |
| `AWS_SECRET_ACCESS_KEY`| Không | *(Trống)*| Khóa bí mật AWS (để dùng AI chấm điểm tự luận). |
| `BEDROCK_REGION` | Không | `us-east-1` | Vùng dịch vụ AWS Bedrock. |
| `BEDROCK_MODEL_ID` | Không | `us.amazon.nova-lite-v1:0`| Model ID của Amazon Bedrock dùng để chấm bài viết. |
| `ALLOWED_ORIGINS` | Không | *(Trống)* | Danh sách các domain được phép gọi API (nếu deploy frontend riêng). |

*Lưu ý: Để sinh ngẫu nhiên chuỗi JWT Secret an toàn, bạn có thể chạy lệnh:*
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 4. HƯỚNG DẪN TRIỂN KHAI TRÊN MÁY LOCAL (DEVELOPMENT)

Để chạy thử nghiệm hoặc phát triển hệ thống trên máy cá nhân:

### Bước 1: Cài đặt NodeJS
Đảm bảo máy tính đã cài đặt **NodeJS phiên bản >= 18** (khuyến nghị NodeJS 20 LTS).

### Bước 2: Cài đặt dependencies
Mở Terminal/CMD tại thư mục dự án và chạy:
```bash
npm install
```

### Bước 3: Tạo cấu hình môi trường
Tạo file `.env` từ `.env.example` và thay đổi các cấu hình phù hợp (như PORT, JWT_SECRET).

### Bước 4: Chạy seeding nạp câu hỏi mẫu
Để nạp dữ liệu ngân hàng câu hỏi gốc từ tệp `data/banks.json` vào SQLite:
```bash
npm run seed
```

### Bước 5: Khởi chạy chế độ phát triển
Chạy lệnh sau để khởi chạy server với cơ chế tự động tải lại khi thay đổi code (watch mode):
```bash
npm run dev
```
Hệ thống sẽ chạy tại địa chỉ: `http://localhost:3000`.
- Trang thi của ứng viên: `http://localhost:3000/exam/`
- Trang quản trị của HR: `http://localhost:3000/admin/login.html`

---

## 5. HƯỚNG DẪN TRIỂN KHAI TRÊN SERVER PRODUCTION (UBUNTU / AWS EC2)

Để triển khai hệ thống lên server Linux (Ubuntu 22.04 hoặc 24.04 LTS), bạn có thể sử dụng tệp script cấu hình tự động `deploy-aws.sh` đi kèm hoặc thực hiện thủ công theo các bước sau:

### Bước 1: Sao chép mã nguồn và phân quyền
Di chuyển toàn bộ thư mục dự án vào thư mục vận hành trên server, khuyến nghị đặt tại `/opt/vietravel-exam`.
Phân quyền sở hữu thư mục cho user vận hành (ví dụ: `ubuntu`):
```bash
sudo chown -R ubuntu:ubuntu /opt/vietravel-exam
```

### Bước 2: Cài đặt các thư viện hệ thống
Cài đặt NodeJS 20, Nginx và Certbot (dành cho SSL):
```bash
# Cập nhật hệ thống
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential python3 nginx certbot python3-certbot-nginx

# Cài đặt NodeJS 20 từ NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Bước 3: Cài đặt thư viện NodeJS cho Production
```bash
cd /opt/vietravel-exam
npm ci --omit=dev
```

### Bước 4: Thiết lập biến môi trường
Tạo tệp `/opt/vietravel-exam/.env` và thiết lập các thông số sản xuất, đảm bảo đổi `JWT_SECRET`, `ADMIN_PASSWORD` an toàn. Thiết lập `DATA_DIR=/opt/vietravel-exam/data`.

### Bước 5: Tạo dịch vụ Systemd Service
Tạo tệp cấu hình dịch vụ `/etc/systemd/system/vietravel-exam.service` để quản lý ứng dụng chạy ngầm và tự khởi động lại:
```ini
[Unit]
Description=Vietravel English Test Application
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/vietravel-exam
ExecStart=/usr/bin/node scripts/init.js && /usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```
Kích hoạt và khởi chạy dịch vụ:
```bash
sudo systemctl daemon-reload
sudo systemctl enable vietravel-exam
sudo systemctl start vietravel-exam
```
Kiểm tra trạng thái dịch vụ bằng lệnh:
```bash
sudo systemctl status vietravel-exam
```

### Bước 6: Cấu hình Nginx làm Reverse Proxy
Tạo file cấu hình nginx tại `/etc/nginx/sites-available/vietravel-exam`:
```nginx
server {
    listen 80;
    server_name yourdomain.com; # Thay thế bằng tên miền thực tế của bạn

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Kích hoạt cấu hình và tải lại Nginx:
```bash
sudo ln -sf /etc/nginx/sites-available/vietravel-exam /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

### Bước 7: Cấu hình SSL/HTTPS miễn phí
Chạy Certbot để tự động cài đặt chứng chỉ SSL Let's Encrypt:
```bash
sudo certbot --nginx -d yourdomain.com --non-interactive --agree-tos --email admin@yourdomain.com --redirect
```
Hệ thống sẽ tự động chuyển hướng toàn bộ truy cập từ HTTP sang HTTPS bảo mật.

---

## 6. HƯỚNG DẪN SỬ DỤNG DASHBOARD QUẢN TRỊ (HR ADMIN)

### 6.1. Đăng nhập lần đầu
1. Truy cập đường dẫn: `https://yourdomain.com/admin/login.html` (hoặc cổng 3000 ở môi trường localhost).
2. Nhập thông tin tài khoản được định nghĩa trong tệp `.env` (`ADMIN_USERNAME` và `ADMIN_PASSWORD`).
3. **Quan trọng:** Ngay sau khi đăng nhập thành công, hãy truy cập phần **⚙️ Cài đặt** hoặc tab **Công cụ** để thay đổi mật khẩu quản trị mặc định nhằm bảo mật hệ thống.

### 6.2. Cấu hình & Thiết kế đề thi
Hệ thống hỗ trợ 2 chế độ ra đề độc lập cho 2 nhóm vị trí: **Nhân viên (Staff - Level A2-B1)** và **Quản lý (Manager - Level B2-C1)**.
Tại tab **Ngân hàng & Cấu hình đề**:
- **Chế độ Ngẫu nhiên (Random):** Hệ thống tự động chọn ngẫu nhiên các bộ câu hỏi từ ngân hàng phù hợp với cấp độ vị trí của thí sinh mỗi khi bắt đầu làm bài.
- **Chế độ Cố định (Fixed):** Chọn cụ thể bài nghe, bài đọc và bài viết cố định cho kỳ thi. Mọi thí sinh thuộc vị trí đó sẽ nhận được đề thi giống hệt nhau.

### 6.3. Quản lý Ngân hàng câu hỏi
- **Xem danh sách câu hỏi:** Lọc theo các kỹ năng Listening, Reading, Writing và cấp độ (A1 đến C2).
- **Thêm/Sửa câu hỏi thủ công:** Nhập trực tiếp các trường thông tin (Mã câu hỏi, cấp độ, chủ đề, nội dung văn bản đoạn văn, câu hỏi, các lựa chọn A/B/C/D và đáp án đúng).
- **Nhập câu hỏi hàng loạt từ Excel (Import):**
  1. Chọn kỹ năng mong muốn.
  2. Bấm nút **Tải Template** ở góc phải để tải về tệp Excel mẫu đúng định dạng.
  3. Điền thông tin câu hỏi vào tệp Excel vừa tải.
  4. Bấm **Import Excel** để tải tệp lên. Hệ thống sẽ tự động kiểm tra cú pháp và tích hợp câu hỏi vào cơ sở dữ liệu.

### 6.4. Gửi link bài thi cho thí sinh
1. Vào tab **Công cụ** → mục **Gửi link bài thi**.
2. Nhập họ tên thí sinh, email ứng viên và chọn vị trí thi tương ứng (Staff hoặc Manager).
3. Bấm **Tạo link mời**. Hệ thống sẽ sinh ra một liên kết độc bản (Unique Link) chứa mã token. Mã này chỉ có hiệu lực thi một lần và hết hạn sau 7 ngày.
4. Bạn cũng có thể tải file mẫu Excel, điền danh sách ứng viên và tải lên mục **Tạo hàng loạt bằng file Excel** để sinh hàng trăm link mời thi cùng lúc.

### 6.5. Quản lý phiên thi và kết quả
- **Danh sách phiên thi:** Theo dõi trực tiếp các thí sinh đang làm bài (`in_progress`) hoặc đã hoàn thành (`submitted`).
- **Xem chi tiết bài làm:** Click vào thí sinh để xem thời gian làm bài, đáp án chi tiết từng câu trắc nghiệm, và nội dung bài tự luận viết.
- **Chấm điểm tự luận (Writing):**
  - Nếu đã cấu hình AI: Hệ thống tự động chấm điểm và phản hồi sau khi ứng viên nộp bài khoảng 10-15 giây.
  - Nếu chấm tay: HR click vào bài làm của ứng viên, đọc bài viết và chọn điểm số cùng nhận xét, sau đó lưu lại. Trạng thái sẽ cập nhật từ `pending_review` sang điểm số thực tế.
- **Xuất báo cáo:**
  - Xuất toàn bộ danh sách kết quả ra file Excel bằng nút **Xuất Excel**.
  - Xuất báo cáo kết quả thi cá nhân/tổng quan chuyên nghiệp ra định dạng PDF bằng nút **Xuất PDF**.

---

## 7. BẢO TRÌ & SAO LƯU HỆ THỐNG

### 7.1. Sao lưu Cơ sở dữ liệu
Toàn bộ dữ liệu của hệ thống (bao gồm danh sách câu hỏi cấu hình, tài khoản quản trị và kết quả thi của thí sinh) được lưu duy nhất trong file `exam.db` tại thư mục `/opt/vietravel-exam/data`.
Để sao lưu hệ thống, chỉ cần sao chép tệp tin này sang thiết bị lưu trữ an toàn:
```bash
tar -czvf db-backup-$(date +%F).tar.gz /opt/vietravel-exam/data/exam.db
```

### 7.2. Xem nhật ký hoạt động (Logs)
Nhật ký hoạt động của server giúp kiểm tra và phát hiện lỗi nhanh chóng:
```bash
# Xem log trực tiếp của ứng dụng
sudo journalctl -u vietravel-exam -f

# Xem log lỗi của Nginx
sudo tail -f /var/log/nginx/error.log
```

---

*Hệ thống được chuyển giao mới hoàn toàn, chúc quý bộ phận Nhân sự Vietravel vận hành thành công và hiệu quả!*
