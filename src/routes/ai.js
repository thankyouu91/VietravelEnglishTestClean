/**
 * AI routes — writing grading, speaking assessment, question generation
 */
const express = require('express');
const db = require('../lib/db');
const { verifyExamToken } = require('../lib/auth');
const { gradeWriting, gradeSpeaking, generateWritingQuestions, generateSpeakingQuestions } = require('../lib/llm');

const router = express.Router();

// Middleware: verify exam token
function examAuth(req, res, next) {
  const token = req.body?.token || req.query.t || req.headers['x-exam-token'];
  if (!token) return res.status(401).json({ error: 'missing_token' });
  const decoded = verifyExamToken(token);
  if (!decoded) return res.status(401).json({ error: 'token_invalid' });
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(decoded.sid);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  if (session.status !== 'in_progress') {
    return res.status(403).json({ error: 'session_closed', message: 'Bài thi đã nộp hoặc không còn trong thời gian làm bài.' });
  }
  req.session = session;
  req.decoded = decoded;
  next();
}

// ── POST /api/ai/grade-writing ─────────────────────────────
// Grade a single writing answer with LLM
router.post('/grade-writing', examAuth, async (req, res) => {
  const { questionId, answer, prompt, level, minWords } = req.body;
  if (!questionId || answer === undefined) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  try {
    const result = await gradeWriting({
      prompt: prompt || '',
      answer: answer || '',
      level: level || 'B1',
      minWords: minWords || 50,
      position: req.session.position_label,
    });

    // Store AI grade in session answers
    try {
      const existing = JSON.parse(req.session.answers || '{}');
      if (!existing.ai_writing_grades) existing.ai_writing_grades = {};
      existing.ai_writing_grades[questionId] = result;
      db.prepare('UPDATE sessions SET answers = ? WHERE id = ?')
        .run(JSON.stringify(existing), req.session.id);
    } catch {}

    res.json({ ok: true, questionId, grade: result });
  } catch (err) {
    console.error('[ai/grade-writing]', err.message);
    res.status(500).json({ error: 'ai_error', message: err.message });
  }
});

// ── POST /api/ai/grade-speaking ────────────────────────────
// Grade a speaking transcript with LLM
router.post('/grade-speaking', examAuth, async (req, res) => {
  const { questionId, transcript, prompt, level } = req.body;
  if (!questionId || transcript === undefined) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  try {
    const result = await gradeSpeaking({
      prompt: prompt || '',
      transcript: transcript || '',
      level: level || 'B1',
      position: req.session.position_label,
    });

    // Store speaking grade
    try {
      const existing = JSON.parse(req.session.answers || '{}');
      if (!existing.speaking_answers) existing.speaking_answers = {};
      existing.speaking_answers[questionId] = { transcript, grade: result };
      if (!existing.speaking_scores) existing.speaking_scores = {};
      existing.speaking_scores[questionId] = result.score;
      db.prepare('UPDATE sessions SET answers = ? WHERE id = ?')
        .run(JSON.stringify(existing), req.session.id);
    } catch {}

    res.json({ ok: true, questionId, grade: result });
  } catch (err) {
    console.error('[ai/grade-speaking]', err.message);
    res.status(500).json({ error: 'ai_error', message: err.message });
  }
});

// ── GET /api/ai/writing-questions ─────────────────────────
// Generate AI writing questions for a given CEFR level
router.get('/writing-questions', examAuth, async (req, res) => {
  const level    = req.query.level || 'B1';
  const count    = Math.min(parseInt(req.query.count || '2', 10), 5);
  const position = req.session.position_label || 'staff';

  try {
    const questions = await generateWritingQuestions(level, position, count);
    res.json({ ok: true, questions });
  } catch (err) {
    console.error('[ai/writing-questions]', err.message);
    res.status(500).json({ error: 'ai_error', message: err.message });
  }
});

// ── GET /api/ai/speaking-questions ────────────────────────
// Generate AI speaking questions for a given CEFR level
router.get('/speaking-questions', examAuth, async (req, res) => {
  const level    = req.query.level || 'B1';
  const position = req.session.position_label || 'staff';

  try {
    const questions = await generateSpeakingQuestions(level, position);
    res.json({ ok: true, questions });
  } catch (err) {
    console.error('[ai/speaking-questions]', err.message);
    res.status(500).json({ error: 'ai_error', message: err.message });
  }
});

module.exports = router;
