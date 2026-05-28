/**
 * Reset admin password — run once via: node scripts/reset-password.js
 * Uses ADMIN_USERNAME + ADMIN_PASSWORD env vars
 */
require('dotenv').config();
const db = require('../src/lib/db');
const { hashPassword } = require('../src/lib/auth');

(async () => {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    console.error('❌ ADMIN_PASSWORD env var is required');
    process.exit(1);
  }

  const admin = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (!admin) {
    console.error(`❌ Admin "${username}" not found`);
    process.exit(1);
  }

  const hash = await hashPassword(password);
  db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hash, username);
  console.log(`✓ Password reset for "${username}"`);
})().catch(e => { console.error(e); process.exit(1); });
