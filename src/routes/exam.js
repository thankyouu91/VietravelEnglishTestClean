const express = require('express');
const { nanoid } = require('nanoid');
const db = require('../lib/db');
const { positionInfo, sampleQuestions, shieldForClient, scoreAnswers, calcCEFR } = require('../lib/scoring');
const { signExamToken, verifyExamToken, genExamId, audit } = require('../lib/auth');
const { getBank } = require('../lib/bank');
const { encryptPII, hashEmail } = require('../lib/crypto');

const router = express.Router();
const EXAM_DURATION_SEC = parseInt(process.env.EXAM_DURATION_SEC || '1800', 10);
const MAX_LISTENS       = parseInt(process.env.MAX_LISTENS_PER_AUDIO || '2', 10);

const startExamTx = db.transaction((sData, inviteCode) => {
  if (inviteCode) {
    const invite = db.prepare('SELECT * FROM invitations WHERE id = ?').get(inviteCode);
    if (!invite) {
      throw new Error('invitation_not_found');
    }
    if (invite.status === 'used') {
      throw new Error('invitation_already_used');
    }
    if (invite.expires_at && Date.now() > invite.expires_at) {
      throw new Error('invitation_expired');
    }
    if (invite.email && invite.email.toLowerCase() !== sData.email) {
      throw new Error('invitation_email_mismatch');
    }
    // Mark used
    db.prepare('UPDATE invitations SET status = ?, used_at = ?, session_id = ? WHERE id = ?')
      .run('used', sData.now, sData.sessionId, inviteCode);
  }
  
  db.prepare(`
    INSERT INTO sessions (
      id, exam_id, candidate_name, candidate_email, candidate_position,
      position_label, is_management, ip_address, user_agent,
      consent_given, consent_at, started_at, question_ids, answers, status,
      candidate_email_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, '{}', 'in_progress', ?)
  `).run(
    sData.sessionId, sData.examId,
    encryptPII(sData.name),
    encryptPII(sData.email),
    sData.position,
    sData.posLabel, sData.isManagement,
    encryptPII(sData.ip),
    encryptPII(sData.userAgent),
    sData.now, sData.now, sData.questionIds,
    hashEmail(sData.email)
  );
});

router.post('/start', (req, res) => {
  const { name, email, position, consent, inviteId } = req.body || {};

  if (!name || !email || !position) {
    return res.status(400).json({ error: 'missing_fields', message: 'Họ tên, email, vị trí là bắt buộc.' });
  }
  if (!consent) {
    return res.status(400).json({ error: 'consent_required', message: 'Cần đồng ý điều khoản xử lý dữ liệu cá nhân.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const posInfo = positionInfo(position);
  if (!posInfo) return res.status(400).json({ error: 'invalid_position' });

  // Rate limit check: max 3 starts per 15 minutes
  const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
  const startsCount = db.prepare(`
    SELECT COUNT(*) c FROM sessions
    WHERE candidate_email_hash = ? AND started_at > ?
  `).get(hashEmail(email), fifteenMinsAgo).c;

  if (startsCount >= 3) {
    return res.status(429).json({
      error: 'rate_limited',
      message: 'Bạn đã bắt đầu quá nhiều bài thi trong thời gian ngắn (tối đa 3 lần/15 phút). Vui lòng thử lại sau.'
    });
  }

  const recent = db.prepare(`
    SELECT id, submitted_at FROM sessions
    WHERE candidate_email_hash = ? AND status = 'submitted'
    ORDER BY submitted_at DESC LIMIT 1
  `).get(hashEmail(email));

  if (recent && Date.now() - recent.submitted_at < 24 * 3600 * 1000) {
    return res.status(429).json({
      error: 'already_taken',
      message: 'Email này đã nộp bài trong 24 giờ qua. Liên hệ HR để được mở lại.',
    });
  }

  // Invitation check if required by environment variable
  const invitationRequired = String(process.env.INVITATION_REQUIRED).toLowerCase() === 'true';
  if (invitationRequired && !inviteId) {
    return res.status(400).json({
      error: 'invitation_required',
      message: 'Yêu cầu mã mời (invitation code) để bắt đầu làm bài.'
    });
  }

  const bank = getBank(posInfo.bank);
  
  let questionSet;
  let questionIds;

  if (process.env.EXAM_ENGINE_VERSION === 'v2') {
    const examEngine = require('../lib/exam-engine');
    const built = examEngine.buildExam({
      bank,
      position,
      positionInfo: posInfo,
      config: db.prepare("SELECT * FROM exam_configs WHERE position = ?").get(position),
      blueprintVersion: process.env.EXAM_BLUEPRINT_VERSION || 'vt_3skills_v1'
    });
    questionSet = built.questionSet;
    questionIds = built.questionIds;
  } else {
    const config = db.prepare("SELECT * FROM exam_configs WHERE position = ?").get(position);
    if (config && config.config_type === 'fixed') {
      const listeningQs = bank.listening.filter(q => q.audioFile === config.selected_audio);
      const readingQs = bank.reading.filter(q => (q.passageId || q.passage || q.id) === config.selected_passage);
      const writingQs = bank.writing.filter(q => q.id === config.selected_writing);
      
      const randomSet = sampleQuestions(bank, posInfo.management);
      questionSet = {
        listening: listeningQs.length > 0 ? listeningQs : randomSet.listening,
        reading: readingQs.length > 0 ? readingQs : randomSet.reading,
        writing: writingQs.length > 0 ? writingQs : randomSet.writing
      };
    } else {
      questionSet = sampleQuestions(bank, posInfo.management);
    }
    questionIds = {
      listening: questionSet.listening.map(q => q.id),
      reading:   questionSet.reading.map(q => q.id),
      writing:   questionSet.writing.map(q => q.id),
    };
  }

  const sessionId = nanoid(21);
  const examId    = genExamId();
  const now       = Date.now();

  const sessionData = {
    sessionId,
    examId,
    name: name.trim(),
    email: email.toLowerCase(),
    position,
    posLabel: posInfo.label,
    isManagement: posInfo.management ? 1 : 0,
    ip: req.ip,
    userAgent: req.get('user-agent') || null,
    now,
    questionIds: JSON.stringify(questionIds)
  };

  try {
    startExamTx(sessionData, inviteId);
  } catch (error) {
    if (error.message === 'invitation_not_found') {
      return res.status(400).json({ error: 'invitation_not_found', message: 'Mã mời không tồn tại hoặc không hợp lệ.' });
    }
    if (error.message === 'invitation_already_used') {
      return res.status(400).json({ error: 'invitation_already_used', message: 'Mã mời đã được sử dụng.' });
    }
    if (error.message === 'invitation_expired') {
      return res.status(400).json({ error: 'invitation_expired', message: 'Mã mời đã hết hạn.' });
    }
    if (error.message === 'invitation_email_mismatch') {
      return res.status(400).json({ error: 'invitation_email_mismatch', message: 'Mã mời này được cấp cho email khác.' });
    }
    throw error;
  }

  const token = signExamToken({ sid: sessionId, eid: examId }, EXAM_DURATION_SEC + 60);

  audit('exam.start', sessionId, { email, position }, email, req.ip);

  res.json({
    sessionId,
    examId,
    token,
    durationSec: EXAM_DURATION_SEC,
    maxListens:  MAX_LISTENS,
    isManagement: posInfo.management,
    positionLabel: posInfo.label,
    questions: process.env.EXAM_ENGINE_VERSION === 'v2'
                 ? require('../lib/exam-engine').shieldForClientV2(questionSet)
                 : shieldForClient(questionSet),
  });
});

router.post('/listen', (req, res) => {
  const { token, audioFile } = req.body || {};
  if (!token || !audioFile) return res.status(400).json({ error: 'missing_fields' });

  const decoded = verifyExamToken(token);
  if (!decoded) return res.status(401).json({ error: 'token_invalid' });

  const session = db.prepare('SELECT id, candidate_position, question_ids, audio_listens, status FROM sessions WHERE id = ?').get(decoded.sid);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  if (session.status !== 'in_progress') return res.status(409).json({ error: 'session_closed' });

  const safeName = String(audioFile).replace(/[^a-z0-9_]/gi, '');

  // 1. Verify audio belongs to the session's questions
  const posInfo = positionInfo(session.candidate_position);
  if (!posInfo) return res.status(400).json({ error: 'invalid_position' });
  const bank = getBank(posInfo.bank);
  const assignedListeningIds = JSON.parse(session.question_ids || '{}').listening || [];
  const assignedQuestions = bank.listening.filter(q => assignedListeningIds.includes(q.id));
  const matches = assignedQuestions.some(q => {
    const bankAudioBase = String(q.audioFile || '').replace(/\.[^/.]+$/, "");
    return bankAudioBase.toLowerCase() === safeName.toLowerCase();
  });
  if (!matches) {
    return res.status(403).json({ error: 'access_denied', message: 'Audio này không thuộc đề thi của bạn.' });
  }

  const listens = JSON.parse(session.audio_listens || '{}');
  const used = listens[safeName] || 0;

  if (used >= MAX_LISTENS) {
    return res.status(429).json({ error: 'max_listens_exceeded', used, max: MAX_LISTENS });
  }

  listens[safeName] = used + 1;
  db.prepare('UPDATE sessions SET audio_listens = ? WHERE id = ?')
    .run(JSON.stringify(listens), decoded.sid);

  // Generate short-lived audio token
  const audioToken = nanoid(32);
  const expiresAt = Date.now() + 60 * 1000; // 60 seconds
  db.prepare('DELETE FROM audio_tokens WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO audio_tokens (token, session_id, audio_file, expires_at) VALUES (?, ?, ?, ?)')
    .run(audioToken, decoded.sid, safeName, expiresAt);

  res.json({ ok: true, used: listens[safeName], remaining: MAX_LISTENS - listens[safeName], audioToken });
});

router.post('/submit', async (req, res) => {
  const { token, answers, cheatEvents } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const decoded = verifyExamToken(token);
  if (!decoded) return res.status(401).json({ error: 'token_invalid' });

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(decoded.sid);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  if (session.status === 'submitted' || session.status === 'pending_review') {
    return res.status(409).json({ error: 'already_submitted' });
  }

  const posInfo = positionInfo(session.candidate_position);
  if (!posInfo) return res.status(500).json({ error: 'position_misconfigured' });

  const bank = getBank(posInfo.bank);
  const ids = JSON.parse(session.question_ids);

  const restore = (track) => {
    const byId = Object.fromEntries(bank[track].map(q => [q.id, q]));
    return ids[track].map(id => byId[id]).filter(Boolean);
  };
  const questionSet = {
    listening: restore('listening'),
    reading:   restore('reading'),
    writing:   restore('writing'),
  };

  let scoring;
  try {
    scoring = await scoreAnswers(questionSet, answers || {}, { session, posInfo, bank });
  } catch (err) {
    return res.status(500).json({ error: 'scoring_failed', message: err.message });
  }
  const { scores, total, details, flags } = scoring;

  const pendingReview = !!flags.writing_pending_review;
  const newStatus = pendingReview ? 'pending_review' : 'submitted';
  let cefr;
  if (pendingReview) {
    cefr = { level: null, status: 'pending_review', label: 'Đang chờ chấm điểm phần Viết' };
  } else if (process.env.SCORING_VERSION === 'v2') {
    cefr = require('../lib/scoring-v2/bands').calcBandV2(total, session.is_management ? 'manager' : 'staff', scores, flags);
  } else {
    cefr = require('../lib/scoring').calcCEFR(total, !!session.is_management);
  }

  const now = Date.now();
  const elapsed = Math.floor((now - session.started_at) / 1000);

  db.prepare(`
    UPDATE sessions
       SET submitted_at = ?, elapsed_seconds = ?, answers = ?,
           score_listening = ?, score_reading = ?, score_writing = ?,
           score_total = ?, cefr_level = ?, cefr_status = ?, status = ?,
           cheat_events = ?
     WHERE id = ?
  `).run(
    now, elapsed, JSON.stringify({ answers: answers || {}, details, flags }),
    scores.listening, scores.reading, scores.writing,
    total, cefr.level, cefr.status, newStatus,
    parseInt(cheatEvents, 10) || 0,
    decoded.sid
  );

  const { decryptPII } = require('../lib/crypto');
  const decryptedEmail = decryptPII(session.candidate_email);
  const decryptedName = decryptPII(session.candidate_name);

  audit('exam.submit', decoded.sid,
    { total, cefr: cefr.level, status: newStatus },
    decryptedEmail, req.ip);

  res.json({
    examId: session.exam_id,
    candidate: {
      name: decryptedName,
      email: decryptedEmail,
      position: session.position_label,
    },
    score: { ...scores, total, max: 30 },
    cefr,
    status: newStatus,
    pendingReview,
    elapsedSeconds: elapsed,
    submittedAt: now,
  });
});

// Public, unauthenticated lookup by exam_id. Must NOT expose candidate PII
// (name/email) — only the exam status and scores keyed by the exam id.
router.get('/status/:examId', (req, res) => {
  const row = db.prepare(`
    SELECT exam_id, status,
           score_total, score_listening, score_reading, score_writing,
           cefr_level, cefr_status, submitted_at, elapsed_seconds
      FROM sessions WHERE exam_id = ?
  `).get(req.params.examId);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(row);
});

module.exports = router;
