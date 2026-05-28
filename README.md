# Vietravel English Test — Railway Deployment Package

Package này deploy-and-go trên [Railway](https://railway.com/).
3 cách deploy, chọn 1:

| Cách | Phù hợp khi | Thời gian |
|---|---|---|
| **A. Railway CLI** | Đã cài CLI, deploy trực tiếp từ folder này | 3 phút |
| **B. GitHub → Railway** | Muốn auto-deploy mỗi khi push | 5 phút |
| **C. Empty Service + Volume** | Chỉ test nhanh, không cần git | 5 phút |

---

## 🚀 Cách A — Railway CLI (nhanh nhất)

### 1. Cài Railway CLI (1 lần)
```bash
# macOS
brew install railway

# Linux / Windows / WSL
npm install -g @railway/cli
```

### 2. Login + tạo project
```bash
cd vietravel-exam
railway login          # mở browser xác thực
railway init           # chọn "Empty Project", đặt tên
```

### 3. Khai báo biến môi trường
```bash
railway variables --set "JWT_SECRET=$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
railway variables --set "ADMIN_JWT_SECRET=$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
railway variables --set "ADMIN_PASSWORD=Vietravel2026!ChangeMe"
railway variables --set "ADMIN_USERNAME=admin"
railway variables --set "NODE_ENV=production"
railway variables --set "DATA_DIR=/app/data"
```

### 4. Mount volume (lưu DB qua restart)
```bash
railway volume add --mount-path /app/data
```

### 5. Deploy
```bash
railway up
```

### 6. Lấy URL
```bash
railway domain        # tạo subdomain *.up.railway.app
```

Mở `https://<your-url>/admin/login.html` → login với username/password đã set ở bước 3.

---

## 🌐 Cách B — Deploy từ GitHub

### 1. Đẩy folder này lên GitHub
```bash
cd vietravel-exam
git init && git add . && git commit -m "Vietravel English Test"
# Tạo repo trên github.com rồi:
git remote add origin git@github.com:<your-org>/vietravel-exam.git
git push -u origin main
```

### 2. Trên Railway dashboard
1. **New Project** → **Deploy from GitHub repo**
2. Authorize Railway → chọn repo vừa tạo
3. Railway tự build với Nixpacks (đã có `nixpacks.toml`)
4. Vào **Variables** → thêm các biến ở `.env.example`
5. Vào **Settings** → **Volumes** → **+ New Volume** → mount path: `/app/data`
6. **Generate Domain** ở tab **Settings** → **Networking**

### 3. Kết quả
Truy cập `https://<your-name>.up.railway.app/admin/login.html`.

---

## 📦 Cách C — Upload qua Railway dashboard (không cần git)

Railway không hỗ trợ upload ZIP trực tiếp qua UI. Cách work-around:

1. Tạo repo trống trên GitHub (private cũng được)
2. Push folder này lên repo đó (xem Cách B bước 1)
3. Tiếp tục theo Cách B từ bước 2

Hoặc dùng **Railway Template** nếu bạn muốn chia sẻ deploy 1-click với người khác — xem [docs.railway.com/guides/create-a-template](https://docs.railway.com/guides/create-a-template).

---

## ⚙️ Biến môi trường — phải set

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `JWT_SECRET` | ✅ | Secret ký token exam (≥ 32 chars random) |
| `ADMIN_JWT_SECRET` | ✅ | Secret ký cookie admin (KHÁC `JWT_SECRET`) |
| `ADMIN_PASSWORD` | ✅ | Password admin đầu tiên (≥ 10 chars) |
| `ADMIN_USERNAME` | ⏺️ | Mặc định: `admin` |
| `DATA_DIR` | ✅ | Đường dẫn volume: `/app/data` |
| `NODE_ENV` | ⏺️ | Đặt `production` |
| `ALLOWED_ORIGINS` | ⏺️ | Nếu frontend ở domain khác, vd `https://exam.vietravel.com` |
| `EXAM_DURATION_SEC` | ⏺️ | Mặc định 1800 (30 phút) |
| `MAX_LISTENS_PER_AUDIO` | ⏺️ | Mặc định 2 |
| `PORT` | ❌ | Railway tự set, không cần khai báo |

**Tạo secret nhanh:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 💾 Tại sao cần Volume?

App dùng **SQLite** (`data/exam.db`) để lưu kết quả thi. Railway container ephemeral — không có volume thì DB mất sau mỗi deploy.

Volume Railway:
- **Free plan**: 0.5 GB miễn phí
- **Hobby plan**: 5 GB
- Mount path khuyến nghị: `/app/data` (khớp với `DATA_DIR`)

---

## 🧪 Test sau khi deploy

```bash
URL="https://<your-app>.up.railway.app"

# 1. Health
curl $URL/health
# {"ok":true,"ts":...,"db":true}

# 2. Tạo phiên thi
curl -X POST $URL/api/exam/start -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"t@vt.com","position":"staff_field","consent":true}'

# 3. Admin login
curl -X POST $URL/admin/api/login -H "Content-Type: application/json" \
  -c cookies.txt -d "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}"

# 4. Stats
curl -b cookies.txt $URL/admin/api/stats
```

Sau đó mở `$URL/admin/login.html` trên browser.

---

## 📁 Cấu trúc package

```
vietravel-exam/
├── server.js                Express entry point
├── package.json
├── railway.json             Railway-specific build/deploy config
├── nixpacks.toml            Build deps (Python, gcc cho better-sqlite3)
├── Dockerfile               Tùy chọn — dùng nếu Railway Builder = Dockerfile
├── .env.example             Mẫu biến môi trường
├── .gitignore
├── README.md                File này
│
├── src/
│   ├── lib/
│   │   ├── db.js            SQLite (DATA_DIR-aware)
│   │   ├── auth.js          JWT + bcrypt + audit log
│   │   ├── scoring.js       Sample/shield/score + CEFR
│   │   └── bank.js          Loader cho banks.json
│   └── routes/
│       ├── exam.js          POST /start /listen /submit
│       ├── audio.js         Stream audio có token check
│       └── admin.js         Admin API + Excel export
│
├── public/
│   ├── index.html           Landing page (status board)
│   ├── admin/               Admin Dashboard SPA
│   │   ├── login.html
│   │   ├── index.html
│   │   ├── admin.css
│   │   └── admin.js
│   ├── audio/               10 file MP3 (l1c…l10c.mp3)
│   └── audio_enc/           10 file .vta (XOR-encrypted)
│
├── scripts/
│   ├── init.js              Auto-seed admin lần đầu (chạy trong CMD)
│   ├── seed.js              Manual seed (npm run seed)
│   └── migrate-bank.js      Trích bank từ HTML gốc
│
└── data/
    ├── banks.json           Ngân hàng 176 câu (đã pre-migrate)
    └── sample-bank.json     Bank mẫu (fallback)
```

---

## 🔄 Migrate sang Postgres (khi cần scale)

SQLite phù hợp ≤ 10K sessions/tháng. Khi cần scale:

1. Tab **+ New** → **Database** → **Add PostgreSQL** trên Railway
2. Service exam tự nhận biến `DATABASE_URL`
3. Thay `better-sqlite3` bằng `pg` trong `src/lib/db.js`
4. Convert schema DDL sang Postgres syntax
5. Migrate data: `sqlite3 exam.db .dump | psql $DATABASE_URL`

---

## 🆘 Troubleshooting

### Build fail: `better-sqlite3 native binding`
→ Kiểm tra `nixpacks.toml` có Python + gcc, hoặc đổi sang Dockerfile builder.

### Health check fail
→ Tăng `healthcheckTimeout` trong `railway.json` lên 120.

### Admin password không đăng nhập được
→ Vào logs xem `[init]`:
```bash
railway logs
```
Phải thấy `✓ Bootstrapped admin "admin"`. Nếu không thấy → có thể DB đã có admin cũ, dùng password cũ hoặc xóa volume + redeploy.

### DB mất sau deploy
→ Chưa mount volume! Vào **Settings** → **Volumes** → mount tại `/app/data` và đảm bảo `DATA_DIR=/app/data`.

---

## 📞 Hỗ trợ

- Railway docs: https://docs.railway.com
- Issue về app này: tạo issue trên repo GitHub của Vietravel
