const express = require('express');
const db = require('../../lib/db');
const bank = require('../../lib/bank');
const { calcCEFR } = require('../../lib/scoring');
const { adminRequired, requireRole, audit } = require('../../lib/auth');

const router = express.Router();

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

module.exports = router;
