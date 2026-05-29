const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../../lib/db');
const { adminRequired, audit } = require('../../lib/auth');

const router = express.Router();

// Staff+ may export the results list (PII export of candidates they can already view).
router.get('/export.xlsx', adminRequired, async (req, res) => {
  const status = req.query.status || null;
  const q      = req.query.q ? req.query.q.trim().toLowerCase() : null;
  const position = req.query.position || null;
  const startDate = req.query.startDate ? parseInt(req.query.startDate, 10) : null;
  const endDate   = req.query.endDate ? parseInt(req.query.endDate, 10) : null;

  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (position) { where.push('candidate_position = ?'); params.push(position); }
  if (startDate) { where.push('started_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('started_at <= ?'); params.push(endDate); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { decryptPII } = require('../../lib/crypto');

  let rows = db.prepare(`
    SELECT exam_id, candidate_name, candidate_email, position_label,
           is_management, started_at, submitted_at, elapsed_seconds,
           score_listening, score_reading, score_writing, score_total,
           cefr_level, cefr_status, status, cheat_events
      FROM sessions ${whereSql}
     ORDER BY COALESCE(submitted_at, started_at) DESC
  `).all(...params);

  rows = rows.map(r => ({
    ...r,
    candidate_name: decryptPII(r.candidate_name),
    candidate_email: decryptPII(r.candidate_email)
  }));

  if (q) {
    rows = rows.filter(r => 
      r.candidate_name.toLowerCase().includes(q) ||
      r.candidate_email.toLowerCase().includes(q) ||
      r.exam_id.toLowerCase().includes(q)
    );
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vietravel HR';
  const ws = wb.addWorksheet('Exam Results');

  ws.columns = [
    { header: 'Mã thi',         key: 'exam_id',           width: 22 },
    { header: 'Họ và tên',      key: 'candidate_name',    width: 28 },
    { header: 'Email',          key: 'candidate_email',   width: 30 },
    { header: 'Vị trí',         key: 'position_label',    width: 26 },
    { header: 'Cấp QL',         key: 'is_management',     width: 8  },
    { header: 'Bắt đầu',        key: 'started_at',        width: 20 },
    { header: 'Nộp bài',        key: 'submitted_at',      width: 20 },
    { header: 'Thời gian (s)',  key: 'elapsed_seconds',   width: 12 },
    { header: 'Listening /10',  key: 'score_listening',   width: 12 },
    { header: 'Reading /10',    key: 'score_reading',     width: 12 },
    { header: 'Writing /10',    key: 'score_writing',     width: 12 },
    { header: 'Tổng /30',       key: 'score_total',       width: 10 },
    { header: 'CEFR',           key: 'cefr_level',        width: 8  },
    { header: 'Kết quả',        key: 'cefr_status',       width: 12 },
    { header: 'Trạng thái',     key: 'status',            width: 14 },
    { header: 'Chuyển tab (lần)', key: 'cheat_events',    width: 18 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const fmt = (ts) => ts ? new Date(ts).toLocaleString('vi-VN') : '';
  rows.forEach(r => {
    ws.addRow({
      ...r,
      is_management: r.is_management ? 'Có' : 'Không',
      started_at:    fmt(r.started_at),
      submitted_at:  fmt(r.submitted_at),
    });
  });

  audit('admin.export', null, { rows: rows.length }, req.admin.username, req.ip);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="vietravel-exam-${new Date().toISOString().slice(0,10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
