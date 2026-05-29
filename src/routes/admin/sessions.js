const express = require('express');
const db = require('../../lib/db');
const { adminRequired, requireRole, audit } = require('../../lib/auth');
const { decryptPII } = require('../../lib/crypto');

const router = express.Router();

router.get('/sessions', adminRequired, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
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

  if (q) {
    let rows = db.prepare(`
      SELECT id, exam_id, candidate_name, candidate_email, position_label,
             started_at, submitted_at, elapsed_seconds,
             score_total, score_listening, score_reading, score_writing,
             cefr_level, cefr_status, status, cheat_events
        FROM sessions ${whereSql}
       ORDER BY COALESCE(submitted_at, started_at) DESC
    `).all(...params);

    rows = rows.map(r => ({
      ...r,
      candidate_name: decryptPII(r.candidate_name),
      candidate_email: decryptPII(r.candidate_email)
    })).filter(r => 
      r.candidate_name.toLowerCase().includes(q) ||
      r.candidate_email.toLowerCase().includes(q) ||
      r.exam_id.toLowerCase().includes(q)
    );

    const total = rows.length;
    const paginated = rows.slice(offset, offset + limit);
    return res.json({ rows: paginated, total, limit, offset });
  } else {
    let rows = db.prepare(`
      SELECT id, exam_id, candidate_name, candidate_email, position_label,
             started_at, submitted_at, elapsed_seconds,
             score_total, score_listening, score_reading, score_writing,
             cefr_level, cefr_status, status, cheat_events
        FROM sessions ${whereSql}
       ORDER BY COALESCE(submitted_at, started_at) DESC
       LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    rows = rows.map(r => ({
      ...r,
      candidate_name: decryptPII(r.candidate_name),
      candidate_email: decryptPII(r.candidate_email)
    }));

    const total = db.prepare(`SELECT COUNT(*) AS c FROM sessions ${whereSql}`).get(...params).c;
    return res.json({ rows, total, limit, offset });
  }
});

router.get('/sessions/:id', adminRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  row.candidate_name = decryptPII(row.candidate_name);
  row.candidate_email = decryptPII(row.candidate_email);
  row.ip_address = decryptPII(row.ip_address);
  row.user_agent = decryptPII(row.user_agent);

  try { row.question_ids = JSON.parse(row.question_ids || '{}'); } catch {}
  try { row.answers      = JSON.parse(row.answers || '{}'); } catch {}
  try { row.audio_listens = JSON.parse(row.audio_listens || '{}'); } catch {}
  res.json(row);
});

router.delete('/sessions/:id', adminRequired, requireRole('manager'), (req, res) => {
  const row = db.prepare('SELECT id, exam_id FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  audit('admin.delete_session', req.params.id, { exam_id: row.exam_id }, req.admin.username, req.ip);
  res.json({ ok: true });
});

router.post('/sessions/bulk-delete', adminRequired, requireRole('manager'), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'missing_ids' });
  const placeholders = ids.map(() => '?').join(',');
  const deleted = db.prepare(`DELETE FROM sessions WHERE id IN (${placeholders})`).run(...ids);
  audit('admin.bulk_delete', null, { count: deleted.changes }, req.admin.username, req.ip);
  res.json({ ok: true, deleted: deleted.changes });
});

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

router.get('/sessions/:id/pdf', adminRequired, (req, res) => {
  let PDFDocument;
  try { PDFDocument = require('pdfkit'); } catch { return res.status(500).json({ error: 'pdfkit_not_installed' }); }

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  // Decrypt candidate data for PDF report
  row.candidate_name = decryptPII(row.candidate_name);
  row.candidate_email = decryptPII(row.candidate_email);
  row.ip_address = decryptPII(row.ip_address);
  row.user_agent = decryptPII(row.user_agent);

  let answers = {};
  try { answers = JSON.parse(row.answers || '{}'); } catch {}

  // A4 size: 595.28 x 841.89 points. Set margin to 40pt
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  
  // Register Roboto fonts to support Vietnamese (adjusted __dirname relative path)
  const fontPath = require('path').join(__dirname, '..', '..', '..', 'public', 'fonts');
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

module.exports = router;
