const express = require('express');
const ExcelJS = require('exceljs');
const { nanoid } = require('nanoid');
const db = require('../../lib/db');
const { adminRequired, requireRole, audit } = require('../../lib/auth');

const router = express.Router();

router.get('/invitations', adminRequired, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const status = req.query.status || null;

  const where = []; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT * FROM invitations ${whereSql}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM invitations ${whereSql}`).get(...params).c;
  res.json({ rows, total });
});

router.post('/invitations', adminRequired, (req, res) => {
  const { name, email, position, message, expiresInHours } = req.body || {};
  if (!email) return res.status(400).json({ error: 'missing_email' });

  const id = nanoid(12);
  const now = Date.now();
  const expiresAt = expiresInHours ? now + expiresInHours * 3600 * 1000 : now + 7 * 24 * 3600 * 1000; // default 7 days

  db.prepare(`
    INSERT INTO invitations (id, name, email, position, message, created_by, created_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, name || null, email, position || null, message || null, req.admin.username, now, expiresAt);

  audit('admin.create_invitation', id, { email, position }, req.admin.username, req.ip);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/exam/?invite=${id}`;

  res.json({ ok: true, id, link, expiresAt });
});

router.delete('/invitations/:id', adminRequired, requireRole('manager'), (req, res) => {
  const row = db.prepare('SELECT id FROM invitations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM invitations WHERE id = ?').run(req.params.id);
  audit('admin.delete_invitation', req.params.id, null, req.admin.username, req.ip);
  res.json({ ok: true });
});

// Public endpoint — validate invitation (no auth needed)
router.get('/invitation-check/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found', message: 'Link mời không hợp lệ.' });
  if (row.status === 'used') return res.status(410).json({ error: 'already_used', message: 'Link mời đã được sử dụng.' });
  if (row.expires_at && Date.now() > row.expires_at) return res.status(410).json({ error: 'expired', message: 'Link mời đã hết hạn.' });

  const maskEmail = (email) => {
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    if (local.length <= 2) return local[0] + '***@' + domain;
    return local[0] + '***' + local[local.length - 1] + '@' + domain;
  };
  
  const maskName = (name) => {
    if (!name) return '';
    return name.split(' ').map(w => w.length <= 1 ? w : w[0] + '***').join(' ');
  };

  res.json({ ok: true, name: maskName(row.name), email: maskEmail(row.email), position: row.position, message: row.message });
});

// Mark invitation as used (called by exam start, legacy endpoint)
router.post('/invitation-use/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  // We no longer allow updating the invitation status from this unauthenticated public endpoint.
  // It is updated atomically inside `/api/exam/start`.
  if (row.status === 'used') {
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: 'invalid_action', message: 'Mã mời chỉ có thể kích hoạt thông qua việc bắt đầu bài thi.' });
});

// ── GET /invitations/template — Excel Bulk Invite Template ──
router.get('/invitations/template', adminRequired, requireRole('manager'), async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Invitations');
    
    // Set headers
    ws.getCell('A1').value = 'Họ và tên';
    ws.getCell('B1').value = 'Email';
    ws.getCell('C1').value = 'Vị trí (staff hoặc manager)';
    
    // Add sample rows
    ws.getCell('A2').value = 'Nguyễn Văn A';
    ws.getCell('B2').value = 'nguyenvana@vietravel.com';
    ws.getCell('C2').value = 'staff';

    ws.getCell('A3').value = 'Trần Thị B';
    ws.getCell('B3').value = 'tranthib@vietravel.com';
    ws.getCell('C3').value = 'manager';

    // Style headers
    ws.getRow(1).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 25;
    ws.getColumn(1).width = 25;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 30;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="vietravel_invite_template.xlsx"');
    
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'template_generation_failed', message: err.message });
  }
});

// ── POST /invitations/bulk — Bulk Create Invitations ────────
router.post('/invitations/bulk', adminRequired, requireRole('manager'), express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.body);
    
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'invalid_excel', message: 'Tệp Excel không có worksheet nào.' });

    const invitations = [];
    const errors = [];
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 3600 * 1000; // default 7 days
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header
      try {
        const name = String(row.getCell(1).value || '').trim();
        const email = String(row.getCell(2).value || '').trim().toLowerCase();
        let position = String(row.getCell(3).value || '').trim().toLowerCase();

        if (!email) return; // skip empty rows
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          errors.push(`Dòng ${rowNum}: Email "${email}" không đúng định dạng.`);
          return;
        }

        // Standardize position
        if (position.includes('quản lý') || position.includes('manager') || position.includes('mgmt')) {
          position = 'manager';
        } else {
          position = 'staff';
        }

        const id = nanoid(12);
        db.prepare(`
          INSERT INTO invitations (id, name, email, position, message, created_by, created_at, expires_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `).run(id, name || null, email, position, null, req.admin.username, now, expiresAt);

        const link = `${baseUrl}/exam/?invite=${id}`;
        invitations.push({ id, name, email, position, link });
      } catch (e) {
        errors.push(`Dòng ${rowNum}: ${e.message}`);
      }
    });

    audit('admin.bulk_create_invitation', null, { count: invitations.length, errors: errors.length }, req.admin.username, req.ip);

    res.json({ ok: true, createdCount: invitations.length, invitations, errors });
  } catch (e) {
    res.status(400).json({ error: 'import_failed', message: e.message });
  }
});

module.exports = router;
