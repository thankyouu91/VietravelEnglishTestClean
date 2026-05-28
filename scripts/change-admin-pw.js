/**
 * Change admin password to a strong random one
 * Run: node scripts/change-admin-pw.js
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../src/lib/db');
const { hashPassword } = require('../src/lib/auth');

(async () => {
  const newPassword = crypto.randomBytes(16).toString('base64url');
  const username = process.env.ADMIN_USERNAME || 'admin';

  const admin = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (!admin) {
    console.error(`Admin "${username}" not found`);
    process.exit(1);
  }

  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hash, username);

  // Update .env file
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  envContent = envContent.replace(/ADMIN_PASSWORD=.*/, `ADMIN_PASSWORD=${newPassword}`);
  fs.writeFileSync(envPath, envContent);

  console.log('═══════════════════════════════════════');
  console.log('  ✅ Admin password changed!');
  console.log(`  Username: ${username}`);
  console.log(`  New password: ${newPassword}`);
  console.log('');
  console.log('  ⚠️  SAVE THIS PASSWORD SECURELY!');
  console.log('  It will not be shown again.');
  console.log('═══════════════════════════════════════');
})().catch(e => { console.error(e); process.exit(1); });
