/**
 * Auto-init script — runs once on each container start.
 *
 * Behavior:
 * 1. Ensure DATA_DIR exists (Railway volume or local ./data)
 * 2. Copy bank files from /app/seed/ into DATA_DIR if missing.
 *    NOTE: When Railway mounts a volume at DATA_DIR (/app/data), it hides the
 *    original data/ directory in the image. So bank files are bundled into
 *    /app/seed/ (a separate directory not affected by the volume mount) and
 *    copied into DATA_DIR on every cold start if not already present.
 * 3. Create the first admin from ADMIN_USERNAME + ADMIN_PASSWORD env vars
 *    if no admin exists yet. Skip if any admin already present.
 *
 * Designed to be idempotent — safe to run on every restart.
 */
const fs   = require('fs');
const path = require('path');

require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Seed directory is /app/seed/ — bundled in the image, never hidden by volume.
// Falls back to the repo's data/ directory for local dev (no volume).
const SEED_DIR = path.join(__dirname, '..', 'seed');

function seedFile(filename) {
  const dest = path.join(DATA_DIR, filename);
  if (fs.existsSync(dest)) return; // already seeded

  // Try seed/ dir first (production image), then data/ (local dev)
  const candidates = [
    path.join(SEED_DIR, filename),
    path.join(__dirname, '..', 'data', filename),
  ];
  for (const src of candidates) {
    if (fs.existsSync(src) && path.resolve(src) !== path.resolve(dest)) {
      fs.copyFileSync(src, dest);
      console.log(`[init] Seeded ${filename} → ${dest}`);
      return;
    }
  }
  console.warn(`[init] ⚠ Could not find seed source for ${filename}`);
}

seedFile('banks.json');
seedFile('sample-bank.json');

(async () => {
  const db = require('../src/lib/db');
  const { hashPassword } = require('../src/lib/auth');

  const username    = process.env.ADMIN_USERNAME     || process.env.SEED_ADMIN_USERNAME     || 'admin';
  const password    = process.env.ADMIN_PASSWORD     || process.env.SEED_ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME || process.env.SEED_ADMIN_DISPLAY_NAME || 'HR Admin';

  const count = db.prepare('SELECT COUNT(*) c FROM admins').get().c;

  if (count > 0) {
    // Admin exists — only sync password from env if SYNC_ADMIN_PASSWORD=true is set
    if (password && process.env.SYNC_ADMIN_PASSWORD === 'true') {
      const hash = await hashPassword(password);
      db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hash, username);
      console.log(`[init] ✓ Password synced for "${username}" from env (forced by SYNC_ADMIN_PASSWORD).`);
    } else {
      console.log(`[init] Admins already exist (${count}). Skip password sync.`);
    }
    process.exit(0);
  }

  // First-time bootstrap
  if (!password) {
    console.error('[init] ❌ ADMIN_PASSWORD env var is required to bootstrap the first admin.');
    console.error('       Set ADMIN_PASSWORD on Railway → Variables and redeploy.');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const info = db.prepare(`
    INSERT INTO admins (username, password_hash, display_name, created_at)
    VALUES (?, ?, ?, ?)
  `).run(username, hash, displayName, Date.now());

  console.log(`[init] ✓ Bootstrapped admin "${username}" (id=${info.lastInsertRowid})`);
})().catch(e => { console.error('[init] error:', e); process.exit(1); });
