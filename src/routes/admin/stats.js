const express = require('express');
const db = require('../../lib/db');
const { adminRequired, requireAdminRole } = require('../../lib/auth');

const router = express.Router();

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

router.get('/audit', adminRequired, requireAdminRole, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = db.prepare(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`).all(limit);
  res.json({ rows });
});

module.exports = router;
