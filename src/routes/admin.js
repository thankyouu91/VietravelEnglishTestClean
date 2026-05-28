const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../lib/db');
const bank = require('../lib/bank');
const { calcCEFR } = require('../lib/scoring');
const { signAdminToken, verifyPassword, adminRequired, requireAdminRole, requireRole, audit, hashPassword, validatePasswordStrength } = require('../lib/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin) {
    await new Promise(r => setTimeout(r, 300));
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  db.prepare('UPDATE admins SET last_login_at = ? WHERE id = ?').run(Date.now(), admin.id);
  audit('admin.login', String(admin.id), null, admin.username, req.ip);

  const token = signAdminToken(admin.id);
  const secureCookie = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
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
  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookie,
  });
  res.json({ ok: true });
});

router.get('/me', adminRequired, (req, res) => res.json(req.admin));

router.get('/sessions', adminRequired, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const status = req.query.status || null;
  const q      = req.query.q ? `%${req.query.q}%` : null;
  const position = req.query.position || null;
  const startDate = req.query.startDate ? parseInt(req.query.startDate, 10) : null;
  const endDate   = req.query.endDate ? parseInt(req.query.endDate, 10) : null;

  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (position) { where.push('candidate_position = ?'); params.push(position); }
  if (startDate) { where.push('started_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('started_at <= ?'); params.push(endDate); }
  if (q) {
    where.push('(candidate_name LIKE ? OR candidate_email LIKE ? OR exam_id LIKE ?)');
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT id, exam_id, candidate_name, candidate_email, position_label,
           started_at, submitted_at, elapsed_seconds,
           score_total, score_listening, score_reading, score_writing,
           cefr_level, cefr_status, status, cheat_events
      FROM sessions ${whereSql}
     ORDER BY COALESCE(submitted_at, started_at) DESC
     LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) AS c FROM sessions ${whereSql}`).get(...params).c;
  res.json({ rows, total, limit, offset });
});

router.get('/sessions/:id', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  try { row.question_ids = JSON.parse(row.question_ids || '{}'); } catch {}
  try { row.answers      = JSON.parse(row.answers || '{}'); } catch {}
  try { row.audio_listens = JSON.parse(row.audio_listens || '{}'); } catch {}
  res.json(row);
});

router.get('/stats', adminRequired, (req, res) => {
  const total     = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  const submitted = db.prepare("SELECT COUNT(*) c FROM sessions WHERE status='submitted'").get().c;
  const inProgress= db.prepare("SELECT COUNT(*) c FROM sessions WHERE status='in_progress'").get().c;
  const passed    = db.prepare("SELECT COUNT(*) c FROM sessions WHERE cefr_status='pass'").get().c;
  const review    = db.prepare("SELECT COUNT(*) c FROM sessions WHERE cefr_status='review'").get().c;
  const failed    = db.prepare("SELECT COUNT(*) c FROM sessions WHERE cefr_status='fail'").get().c;
  const avg = db.prepare(`
    SELECT AVG(score_total) avg_total,
           AVG(score_listening) avg_l,
           AVG(score_reading) avg_r,
           AVG(score_writing) avg_w
      FROM sessions WHERE status='submitted'
  `).get();
  const cefrDist = db.prepare(`
    SELECT cefr_level, COUNT(*) as c
      FROM sessions WHERE status='submitted' AND cefr_level IS NOT NULL
     GROUP BY cefr_level ORDER BY cefr_level
  `).all();
  const today = db.prepare(`
    SELECT COUNT(*) as c FROM sessions
     WHERE started_at >= ?
  `).get(Date.now() - 24 * 3600 * 1000).c;
  const avgTime = db.prepare(`
    SELECT AVG(elapsed_seconds) as avg_sec
      FROM sessions WHERE status='submitted' AND elapsed_seconds IS NOT NULL
  `).get();
  res.json({ total, submitted, inProgress, passed, review, failed, avg, cefrDist, today, avgTime: avgTime?.avg_sec || null });
});

// Staff+ may export the results list (PII export of candidates they can already view).
router.get('/export.xlsx', adminRequired, async (req, res) => {
  const status = req.query.status || null;
  const q      = req.query.q ? `%${req.query.q}%` : null;
  const position = req.query.position || null;
  const startDate = req.query.startDate ? parseInt(req.query.startDate, 10) : null;
  const endDate   = req.query.endDate ? parseInt(req.query.endDate, 10) : null;

  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (position) { where.push('candidate_position = ?'); params.push(position); }
  if (startDate) { where.push('started_at >= ?'); params.push(startDate); }
  if (endDate) { where.push('started_at <= ?'); params.push(endDate); }
  if (q) {
    where.push('(candidate_name LIKE ? OR candidate_email LIKE ? OR exam_id LIKE ?)');
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT exam_id, candidate_name, candidate_email, position_label,
           is_management, started_at, submitted_at, elapsed_seconds,
           score_listening, score_reading, score_writing, score_total,
           cefr_level, cefr_status, status, cheat_events
      FROM sessions ${whereSql}
     ORDER BY COALESCE(submitted_at, started_at) DESC
  `).all(...params);

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

router.get('/audit', adminRequired, requireAdminRole, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = db.prepare(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`).all(limit);
  res.json({ rows });
});

// ── Item bank authoring ────────────────────────────────────────────────────
//
// All write routes mutate data/banks.json directly and the bank module's
// in-memory cache, then log to audit_log. Reads serve from the cache so they
// reflect writes immediately.

router.get('/items', adminRequired, requireAdminRole, (req, res) => {
  const bankName = req.query.bank;
  const track    = req.query.track;
  const level    = req.query.level || null;
  const topic    = req.query.topic ? String(req.query.topic).toLowerCase() : null;
  const search   = req.query.q ? String(req.query.q).toLowerCase() : null;

  try {
    if (!bankName || !track) {
      const banks = bank.loadBanks();
      const summary = {};
      for (const b of bank.VALID_BANKS) {
        summary[b] = {};
        for (const t of bank.VALID_TRACKS) {
          summary[b][t] = (banks[b]?.[t] || []).length;
        }
      }
      return res.json({ summary });
    }

    let items = bank.listItems(bankName, track);
    if (level) items = items.filter((it) => it.level === level);
    if (topic) items = items.filter((it) => (it.topic || '').toLowerCase().includes(topic));
    if (search) {
      items = items.filter((it) => {
        const hay = [it.id, it.question, it.passage, it.prompt, it.topic, it.transcript]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(search);
      });
    }
    res.json({ bank: bankName, track, count: items.length, items });
  } catch (err) {
    res.status(400).json({ error: 'list_failed', message: err.message });
  }
});

router.get('/items/:bank/:track/:id', adminRequired, requireAdminRole, (req, res) => {
  try {
    const item = bank.getItem(req.params.bank, req.params.track, req.params.id);
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json({ item });
  } catch (err) {
    res.status(400).json({ error: 'get_failed', message: err.message });
  }
});

router.post('/items/:bank/:track', adminRequired, requireAdminRole, (req, res) => {
  try {
    const result = bank.upsertItem(req.params.bank, req.params.track, req.body || {});
    audit('item.' + result.mode, `${req.params.bank}.${req.params.track}.${result.item.id}`,
      { topic: result.item.topic, level: result.item.level }, req.admin.username, req.ip);
    res.status(result.mode === 'created' ? 201 : 200).json(result);
  } catch (err) {
    res.status(400).json({ error: 'upsert_failed', message: err.message });
  }
});

router.put('/items/:bank/:track/:id', adminRequired, requireAdminRole, (req, res) => {
  try {
    const payload = { ...(req.body || {}), id: req.params.id };
    const result = bank.upsertItem(req.params.bank, req.params.track, payload);
    audit('item.updated', `${req.params.bank}.${req.params.track}.${req.params.id}`,
      { topic: result.item.topic, level: result.item.level }, req.admin.username, req.ip);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'update_failed', message: err.message });
  }
});

router.delete('/items/:bank/:track/:id', adminRequired, requireAdminRole, (req, res) => {
  try {
    const result = bank.removeItem(req.params.bank, req.params.track, req.params.id);
    if (!result.removed) return res.status(404).json({ error: 'not_found' });
    audit('item.deleted', `${req.params.bank}.${req.params.track}.${req.params.id}`,
      null, req.admin.username, req.ip);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: 'delete_failed', message: err.message });
  }
});

// ── Pending-review queue (writing track that the LLM grader couldn't score) ─

router.get('/pending-review', adminRequired, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  const rows = db.prepare(`
    SELECT id, exam_id, candidate_name, candidate_email, position_label,
           is_management, submitted_at, score_listening, score_reading
      FROM sessions
     WHERE status = 'pending_review'
     ORDER BY submitted_at ASC
     LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = db.prepare(
    "SELECT COUNT(*) c FROM sessions WHERE status = 'pending_review'"
  ).get().c;
  res.json({ rows, total, limit, offset });
});

router.get('/pending-review/:id', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'pending_review') {
    return res.status(409).json({ error: 'not_pending_review', status: row.status });
  }

  let answersBlob = {};
  try { answersBlob = JSON.parse(row.answers || '{}'); } catch {}
  const writingAnswers = (answersBlob.answers && answersBlob.answers.writing) || {};
  const writingDetails = (answersBlob.details && answersBlob.details.writing) || [];

  // Rehydrate each writing item with its prompt + rubric so the admin can grade.
  let questionIds = {};
  try { questionIds = JSON.parse(row.question_ids || '{}'); } catch {}

  const bankName = row.is_management ? 'BANK_OFFICE_MGR' : 'BANK_STAFF';
  const writingIds = questionIds.writing || [];
  const writingItems = writingIds
    .map((id) => bank.getItem(bankName, 'writing', id))
    .filter(Boolean);

  res.json({
    session: {
      id: row.id,
      exam_id: row.exam_id,
      candidate_name: row.candidate_name,
      candidate_email: row.candidate_email,
      position_label: row.position_label,
      is_management: !!row.is_management,
      submitted_at: row.submitted_at,
      score_listening: row.score_listening,
      score_reading: row.score_reading,
    },
    writing: writingItems.map((q) => {
      const detail = writingDetails.find((d) => d.id === q.id) || {};
      return {
        id: q.id,
        level: q.level,
        topic: q.topic,
        prompt: q.prompt,
        minWords: q.minWords,
        maxWords: q.maxWords,
        rubric: q.rubric,
        candidateAnswer: writingAnswers[q.id] || '',
        graderError: detail.graderError || null,
        graderMessage: detail.graderMessage || null,
      };
    }),
  });
});

router.post('/pending-review/:id/finalize', adminRequired, requireRole('manager'), (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'pending_review') {
    return res.status(409).json({ error: 'not_pending_review', status: row.status });
  }

  // Expect: { perItem: { <id>: <0-10 float>, ... }, note?: string }
  const perItem = (req.body && req.body.perItem) || {};
  const note = req.body && typeof req.body.note === 'string' ? req.body.note : null;

  const ids = (() => {
    try { return (JSON.parse(row.question_ids || '{}').writing) || []; } catch { return []; }
  })();

  let sum = 0;
  const recorded = [];
  for (const id of ids) {
    const raw = perItem[id];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return res.status(400).json({
        error: 'invalid_score',
        message: `Per-item writing score for "${id}" must be a number between 0 and 1 (got ${raw}).`,
      });
    }
    sum += n;
    recorded.push({ id, points: Math.round(n * 10) / 10 });
  }

  const writingScore = Math.round(sum);
  const total = (row.score_listening ?? 0) + (row.score_reading ?? 0) + writingScore;
  const cefr = calcCEFR(total, !!row.is_management);

  let answersBlob = {};
  try { answersBlob = JSON.parse(row.answers || '{}'); } catch {}
  answersBlob.manualReview = {
    by: req.admin.username,
    at: Date.now(),
    perItem: recorded,
    note,
  };

  db.prepare(`
    UPDATE sessions
       SET score_writing = ?, score_total = ?, cefr_level = ?, cefr_status = ?,
           status = 'submitted', answers = ?
     WHERE id = ?
  `).run(writingScore, total, cefr.level, cefr.status, JSON.stringify(answersBlob), req.params.id);

  audit('session.finalize_writing', req.params.id,
    { writingScore, total, cefr: cefr.level, by: req.admin.username }, req.admin.username, req.ip);

  res.json({ ok: true, scores: { writing: writingScore, total }, cefr });
});

// ── DELETE single session ──────────────────────────────────
router.delete('/sessions/:id', adminRequired, requireRole('manager'), (req, res) => {
  const row = db.prepare('SELECT id, exam_id FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  audit('admin.delete_session', req.params.id, { exam_id: row.exam_id }, req.admin.username, req.ip);
  res.json({ ok: true });
});

// ── Bulk delete sessions ───────────────────────────────────
router.post('/sessions/bulk-delete', adminRequired, requireRole('manager'), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'missing_ids' });
  const placeholders = ids.map(() => '?').join(',');
  const deleted = db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...ids);
  audit('admin.bulk_delete', null, { count: deleted.changes }, req.admin.username, req.ip);
  res.json({ ok: true, deleted: deleted.changes });
});

// ── Reset 24h cooldown for email ───────────────────────────
router.post('/sessions/reset-cooldown', adminRequired, requireRole('manager'), (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'missing_email' });
  const session = db.prepare(`
    SELECT id FROM sessions
    WHERE candidate_email = ? AND status = 'submitted'
    ORDER BY submitted_at DESC LIMIT 1
  `).get(email.toLowerCase());
  if (!session) return res.status(404).json({ error: 'no_submitted_session', message: 'Không tìm thấy bài thi đã nộp cho email này.' });
  db.prepare('UPDATE sessions SET submitted_at = ? WHERE id = ?').run(Date.now() - 25 * 3600 * 1000, session.id);
  audit('admin.reset_cooldown', session.id, { email }, req.admin.username, req.ip);
  res.json({ ok: true, message: `Đã trao quyền làm lại cho ${email}` });
});

// ── Report: daily / monthly / quarterly / yearly ───────────
router.get('/report', adminRequired, requireRole('manager'), (req, res) => {
  const type = req.query.type || 'daily';
  const limit = parseInt(req.query.limit || '30', 10);
  let groupFmt;
  if (type === 'yearly')       groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime'))";
  else if (type === 'quarterly') groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime')) || '-Q' || ((cast(strftime('%m', datetime(started_at/1000,'unixepoch','localtime')) as integer) + 2) / 3)";
  else if (type === 'monthly') groupFmt = "strftime('%Y-%m', datetime(started_at/1000,'unixepoch','localtime'))";
  else                         groupFmt = "strftime('%Y-%m-%d', datetime(started_at/1000,'unixepoch','localtime'))";

  const rows = db.prepare(`
    SELECT ${groupFmt} AS period,
           COUNT(*) AS total,
           SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
           SUM(CASE WHEN cefr_status='pass' THEN 1 ELSE 0 END) AS passed,
           SUM(CASE WHEN cefr_status='review' THEN 1 ELSE 0 END) AS review,
           SUM(CASE WHEN cefr_status='fail' THEN 1 ELSE 0 END) AS failed,
           ROUND(AVG(CASE WHEN status='submitted' THEN score_total END), 1) AS avg_score
      FROM sessions GROUP BY period ORDER BY period DESC LIMIT ?
  `).all(limit);
  res.json({ type, rows: rows.reverse() });
});

// ── Export PDF for single session ─────────────────────────
router.get('/sessions/:id/pdf', adminRequired, (req, res) => {
  let PDFDocument;
  try { PDFDocument = require('pdfkit'); } catch { return res.status(500).json({ error: 'pdfkit_not_installed' }); }

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  let answers = {};
  try { answers = JSON.parse(row.answers || '{}'); } catch {}

  // A4 size: 595.28 x 841.89 points. Set margin to 40pt
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  
  // Register Roboto fonts to support Vietnamese
  const fontPath = require('path').join(__dirname, '..', '..', 'public', 'fonts');
  doc.registerFont('Roboto', require('path').join(fontPath, 'Roboto-Regular.ttf'));
  doc.registerFont('Roboto-Bold', require('path').join(fontPath, 'Roboto-Bold.ttf'));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="exam-${row.exam_id}.pdf"`);
  doc.pipe(res);

  const fmt = ts => {
    if (!ts) return '—';
    const date = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} - ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  };

  const navy = '#0C2340';
  const gold = '#D4AF37';
  const textDark = '#1F2937';
  const textGray = '#4B5563';
  const textLight = '#9CA3AF';

  // 1. Draw frame borders
  doc.rect(20, 20, 555.28, 801.89).lineWidth(1.5).stroke(gold);
  doc.rect(24, 24, 547.28, 793.89).lineWidth(0.5).stroke(navy);

  // 2. Header Banner
  doc.rect(25, 25, 545.28, 75).fill(navy);
  doc.rect(25, 100, 545.28, 4).fill(gold);

  // Logo & System title
  doc.fillColor('#FFFFFF').fontSize(15).font('Roboto-Bold').text('VIETRAVEL HR', 45, 42);
  doc.fillColor('#E5E7EB').fontSize(8.5).font('Roboto').text('HỆ THỐNG ĐÁNH GIÁ NĂNG LỰC TIẾNG ANH - VIETRAVEL EXAM', 45, 62);
  doc.fillColor('#94A3B8').fontSize(8.5).font('Roboto-Bold').text('ENGLISH PLACEMENT TEST REPORT', 45, 74);

  // Report Title Right
  doc.fillColor(gold).fontSize(14).font('Roboto-Bold').text('PHIẾU KẾT QUẢ', 300, 42, { width: 250, align: 'right' });
  doc.fillColor('#FFFFFF').fontSize(8.5).font('Roboto').text('OFFICIAL REPORT', 300, 62, { width: 250, align: 'right' });

  // 3. Row 1: Candidate Info & CEFR Badge (Y: 120 to 220)
  const row1Y = 120;
  
  // Left: Candidate profile
  doc.fillColor(navy).fontSize(9.5).font('Roboto-Bold').text('THÔNG TIN ỨNG VIÊN / CANDIDATE PROFILE', 45, row1Y);
  doc.moveTo(45, row1Y + 12).lineTo(345, row1Y + 12).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

  const profileY = row1Y + 20;
  const drawProfileField = (label, val, x, y) => {
    doc.fillColor(textGray).fontSize(8.5).font('Roboto').text(label + ':', x, y);
    doc.fillColor(textDark).fontSize(9).font('Roboto-Bold').text(val || '—', x + 90, y);
  };
  drawProfileField('Họ và tên / Name', row.candidate_name, 45, profileY);
  drawProfileField('Email ứng viên', row.candidate_email, 45, profileY + 16);
  drawProfileField('Vị trí ứng tuyển', row.position_label, 45, profileY + 32);
  drawProfileField('Mã bài thi / ID', row.exam_id, 45, profileY + 48);

  // Right: CEFR Status Badge Box
  const badgeX = 365;
  const badgeY = row1Y - 5;
  const badgeW = 185;
  const badgeH = 95;

  const cefrBg = { pass: '#E6F4EA', review: '#FEF7E0', fail: '#FCE8E6' };
  const cefrBorder = { pass: '#34A853', review: '#FBBC04', fail: '#EA4335' };
  const cefrFg = { pass: '#137333', review: '#B06000', fail: '#C5221F' };
  const cefrLabel = { pass: 'ĐẠT - PASS', review: 'CẦN XEM XÉT - REVIEW', fail: 'CHƯA ĐẠT - FAIL' };
  const statusKey = row.cefr_status || 'none';

  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill(cefrBg[statusKey] || '#F1F3F4');
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).lineWidth(1).stroke(cefrBorder[statusKey] || '#D1D5DB');

  doc.fillColor(cefrFg[statusKey] || '#5F6368').fontSize(7.5).font('Roboto-Bold').text('KẾT QUẢ / CEFR LEVEL', badgeX, badgeY + 10, { width: badgeW, align: 'center' });
  doc.fillColor(cefrFg[statusKey] || '#3C4043').fontSize(26).font('Roboto-Bold').text(row.cefr_level || '—', badgeX, badgeY + 22, { width: badgeW, align: 'center' });
  doc.fillColor(cefrFg[statusKey] || '#5F6368').fontSize(8.5).font('Roboto-Bold').text(cefrLabel[statusKey] || 'CHƯA PHÂN LOẠI', badgeX, badgeY + 54, { width: badgeW, align: 'center' });
  
  // Submit date
  doc.fillColor(textGray).fontSize(7.5).font('Roboto').text(`Nộp bài: ${fmt(row.submitted_at)}`, badgeX, badgeY + 74, { width: badgeW, align: 'center' });

  // 4. Row 2: Total Score Card & Skill Bars (Y: 235 to 355)
  const row2Y = 235;

  // Left: Total Score Card
  const scoreX = 45;
  const scoreW = 130;
  const scoreH = 110;
  doc.roundedRect(scoreX, row2Y, scoreW, scoreH, 6).fill(navy);
  doc.roundedRect(scoreX, row2Y, scoreW, scoreH, 6).lineWidth(1).stroke(gold);

  doc.fillColor('#FFFFFF').fontSize(8.5).font('Roboto-Bold').text('TỔNG ĐIỂM / TOTAL', scoreX, row2Y + 12, { width: scoreW, align: 'center' });
  doc.fillColor(gold).fontSize(34).font('Roboto-Bold').text(row.score_total ?? '0', scoreX, row2Y + 26, { width: scoreW, align: 'center' });
  doc.fillColor('#E5E7EB').fontSize(11).font('Roboto-Bold').text('/ 30', scoreX, row2Y + 66, { width: scoreW, align: 'center' });
  
  const elapsed = row.elapsed_seconds || 0;
  const durationText = `Thời gian: ${Math.round(elapsed / 60)} phút`;
  doc.fillColor('#94A3B8').fontSize(7.5).font('Roboto').text(durationText, scoreX, row2Y + 88, { width: scoreW, align: 'center' });

  // Right: Skill Bars
  const skillX = 195;
  const skillW = 355;
  doc.fillColor(navy).fontSize(9.5).font('Roboto-Bold').text('ĐÁNH GIÁ CHI TIẾT KỸ NĂNG / SKILL ANALYSIS', skillX, row2Y);
  doc.moveTo(skillX, row2Y + 12).lineTo(skillX + skillW, row2Y + 12).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

  const drawProgressBar = (label, val, x, y, width) => {
    // Label and Score text
    doc.fillColor(textGray).fontSize(8.5).font('Roboto-Bold').text(label, x, y);
    const scoreText = `${val ?? '—'}/10`;
    doc.fillColor(navy).fontSize(8.5).font('Roboto-Bold').text(scoreText, x + width - 30, y, { width: 30, align: 'right' });
    
    // Bar Rail
    const barY = y + 11;
    const barHeight = 8;
    doc.roundedRect(x, barY, width, barHeight, 4).fill('#E5E7EB');
    const fill = Math.max(0, Math.min(1, (val || 0) / 10));
    if (fill > 0) {
      doc.roundedRect(x, barY, width * fill, barHeight, 4).fill(navy);
    }
  };

  drawProgressBar('1. Nghe hiểu / Listening', row.score_listening, skillX, row2Y + 20, skillW);
  drawProgressBar('2. Đọc hiểu / Reading', row.score_reading, skillX, row2Y + 52, skillW);
  drawProgressBar('3. Viết / Writing', row.score_writing, skillX, row2Y + 84, skillW);

  // 5. Row 3: Evaluator Notes & Roadmap (Y: 365 to 555)
  const row3Y = 365;

  // Left: Evaluator feedback
  const feedbackX = 45;
  const feedbackW = 260;
  const feedbackH = 175;
  
  doc.roundedRect(feedbackX, row3Y, feedbackW, feedbackH, 5).lineWidth(0.5).stroke('#D1D5DB');
  doc.fillColor(navy).fontSize(9).font('Roboto-Bold').text('NHẬN XÉT CHI TIẾT / EVALUATION NOTES', feedbackX + 10, row3Y + 10);
  doc.moveTo(feedbackX + 10, row3Y + 22).lineTo(feedbackX + feedbackW - 10, row3Y + 22).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

  let evaluatorFeedback = '';
  if (answers.manualReview && answers.manualReview.note) {
    evaluatorFeedback = `Giám khảo (${answers.manualReview.by}): ${answers.manualReview.note}`;
  } else if (answers.ai_writing_grades) {
    const grades = Object.values(answers.ai_writing_grades);
    if (grades.length > 0) {
      const firstGrade = grades.find(g => g.feedback_vi || g.feedback_en);
      if (firstGrade) {
        evaluatorFeedback = firstGrade.feedback_vi || firstGrade.feedback_en;
      }
    }
  }
  if (!evaluatorFeedback) {
    evaluatorFeedback = 'Không có nhận xét chi tiết cho bài làm viết.';
  }
  
  // Truncate to avoid overflow
  if (evaluatorFeedback.length > 340) {
    evaluatorFeedback = evaluatorFeedback.slice(0, 337) + '...';
  }
  
  doc.fillColor(textGray).fontSize(8).font('Roboto')
     .text(evaluatorFeedback, feedbackX + 10, row3Y + 28, { width: feedbackW - 20, height: feedbackH - 38, align: 'justify', lineGap: 2.5 });

  // Right: Roadmap Recommendations
  const roadmapX = 320;
  const roadmapW = 230;
  const roadmapH = 175;

  doc.roundedRect(roadmapX, row3Y, roadmapW, roadmapH, 5).lineWidth(0.5).stroke(gold);
  doc.fillColor(navy).fontSize(9).font('Roboto-Bold').text('LỘ TRÌNH PHÁT TRIỂN / TRAINING ROADMAP', roadmapX + 10, row3Y + 10);
  doc.moveTo(roadmapX + 10, row3Y + 22).lineTo(roadmapX + roadmapW - 10, row3Y + 22).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

  // CEFR Levels Ladder Visual
  const cefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const startX = roadmapX + 10;
  const startY = row3Y + 28;
  const boxW = 31;
  const boxH = 16;
  const gap = 4;

  cefrLevels.forEach((lvl, idx) => {
    const x = startX + idx * (boxW + gap);
    const isCurrent = (row.cefr_level || '').toUpperCase() === lvl;
    if (isCurrent) {
      doc.roundedRect(x, startY, boxW, boxH, 3).fill(gold);
      doc.fillColor('#FFFFFF').fontSize(7.5).font('Roboto-Bold').text(lvl, x, startY + 4, { width: boxW, align: 'center' });
    } else {
      doc.roundedRect(x, startY, boxW, boxH, 3).lineWidth(0.5).stroke('#D1D5DB');
      doc.fillColor(textLight).fontSize(7.5).font('Roboto').text(lvl, x, startY + 4, { width: boxW, align: 'center' });
    }
  });

  // Dynamic recommendation text
  let roadmapText = '';
  const levelUpper = (row.cefr_level || '').toUpperCase();
  if (levelUpper === 'C2' || levelUpper === 'C1' || levelUpper === 'B2') {
    roadmapText = 'Ứng viên có năng lực ngoại ngữ xuất sắc, đủ điều kiện làm việc trong môi trường quốc tế. Khuyến nghị bồi dưỡng định kỳ kỹ năng thuyết trình, đàm phán thương mại.';
  } else if (levelUpper === 'B1') {
    roadmapText = 'Đạt tiêu chuẩn trung cấp. Khuyến nghị tham gia khóa học Tiếng Anh Du lịch & Giao tiếp khách hàng chuyên sâu để nâng cao kỹ năng xử lý tình huống nghiệp vụ phức tạp.';
  } else {
    roadmapText = 'Chưa đạt chuẩn giao tiếp tối thiểu. Yêu cầu tham gia khóa đào tạo Tiếng Anh giao tiếp cơ bản của Vietravel Academy để cải thiện phản xạ và nâng cao nghiệp vụ.';
  }

  doc.fillColor(textGray).fontSize(8).font('Roboto')
     .text(roadmapText, roadmapX + 10, row3Y + 54, { width: roadmapW - 20, height: roadmapH - 64, align: 'justify', lineGap: 2.5 });

  // 6. Row 4: Proctoring & Integrity Logs (Y: 555 to 615)
  const row4Y = 555;
  const procW = 505;
  const procH = 50;
  
  const hasCheated = (row.cheat_events || 0) > 2;
  const procBg = hasCheated ? '#FFF5F5' : '#F9FAFB';
  const procBorder = hasCheated ? '#FCA5A5' : '#E5E7EB';
  const procHeaderColor = hasCheated ? '#C5221F' : navy;

  doc.roundedRect(45, row4Y, procW, procH, 4).fill(procBg);
  doc.roundedRect(45, row4Y, procW, procH, 4).lineWidth(0.8).stroke(procBorder);

  doc.fillColor(procHeaderColor).fontSize(8.5).font('Roboto-Bold').text('GIÁM SÁT THI CỬ & ĐỘ TIN CẬY / PROCTORING LOGS & INTEGRITY', 55, row4Y + 8);
  doc.moveTo(55, row4Y + 18).lineTo(55 + procW - 20, row4Y + 18).strokeColor('#E5E7EB').lineWidth(0.5).stroke();

  const ipText = `Địa chỉ IP: ${row.ip_address || '—'}`;
  const timeText = `Thời gian: ${fmt(row.started_at)}  ➔  ${fmt(row.submitted_at)}`;
  const tabText = `Số lần thoát màn hình: ${row.cheat_events || 0} lần`;
  const consentText = 'Xác thực sinh trắc/Cam kết: Đã đồng ý (Consent Given)';

  doc.fillColor(textGray).fontSize(7.5).font('Roboto');
  doc.text(ipText, 55, row4Y + 24);
  doc.text(timeText, 250, row4Y + 24);
  
  if (hasCheated) {
    doc.fillColor('#C5221F').font('Roboto-Bold').text(tabText + ' (CẢNH BÁO CAO)', 55, row4Y + 36);
  } else {
    doc.text(tabText, 55, row4Y + 36);
  }
  doc.fillColor(textGray).font('Roboto').text(consentText, 250, row4Y + 36);

  // 7. Row 5: Signature Section (Y: 620 to 765)
  const row5Y = 620;
  
  const drawSignatureBlock = (title, subtitle, name, x, width) => {
    doc.fillColor(navy).fontSize(8.5).font('Roboto-Bold').text(title, x, row5Y, { width: width, align: 'center' });
    doc.fillColor(textLight).fontSize(7.5).font('Roboto').text(subtitle, x, row5Y + 10, { width: width, align: 'center' });
    
    // Space for physical signature (about 50pt)
    if (name) {
      doc.fillColor(textDark).fontSize(9).font('Roboto-Bold').text(name, x, row5Y + 68, { width: width, align: 'center' });
    }
  };

  drawSignatureBlock('ỨNG VIÊN / CANDIDATE', '(Ký và ghi rõ họ tên)', row.candidate_name, 45, 150);
  drawSignatureBlock('GIÁM THỊ PHÒNG THI / PROCTOR', '(Ký và xác nhận)', 'HỆ THỐNG TỰ ĐỘNG', 222, 150);
  drawSignatureBlock('TRƯỞNG BAN NHÂN SỰ / HR HEAD', '(Ký tên và đóng dấu)', 'BAN NHÂN SỰ VIETRAVEL', 400, 150);

  // 8. Footer Section (Y: 775 to 795)
  doc.moveTo(25, 775).lineTo(570, 775).strokeColor(gold).lineWidth(0.5).stroke();
  doc.fillColor(textLight).fontSize(7).font('Roboto')
     .text('Tài liệu nội bộ thuộc quyền sở hữu của Công ty Cổ phần Du lịch và Tiếp thị Giao thông Vận tải Việt Nam (Vietravel). Nghiêm cấm sao chép.', 25, 782, { width: 545, align: 'center' });

  audit('admin.export_pdf', row.id, { exam_id: row.exam_id }, req.admin.username, req.ip);
  doc.end();
});

// ── Change admin password ──────────────────────────────────
router.post('/change-password', adminRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing_fields' });
  const pwErr = validatePasswordStrength(newPassword);
  if (pwErr) return res.status(400).json({ error: 'weak_password', message: pwErr });
  const { hashPassword } = require('../lib/auth');
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  const ok = await verifyPassword(currentPassword, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'wrong_password', message: 'Mật khẩu hiện tại không đúng.' });
  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, req.admin.id);
  audit('admin.change_password', String(req.admin.id), null, req.admin.username, req.ip);
  res.json({ ok: true });
});

// ── Invitations (send exam link) ───────────────────────────
const { nanoid } = require('nanoid');

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
  res.json({ ok: true, name: row.name, email: row.email, position: row.position, message: row.message });
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

// ── Exam Configurations (GET and POST) ──────────────────────
router.get('/exam-config', adminRequired, requireAdminRole, (req, res) => {
  const configs = db.prepare('SELECT * FROM exam_configs').all();
  const getOptions = (bankName) => {
    try {
      const b = bank.getBank(bankName);
      const listeningMap = {};
      b.listening.forEach(q => {
        const key = q.audioFile;
        if (key) {
          if (!listeningMap[key]) {
            listeningMap[key] = { audioFile: key, topic: q.topic || key, count: 0 };
          }
          listeningMap[key].count++;
        }
      });
      const listening = Object.values(listeningMap);
      const readingMap = {};
      b.reading.forEach(q => {
        const key = q.passageId || q.passage || q.id;
        if (key) {
          if (!readingMap[key]) {
            readingMap[key] = { passageId: key, topic: q.topic || 'Passage', count: 0 };
          }
          readingMap[key].count++;
        }
      });
      const reading = Object.values(readingMap);
      const writing = b.writing.map(q => ({
        id: q.id,
        type: q.type,
        topic: q.topic || q.question || q.id,
        level: q.level
      }));
      return { listening, reading, writing };
    } catch (err) {
      console.error(`Error getting config options for ${bankName}:`, err);
      return { listening: [], reading: [], writing: [] };
    }
  };
  res.json({
    configs,
    options: {
      staff: getOptions('BANK_STAFF'),
      manager: getOptions('BANK_OFFICE_MGR')
    }
  });
});

router.post('/exam-config', adminRequired, requireAdminRole, (req, res) => {
  const { position, config_type, selected_audio, selected_passage, selected_writing } = req.body || {};
  if (!position) return res.status(400).json({ error: 'missing_position' });
  db.prepare(`
    UPDATE exam_configs
       SET config_type = ?,
           selected_audio = ?,
           selected_passage = ?,
           selected_writing = ?
     WHERE position = ?
  `).run(config_type || 'random', selected_audio || null, selected_passage || null, selected_writing || null, position);
  audit('admin.save_exam_config', position, { config_type }, req.admin.username, req.ip);
  res.json({ ok: true });
});

// ── GET /users — List Admin/Staff Users ────────────────────
router.get('/users', adminRequired, requireAdminRole, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, created_at, last_login_at FROM admins ORDER BY created_at DESC').all();
  res.json({ ok: true, users });
});

// ── POST /users — Create Admin/Staff User ──────────────────
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
    res.status(500).json({ error: 'create_failed', message: e.message });
  }
});

// ── DELETE /users/:id — Delete Admin/Staff User ────────────
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

// ── GET /report/export.xlsx — Export statistics to Excel ──
router.get('/report/export.xlsx', adminRequired, requireRole('manager'), async (req, res) => {
  const type = req.query.type || 'daily';
  const limit = parseInt(req.query.limit || '100', 10);
  let groupFmt;
  let timeLabel = 'Ngày';
  if (type === 'yearly') {
    groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel = 'Năm';
  } else if (type === 'quarterly') {
    groupFmt = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime')) || '-Q' || ((cast(strftime('%m', datetime(started_at/1000,'unixepoch','localtime')) as integer) + 2) / 3)";
    timeLabel = 'Quý';
  } else if (type === 'monthly') {
    groupFmt = "strftime('%Y-%m', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel = 'Tháng';
  } else {
    groupFmt = "strftime('%Y-%m-%d', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel = 'Ngày';
  }

  try {
    const rows = db.prepare(`
      SELECT ${groupFmt} AS period,
             COUNT(*) AS total,
             SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
             SUM(CASE WHEN cefr_status='pass' THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN cefr_status='review' THEN 1 ELSE 0 END) AS review,
             SUM(CASE WHEN cefr_status='fail' THEN 1 ELSE 0 END) AS failed,
             ROUND(AVG(CASE WHEN status='submitted' THEN score_total END), 1) AS avg_score
        FROM sessions GROUP BY period ORDER BY period DESC LIMIT ?
    `).all(limit);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Vietravel HR';
    const ws = wb.addWorksheet('Báo cáo thống kê');

    // Title Row
    ws.addRow([`BÁO CÁO TÌNH HÌNH TUYỂN DỤNG & ĐÁNH GIÁ TIẾNG ANH (Theo ${timeLabel})`]);
    ws.mergeCells('A1:H1');
    ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(1).height = 40;

    // Blank row
    ws.addRow([]);

    // Headers
    ws.addRow([
      timeLabel,
      'Tổng số ứng viên',
      'Đã nộp bài',
      'Đạt yêu cầu (Pass)',
      'Cần xem xét (Review)',
      'Chưa đạt (Fail)',
      'Tỷ lệ đạt (%)',
      'Điểm trung bình (/30)'
    ]);

    const headerRow = ws.getRow(3);
    headerRow.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 25;

    rows.reverse().forEach(r => {
      const passRate = r.total ? Math.round((r.passed || 0) / r.total * 100) : 0;
      ws.addRow([
        r.period,
        r.total,
        r.submitted || 0,
        r.passed || 0,
        r.review || 0,
        r.failed || 0,
        `${passRate}%`,
        r.avg_score || '—'
      ]);
    });

    // Formatting widths
    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 18;
    ws.getColumn(3).width = 15;
    ws.getColumn(4).width = 20;
    ws.getColumn(5).width = 22;
    ws.getColumn(6).width = 15;
    ws.getColumn(7).width = 15;
    ws.getColumn(8).width = 22;

    // Apply borders and alignment to cells
    ws.eachRow((row, rowNum) => {
      if (rowNum < 3) return;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
          right: { style: 'thin', color: { argb: 'FFD9D9D9' } }
        };
        if (cell.col > 1) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bao_cao_nhan_su_${type}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'export_failed', message: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════
// GET /report/export.pdf — Server-side PDF generation via Puppeteer
// ══════════════════════════════════════════════════════════════════
router.get('/report/export.pdf', adminRequired, requireRole('manager'), async (req, res) => {
  const type  = req.query.type  || 'daily';
  const limit = Math.min(parseInt(req.query.limit || '60', 10), 120);

  let groupFmt, timeLabel, periodLabel;
  if (type === 'yearly') {
    groupFmt    = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel   = 'Năm'; periodLabel = 'theo Năm';
  } else if (type === 'quarterly') {
    groupFmt    = "strftime('%Y', datetime(started_at/1000,'unixepoch','localtime')) || '-Q' || ((cast(strftime('%m', datetime(started_at/1000,'unixepoch','localtime')) as integer) + 2) / 3)";
    timeLabel   = 'Quý'; periodLabel = 'theo Quý';
  } else if (type === 'monthly') {
    groupFmt    = "strftime('%Y-%m', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel   = 'Tháng'; periodLabel = 'theo Tháng';
  } else {
    groupFmt    = "strftime('%Y-%m-%d', datetime(started_at/1000,'unixepoch','localtime'))";
    timeLabel   = 'Ngày'; periodLabel = 'theo Ngày';
  }

  try {
    const rows = db.prepare(`
      SELECT ${groupFmt} AS period,
             COUNT(*) AS total,
             SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
             SUM(CASE WHEN cefr_status='pass'   THEN 1 ELSE 0 END) AS passed,
             SUM(CASE WHEN cefr_status='review' THEN 1 ELSE 0 END) AS review,
             SUM(CASE WHEN cefr_status='fail'   THEN 1 ELSE 0 END) AS failed,
             ROUND(AVG(CASE WHEN status='submitted' THEN score_total END), 1) AS avg_score
        FROM sessions GROUP BY period ORDER BY period ASC LIMIT ?
    `).all(limit);

    const totalExams  = rows.reduce((a, r) => a + r.total, 0);
    const totalPass   = rows.reduce((a, r) => a + (r.passed  || 0), 0);
    const totalReview = rows.reduce((a, r) => a + (r.review  || 0), 0);
    const totalFail   = rows.reduce((a, r) => a + (r.failed  || 0), 0);
    const avgScores   = rows.filter(r => r.avg_score).map(r => r.avg_score);
    const overallAvg  = avgScores.length ? (avgScores.reduce((a,b)=>a+b,0)/avgScores.length).toFixed(1) : '—';
    const passRate    = totalExams ? Math.round(totalPass / totalExams * 100) : 0;
    const submitRate  = totalExams ? Math.round(rows.reduce((a,r)=>a+(r.submitted||0),0)/totalExams*100) : 0;

    const nowStr    = new Date().toLocaleDateString('vi-VN', { year:'numeric', month:'long', day:'numeric' });
    const nowFull   = new Date().toLocaleDateString('vi-VN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    const periodFrom = rows.length ? rows[0].period : '—';
    const periodTo   = rows.length ? rows[rows.length-1].period : '—';
    const fileName   = `bao-cao-nhan-su-${type}-${new Date().toISOString().slice(0,10)}.pdf`;

    // Recommendation text
    let recommendation = '';
    if (passRate >= 60) {
      recommendation = `Tỷ lệ ứng viên đạt yêu cầu đạt <strong>${passRate}%</strong> — vượt ngưỡng 60%. Chất lượng đầu vào nhân sự đang ổn định tốt. Có thể cân nhắc nâng tiêu chuẩn điểm đầu vào.`;
    } else if (passRate >= 40) {
      recommendation = `Tỷ lệ đạt <strong>${passRate}%</strong> — ở mức trung bình. Khuyến nghị tăng cường định hướng thi đầu vào và cung cấp tài liệu luyện thi tiếng Anh cho ứng viên.`;
    } else {
      recommendation = `Tỷ lệ đạt chỉ <strong>${passRate}%</strong> — dưới ngưỡng kỳ vọng. Cần xem xét điều chỉnh tiêu chí tuyển dụng hoặc rà soát lại độ khó của bài kiểm tra.`;
    }

    const tableRows = rows.slice().reverse().map((r, i) => {
      const pr = r.total ? Math.round((r.passed||0)/r.total*100) : 0;
      const trClass = i % 2 === 0 ? '' : ' class="alt"';
      const badgeClass = pr >= 60 ? 'badge-pass' : pr >= 30 ? 'badge-review' : 'badge-fail';
      return `<tr${trClass}>
        <td class="period">${r.period}</td>
        <td class="num">${r.total}</td>
        <td class="num">${r.submitted||0}</td>
        <td class="num pass">${r.passed||0}</td>
        <td class="num review">${r.review||0}</td>
        <td class="num fail">${r.failed||0}</td>
        <td class="num"><span class="badge ${badgeClass}">${pr}%</span></td>
        <td class="num score">${r.avg_score != null ? r.avg_score : '—'}</td>
      </tr>`;
    }).join('');

    const chartLabels = JSON.stringify(rows.map(r => r.period));
    const chartTotal  = JSON.stringify(rows.map(r => r.total));
    const chartPass   = JSON.stringify(rows.map(r => r.passed||0));
    const chartFail   = JSON.stringify(rows.map(r => r.failed||0));
    const chartAvg    = JSON.stringify(rows.map(r => r.avg_score||null));

    // ── Build the full HTML page ──────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Báo cáo Nhân sự — ${periodLabel}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@300;400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Be Vietnam Pro',sans-serif;font-size:10pt;color:#1F2937;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{--navy:#0C2340;--navy2:#1A3A5C;--gold:#C8A84B;--blue:#1A73E8;--teal:#0D9488;--rose:#DC2626;--amber:#D97706;--g1:#1F2937;--g2:#374151;--g3:#6B7280;--g5:#F9FAFB;--line:#E5E7EB}

/* ── COVER ── */
.cover{min-height:100vh;display:flex;flex-direction:column;background:linear-gradient(160deg,var(--navy) 0%,#0A3260 55%,#0F4C8A 100%);color:#fff;page-break-after:always}
.cover-accent{height:5px;background:linear-gradient(90deg,var(--gold),#e8c96b 50%,transparent)}
.cover-header{display:flex;align-items:center;justify-content:space-between;padding:28px 48px 20px;border-bottom:1px solid rgba(255,255,255,.1)}
.cover-dept{font-size:8pt;color:rgba(255,255,255,.5);letter-spacing:1.5px;text-transform:uppercase}
.cover-body{flex:1;display:flex;flex-direction:column;justify-content:center;padding:48px 48px 32px}
.cover-tag{display:inline-block;background:var(--gold);color:var(--navy);font-size:7.5pt;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:4px 14px;border-radius:2px;margin-bottom:18px}
.cover-title{font-size:28pt;font-weight:800;line-height:1.15;margin-bottom:8px}
.cover-sub{font-size:13pt;color:rgba(255,255,255,.65);margin-bottom:32px}
.cover-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:36px}
.cmi{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.13);border-radius:8px;padding:14px 16px}
.cmi .lbl{font-size:7.5pt;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.cmi .val{font-size:11pt;font-weight:700}
.cover-footer{padding:18px 48px;border-top:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;font-size:7.5pt;color:rgba(255,255,255,.35)}

/* ── CONTENT ── */
.page{padding:36px 44px;max-width:900px;margin:0 auto}
.section-title{font-size:12pt;font-weight:800;color:var(--navy);border-left:4px solid var(--gold);padding-left:10px;margin:28px 0 16px}
.section-title:first-child{margin-top:0}

/* KPI grid */
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
.kpi{border:1px solid var(--line);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden}
.kpi::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.kpi.blue::before{background:var(--blue)}.kpi.teal::before{background:var(--teal)}.kpi.rose::before{background:var(--rose)}.kpi.amber::before{background:var(--amber)}.kpi.navy::before{background:var(--navy)}.kpi.gold::before{background:var(--gold)}
.kpi .lbl{font-size:7pt;color:var(--g3);text-transform:uppercase;letter-spacing:.7px;margin-bottom:5px;font-weight:600}
.kpi .val{font-size:22pt;font-weight:800;line-height:1}
.kpi.blue .val{color:var(--blue)}.kpi.teal .val{color:var(--teal)}.kpi.rose .val{color:var(--rose)}.kpi.amber .val{color:var(--amber)}.kpi.navy .val{color:var(--navy)}.kpi.gold .val{color:#9A7B28}
.kpi .sub{font-size:7pt;color:var(--g3);margin-top:3px}

/* Recommendation */
.rec{background:linear-gradient(135deg,#EEF2FF,#F0F9FF);border:1px solid #C7D2FE;border-left:4px solid var(--blue);border-radius:7px;padding:16px 18px;margin-bottom:20px}
.rec .rt{font-size:8pt;font-weight:800;color:var(--navy);text-transform:uppercase;letter-spacing:.7px;margin-bottom:6px}
.rec p{font-size:9.5pt;line-height:1.6;color:var(--g2)}

/* Charts */
.charts-row{display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:20px;page-break-inside:avoid}
.chart-box{border:1px solid var(--line);border-radius:8px;padding:16px}
.cbt{font-size:8pt;font-weight:700;color:var(--g2);text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px;display:flex;align-items:center;gap:5px}
.cbt::before{content:'';display:inline-block;width:3px;height:12px;background:var(--gold);border-radius:2px}

/* Table */
table{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:20px}
thead tr{background:var(--navy);color:#fff}
thead th{padding:9px 10px;text-align:right;font-weight:700;font-size:7.5pt;white-space:nowrap}
thead th:first-child{text-align:left;border-radius:5px 0 0 0}thead th:last-child{border-radius:0 5px 0 0}
tbody td{padding:8px 10px;border-bottom:1px solid var(--line)}
tbody tr.alt{background:var(--g5)}
tbody tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.period{font-weight:700;color:var(--navy2)}
td.pass{color:var(--teal);font-weight:700}td.fail{color:var(--rose);font-weight:700}td.review{color:var(--amber);font-weight:600}td.score{color:var(--blue);font-weight:700}
.badge{display:inline-block;padding:2px 7px;border-radius:20px;font-size:8pt;font-weight:700}
.badge-pass{background:#D1FAE5;color:#065F46}.badge-review{background:#FEF3C7;color:#92400E}.badge-fail{background:#FEE2E2;color:#991B1B}

/* Footer */
.rpt-footer{border-top:1px solid var(--line);padding-top:14px;margin-top:28px;display:flex;justify-content:space-between;font-size:7.5pt;color:#9CA3AF}

@page{size:A4;margin:0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.cover{page-break-after:always}.charts-row,.rec{page-break-inside:avoid}}
</style>
</head>
<body>

<!-- COVER -->
<div class="cover">
  <div class="cover-accent"></div>
  <div class="cover-header">
    <img src="https://13.229.103.28.nip.io/logo-vietravel.svg" style="height:36px;filter:brightness(0) invert(1)" alt="Vietravel" onerror="this.style.display='none'">
    <span class="cover-dept">Phòng Nhân sự — Tuyển dụng</span>
  </div>
  <div class="cover-body">
    <span class="cover-tag">Báo cáo nội bộ · Mật</span>
    <div class="cover-title">Báo cáo Tình hình<br>Kiểm tra Tiếng Anh<br>Nhân sự</div>
    <div class="cover-sub">Thống kê &amp; Phân tích Kỳ thi Tuyển dụng ${periodLabel}</div>
    <div class="cover-meta">
      <div class="cmi"><div class="lbl">Kỳ báo cáo</div><div class="val">${periodLabel}</div></div>
      <div class="cmi"><div class="lbl">Giai đoạn</div><div class="val">${periodFrom} → ${periodTo}</div></div>
      <div class="cmi"><div class="lbl">Ngày xuất</div><div class="val">${nowStr}</div></div>
    </div>
  </div>
  <div class="cover-footer">
    <span>Tài liệu nội bộ — Không phát tán ra ngoài</span>
    <span>Vietravel HR System © ${new Date().getFullYear()}</span>
  </div>
</div>

<!-- CONTENT -->
<div class="page">
  <div class="section-title">1. Tóm tắt Số liệu Tổng quát</div>
  <div class="kpi-grid">
    <div class="kpi blue"><div class="lbl">Tổng ứng viên</div><div class="val">${totalExams.toLocaleString('vi-VN')}</div><div class="sub">Toàn bộ phiên thi</div></div>
    <div class="kpi teal"><div class="lbl">Tỷ lệ đạt</div><div class="val">${passRate}%</div><div class="sub">${totalPass.toLocaleString('vi-VN')} đạt chuẩn</div></div>
    <div class="kpi rose"><div class="lbl">Chưa đạt</div><div class="val">${totalFail.toLocaleString('vi-VN')}</div><div class="sub">Cần cải thiện</div></div>
    <div class="kpi amber"><div class="lbl">Xem xét</div><div class="val">${totalReview.toLocaleString('vi-VN')}</div><div class="sub">Chờ đánh giá</div></div>
    <div class="kpi navy"><div class="lbl">Điểm TB / 30</div><div class="val">${overallAvg}</div><div class="sub">Trung bình toàn kỳ</div></div>
    <div class="kpi gold"><div class="lbl">Tỷ lệ nộp bài</div><div class="val">${submitRate}%</div><div class="sub">Hoàn thành thi</div></div>
    <div class="kpi blue"><div class="lbl">Số kỳ dữ liệu</div><div class="val">${rows.length}</div><div class="sub">${timeLabel} có dữ liệu</div></div>
    <div class="kpi teal"><div class="lbl">TB / kỳ</div><div class="val">${rows.length ? Math.round(totalExams/rows.length) : 0}</div><div class="sub">Mỗi ${timeLabel.toLowerCase()}</div></div>
  </div>

  <div class="rec">
    <div class="rt">💡 Nhận định &amp; Khuyến nghị</div>
    <p>${recommendation}</p>
  </div>

  <div class="section-title">2. Biểu đồ Xu hướng ${periodLabel}</div>
  <div class="charts-row">
    <div class="chart-box">
      <div class="cbt">Tổng phiên · Đạt · Chưa đạt</div>
      <div style="position:relative;height:200px"><canvas id="cLine"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="cbt">Phân bố kết quả</div>
      <div style="position:relative;height:200px"><canvas id="cDonut"></canvas></div>
    </div>
  </div>
  <div class="chart-box" style="margin-bottom:22px">
    <div class="cbt">Điểm Trung bình theo ${timeLabel} (/30 điểm)</div>
    <div style="position:relative;height:140px"><canvas id="cAvg"></canvas></div>
  </div>

  <div class="section-title">3. Bảng Số liệu Chi tiết</div>
  <table>
    <thead><tr>
      <th>${timeLabel}</th><th>Tổng</th><th>Nộp bài</th>
      <th>Đạt</th><th>Xem xét</th><th>Chưa đạt</th>
      <th>% Đạt</th><th>Điểm TB</th>
    </tr></thead>
    <tbody>${tableRows||'<tr><td colspan="8" style="text-align:center;padding:16px;color:#9CA3AF">Chưa có dữ liệu</td></tr>'}</tbody>
  </table>

  <div class="rpt-footer">
    <span>Vietravel HR System — Tự động tạo</span>
    <span>Xuất ngày: ${nowFull}</span>
    <span>Bảo mật — Lưu hành nội bộ</span>
  </div>
</div>

<script>
(function(){
  const L=${chartLabels}, dT=${chartTotal}, dP=${chartPass}, dF=${chartFail}, dA=${chartAvg};

  const ctxL = document.getElementById('cLine').getContext('2d');
  const gB=ctxL.createLinearGradient(0,0,0,180); gB.addColorStop(0,'rgba(26,115,232,.18)'); gB.addColorStop(1,'rgba(26,115,232,0)');
  const gT=ctxL.createLinearGradient(0,0,0,180); gT.addColorStop(0,'rgba(13,148,136,.18)'); gT.addColorStop(1,'rgba(13,148,136,0)');
  const gR=ctxL.createLinearGradient(0,0,0,180); gR.addColorStop(0,'rgba(220,38,38,.12)'); gR.addColorStop(1,'rgba(220,38,38,0)');

  new Chart(ctxL,{type:'line',data:{labels:L,datasets:[
    {label:'Tổng',data:dT,borderColor:'#1A73E8',backgroundColor:gB,fill:true,tension:.4,borderWidth:2.5,pointRadius:2.5},
    {label:'Đạt', data:dP,borderColor:'#0D9488',backgroundColor:gT,fill:true,tension:.4,borderWidth:2,pointRadius:2},
    {label:'Chưa đạt',data:dF,borderColor:'#DC2626',backgroundColor:gR,fill:true,tension:.4,borderWidth:1.5,pointRadius:2}
  ]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},
    plugins:{legend:{position:'bottom',labels:{font:{size:8},boxWidth:9,padding:10}}},
    scales:{x:{ticks:{font:{size:7.5},maxRotation:40},grid:{color:'rgba(0,0,0,.04)'}},y:{ticks:{font:{size:7.5}},grid:{color:'rgba(0,0,0,.06)'}}}}});

  new Chart(document.getElementById('cDonut'),{type:'doughnut',
    data:{labels:['Đạt','Xem xét','Chưa đạt'],datasets:[{data:[${totalPass},${totalReview},${totalFail}],backgroundColor:['#0D9488','#D97706','#DC2626'],borderWidth:0,hoverOffset:4}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{size:8},boxWidth:9,padding:8}}}}});

  new Chart(document.getElementById('cAvg'),{type:'bar',
    data:{labels:L,datasets:[{label:'Điểm TB',data:dA,
      backgroundColor:dA.map(v=>v==null?'rgba(0,0,0,0)':v>=20?'#0D9488':v>=12?'#1A73E8':'#DC2626'),
      borderRadius:3,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:0},
      plugins:{legend:{display:false}},
      scales:{x:{ticks:{font:{size:7.5},maxRotation:40},grid:{display:false}},
              y:{min:0,max:30,ticks:{font:{size:7.5},stepSize:5},grid:{color:'rgba(0,0,0,.06)'}}}}});
})();
<\/script>
</body></html>`;

    // ── Generate PDF via Puppeteer + @sparticuz/chromium-min ────────────────────
    let puppeteer, chromiumPkg;
    try {
      puppeteer   = require('puppeteer-core');
      chromiumPkg = require('@sparticuz/chromium-min');
    } catch (e) {
      return res.status(500).json({ error: 'pdf_deps_missing', message: e.message });
    }

    // chromium-min downloads a pre-built headless Chromium binary on demand
    const CHROMIUM_PACK = 'https://github.com/Sparticuz/chromium/releases/download/v126.0.0/chromium-v126.0.0-pack.tar';
    const execPath = await chromiumPkg.executablePath(CHROMIUM_PACK);

    const browser = await puppeteer.launch({
      executablePath: execPath,
      args: chromiumPkg.args,
      headless: chromiumPkg.headless,
      defaultViewport: chromiumPkg.defaultViewport,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for Chart.js to finish rendering
    await new Promise(r => setTimeout(r, 1500));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);

  } catch (err) {
    console.error('[PDF export]', err);
    res.status(500).json({ error: 'pdf_export_failed', message: err.message });
  }
});


module.exports = router;
