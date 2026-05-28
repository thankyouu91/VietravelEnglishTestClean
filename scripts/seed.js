require('dotenv').config();
const db = require('../src/lib/db');
const { hashPassword } = require('../src/lib/auth');

async function main() {
  const username    = process.env.SEED_ADMIN_USERNAME     || 'admin';
  const password    = process.env.SEED_ADMIN_PASSWORD;
  const displayName = process.env.SEED_ADMIN_DISPLAY_NAME || 'HR Admin';

  if (!password) {
    console.error('⚠️  Cần SEED_ADMIN_PASSWORD trong .env trước khi chạy seed.');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('⚠️  SEED_ADMIN_PASSWORD phải dài tối thiểu 10 ký tự.');
    process.exit(1);
  }

  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) {
    console.log(`✓ Admin "${username}" đã tồn tại (id=${existing.id}). Không tạo mới.`);
    process.exit(0);
  }

  const hash = await hashPassword(password);
  const info = db.prepare(`
    INSERT INTO admins (username, password_hash, display_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(username, hash, displayName, Date.now());

  console.log(`✓ Tạo admin thành công:`);
  console.log(`   username      : ${username}`);
  console.log(`   display name  : ${displayName}`);
  console.log(`   id            : ${info.lastInsertRowid}`);
  console.log(`   → Đăng nhập tại /admin/login.html`);
}

main().catch(e => { console.error(e); process.exit(1); });
