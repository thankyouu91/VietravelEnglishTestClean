const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { nanoid } = require('nanoid');
const db = require('./db');

const EXAM_SECRET  = process.env.JWT_SECRET;
const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET;

// Fail fast on missing/weak secrets in ALL environments. Never fall back to a
// hardcoded default — a known secret lets anyone forge a valid admin token.
if (!EXAM_SECRET || !ADMIN_SECRET || EXAM_SECRET.length < 32 || ADMIN_SECRET.length < 32) {
  console.error('[auth] ❌ JWT_SECRET và ADMIN_JWT_SECRET là bắt buộc và phải dài tối thiểu 32 ký tự ngẫu nhiên.');
  console.error('       Tạo bằng: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

function signExamToken(payload, ttlSec) {
  return jwt.sign(payload, EXAM_SECRET, { expiresIn: ttlSec });
}
function verifyExamToken(token) {
  try { return jwt.verify(token, EXAM_SECRET); }
  catch (e) { return null; }
}

function signAdminToken(adminId) {
  return jwt.sign({ adminId, t: 'admin' }, ADMIN_SECRET, { expiresIn: '8h' });
}
function verifyAdminToken(token) {
  try { return jwt.verify(token, ADMIN_SECRET); }
  catch (e) { return null; }
}

function genExamId() {
  const date = new Date();
  const ymd  = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
  const id   = nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  return `VTV-${ymd}-${id}`;
}

// Returns an error message string if the password is too weak, or null if OK.
function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 12) {
    return 'Mật khẩu phải dài tối thiểu 12 ký tự.';
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'Mật khẩu phải chứa cả chữ và số.';
  }
  return null;
}

async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}
async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

function adminRequired(req, res, next) {
  const token = req.cookies?.admin_session;
  if (!token) return res.status(401).json({ error: 'auth_required' });
  const decoded = verifyAdminToken(token);
  if (!decoded) return res.status(401).json({ error: 'auth_invalid' });
  const admin = db.prepare('SELECT id, username, display_name, role FROM admins WHERE id = ?').get(decoded.adminId);
  if (!admin) return res.status(401).json({ error: 'auth_invalid' });
  req.admin = admin;
  next();
}

function audit(action, target, detail, actor, ipAddress) {
  try {
    const crypto = require('crypto');
    // Fetch last row to get its row_hash
    const lastRow = db.prepare('SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1').get();
    const prevHash = lastRow ? lastRow.row_hash : 'genesis';

    const ts = Date.now();
    const actorStr = actor || '';
    const targetStr = target || '';
    const detailStr = detail ? JSON.stringify(detail) : '';
    const ipStr = ipAddress || '';

    // Calculate cryptographic HMAC hash for integrity chaining
    const hashInput = `${ts}|${actorStr}|${action}|${targetStr}|${detailStr}|${ipStr}|${prevHash}`;
    const rowHash = crypto.createHmac('sha256', ADMIN_SECRET).update(hashInput).digest('hex');

    db.prepare(
      'INSERT INTO audit_log (ts, actor, action, target, detail, ip_address, prev_hash, row_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(ts, actor || null, action, target || null, detail ? JSON.stringify(detail) : null, ipAddress || null, prevHash, rowHash);
  } catch (e) {
    console.error('[audit] Failed to write audit log:', e.message);
  }
}

function verifyAuditLogChain() {
  const crypto = require('crypto');
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all();
  let expectedPrevHash = 'genesis';
  for (const r of rows) {
    const detailStr = r.detail ? r.detail : '';
    const hashInput = `${r.ts}|${r.actor || ''}|${r.action}|${r.target || ''}|${r.detail_str || detailStr}|${r.ip_address || ''}|${expectedPrevHash}`;
    const rowHash = crypto.createHmac('sha256', ADMIN_SECRET).update(hashInput).digest('hex');
    if (rowHash !== r.row_hash) {
      return { ok: false, failedId: r.id };
    }
    expectedPrevHash = r.row_hash;
  }
  return { ok: true };
}

// Access tiers, lowest → highest. Higher tiers inherit all lower-tier rights.
const ROLE_LEVEL = { staff: 1, manager: 2, admin: 3 };

// Middleware factory: require the caller's role to be at least `minRole`.
function requireRole(minRole) {
  const min = ROLE_LEVEL[minRole] || 99;
  return (req, res, next) => {
    const level = ROLE_LEVEL[req.admin?.role] || 0;
    if (level < min) {
      return res.status(403).json({ error: 'forbidden', message: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

function requireAdminRole(req, res, next) {
  return requireRole('admin')(req, res, next);
}

module.exports = {
  signExamToken, verifyExamToken,
  signAdminToken, verifyAdminToken,
  genExamId, hashPassword, verifyPassword, validatePasswordStrength,
  adminRequired, requireAdminRole, requireRole, ROLE_LEVEL, audit, verifyAuditLogChain,
};
