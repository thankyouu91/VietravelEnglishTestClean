const express = require('express');
const db = require('../../lib/db');
const { adminRequired, requireAdminRole, audit, hashPassword, validatePasswordStrength } = require('../../lib/auth');

const router = express.Router();

router.get('/users', adminRequired, requireAdminRole, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, created_at, last_login_at FROM admins ORDER BY created_at DESC').all();
  res.json({ ok: true, users });
});

router.post('/users', adminRequired, requireAdminRole, async (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'missing_fields', message: 'Tài khoản, mật khẩu và quyền là bắt buộc.' });
  }
  if (!['admin', 'manager', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'invalid_role', message: 'Quyền không hợp lệ.' });
  }
  const pwErr = validatePasswordStrength(password);
  if (pwErr) return res.status(400).json({ error: 'weak_password', message: pwErr });

  try {
    const hash = await hashPassword(password);
    db.prepare(`
      INSERT INTO admins (username, password_hash, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(username.trim().toLowerCase(), hash, displayName || null, role, Date.now());
    
    audit('admin.create_user', username, { role }, req.admin.username, req.ip);
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'username_taken', message: 'Tên tài khoản đã tồn tại.' });
    }
    res.status(500).json({ error: 'create_failed', message: 'Tạo tài khoản thất bại do lỗi hệ thống.' });
  }
});

router.delete('/users/:id', adminRequired, requireAdminRole, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'invalid_id' });

  if (id === req.admin.id) {
    return res.status(400).json({ error: 'cannot_delete_self', message: 'Bạn không thể tự xóa tài khoản của chính mình.' });
  }

  const row = db.prepare('SELECT username FROM admins WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  audit('admin.delete_user', row.username, null, req.admin.username, req.ip);
  res.json({ ok: true });
});

module.exports = router;
