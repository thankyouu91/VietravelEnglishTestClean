const express = require('express');
const db = require('../../lib/db');
const { signAdminToken, verifyPassword, adminRequired, audit, hashPassword, validatePasswordStrength } = require('../../lib/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const normUser = username.trim().toLowerCase();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(normUser);
  if (!admin) {
    await new Promise(r => setTimeout(r, 300));
    return res.status(401).json({ error: 'invalid_credentials', message: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
  }

  // Check account lockout
  if (admin.locked_until && admin.locked_until > Date.now()) {
    const minsLeft = Math.ceil((admin.locked_until - Date.now()) / (60 * 1000));
    return res.status(423).json({
      error: 'account_locked',
      message: `Tài khoản tạm thời bị khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${minsLeft} phút.`
    });
  }

  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) {
    const attempts = (admin.failed_login_attempts || 0) + 1;
    if (attempts >= 5) {
      const lockedUntil = Date.now() + 30 * 60 * 1000; // 30 minutes
      db.prepare('UPDATE admins SET failed_login_attempts = 0, locked_until = ? WHERE id = ?')
        .run(lockedUntil, admin.id);
      audit('admin.lockout', String(admin.id), { username: admin.username }, admin.username, req.ip);
      return res.status(423).json({
        error: 'account_locked',
        message: 'Tài khoản đã bị khóa 30 phút do nhập sai mật khẩu 5 lần.'
      });
    } else {
      db.prepare('UPDATE admins SET failed_login_attempts = ? WHERE id = ?')
        .run(attempts, admin.id);
      await new Promise(r => setTimeout(r, 300));
      return res.status(401).json({
        error: 'invalid_credentials',
        message: `Tên đăng nhập hoặc mật khẩu không đúng. Còn ${5 - attempts} lần thử.`
      });
    }
  }

  // Check if MFA/2FA is enabled
  if (admin.mfa_enabled === 1) {
    const jwt = require('jsonwebtoken');
    const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET;
    const tempToken = jwt.sign({ adminId: admin.id, t: 'mfa_pending' }, ADMIN_SECRET, { expiresIn: '5m' });
    return res.json({ mfaRequired: true, tempToken });
  }

  db.prepare('UPDATE admins SET last_login_at = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
    .run(Date.now(), admin.id);
  audit('admin.login', String(admin.id), null, admin.username, req.ip);

  const token = signAdminToken(admin.id);
  const secureCookie = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  
  // Set CSRF token cookie
  const { nanoid } = require('nanoid');
  const csrfToken = nanoid(32);
  res.cookie('admin_csrf', csrfToken, {
    httpOnly: false,
    sameSite: 'strict',
    secure: secureCookie,
    maxAge: 8 * 3600 * 1000,
  });

  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookie,
    maxAge: 8 * 3600 * 1000,
  });
  
  res.json({ ok: true, admin: { id: admin.id, username: admin.username, displayName: admin.display_name } });
});

router.post('/logout', (req, res) => {
  const secureCookie = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
  
  res.clearCookie('admin_csrf', {
    httpOnly: false,
    sameSite: 'strict',
    secure: secureCookie,
  });

  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookie,
  });
  res.json({ ok: true });
});

router.get('/me', adminRequired, (req, res) => res.json(req.admin));

router.post('/login/mfa-verify', async (req, res) => {
  const { code, tempToken } = req.body || {};
  if (!code || !tempToken) {
    return res.status(400).json({ error: 'missing_fields', message: 'Mã xác thực và token là bắt buộc.' });
  }

  const jwt = require('jsonwebtoken');
  const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET;
  const { verifyTOTP } = require('../../lib/totp');

  try {
    const decoded = jwt.verify(tempToken, ADMIN_SECRET);
    if (!decoded || decoded.t !== 'mfa_pending') {
      return res.status(401).json({ error: 'token_invalid', message: 'Token xác thực không hợp lệ hoặc đã hết hạn.' });
    }

    const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(decoded.adminId);
    if (!admin || !admin.mfa_secret || admin.mfa_enabled !== 1) {
      return res.status(401).json({ error: 'invalid_mfa_setup', message: 'Cấu hình MFA không hợp lệ.' });
    }

    if (admin.locked_until && admin.locked_until > Date.now()) {
      return res.status(423).json({ error: 'account_locked', message: 'Tài khoản đang bị khóa.' });
    }

    const verified = verifyTOTP(code, admin.mfa_secret);
    if (!verified) {
      return res.status(401).json({ error: 'invalid_mfa_code', message: 'Mã xác thực 2FA không chính xác.' });
    }

    db.prepare('UPDATE admins SET last_login_at = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(Date.now(), admin.id);
    audit('admin.login_mfa', String(admin.id), null, admin.username, req.ip);

    const token = signAdminToken(admin.id);
    const secureCookie = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

    const { nanoid } = require('nanoid');
    const csrfToken = nanoid(32);
    res.cookie('admin_csrf', csrfToken, {
      httpOnly: false,
      sameSite: 'strict',
      secure: secureCookie,
      maxAge: 8 * 3600 * 1000,
    });

    res.cookie('admin_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      maxAge: 8 * 3600 * 1000,
    });

    res.json({ ok: true, admin: { id: admin.id, username: admin.username, displayName: admin.display_name } });
  } catch (err) {
    res.status(401).json({ error: 'token_invalid', message: 'Token xác thực đã hết hạn hoặc không hợp lệ.' });
  }
});

router.post('/mfa/setup', adminRequired, (req, res) => {
  const { generateSecret } = require('../../lib/totp');
  const secret = generateSecret(16);
  
  db.prepare('UPDATE admins SET mfa_secret = ? WHERE id = ?').run(secret, req.admin.id);
  
  const qrCodeUrl = `otpauth://totp/VietravelHR:${encodeURIComponent(req.admin.username)}?secret=${secret}&issuer=VietravelHR`;
  res.json({ ok: true, secret, qrCodeUrl });
});

router.post('/mfa/enable', adminRequired, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code', message: 'Mã xác thực là bắt buộc.' });

  const admin = db.prepare('SELECT mfa_secret FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin || !admin.mfa_secret) {
    return res.status(400).json({ error: 'mfa_not_setup', message: 'Vui lòng thực hiện thiết lập MFA trước.' });
  }

  const { verifyTOTP } = require('../../lib/totp');
  const verified = verifyTOTP(code, admin.mfa_secret);
  if (!verified) {
    return res.status(400).json({ error: 'invalid_code', message: 'Mã xác thực không đúng.' });
  }

  db.prepare('UPDATE admins SET mfa_enabled = 1 WHERE id = ?').run(req.admin.id);
  audit('admin.mfa_enable', String(req.admin.id), null, req.admin.username, req.ip);
  res.json({ ok: true });
});

router.post('/mfa/disable', adminRequired, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'missing_code', message: 'Mã xác thực là bắt buộc.' });

  const admin = db.prepare('SELECT mfa_secret, mfa_enabled FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin || !admin.mfa_enabled) {
    return res.status(400).json({ error: 'mfa_not_enabled', message: 'MFA chưa được kích hoạt.' });
  }

  const { verifyTOTP } = require('../../lib/totp');
  const verified = verifyTOTP(code, admin.mfa_secret);
  if (!verified) {
    return res.status(400).json({ error: 'invalid_code', message: 'Mã xác thực không đúng.' });
  }

  db.prepare('UPDATE admins SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(req.admin.id);
  audit('admin.mfa_disable', String(req.admin.id), null, req.admin.username, req.ip);
  res.json({ ok: true });
});

router.post('/change-password', adminRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing_fields' });
  const pwErr = validatePasswordStrength(newPassword);
  if (pwErr) return res.status(400).json({ error: 'weak_password', message: pwErr });
  const { hashPassword } = require('../../lib/auth');
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  const ok = await verifyPassword(currentPassword, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'wrong_password', message: 'Mật khẩu hiện tại không đúng.' });
  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, req.admin.id);
  audit('admin.change_password', String(req.admin.id), null, req.admin.username, req.ip);
  res.json({ ok: true });
});

module.exports = router;
