const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');
const { verifyExamToken } = require('../lib/auth');
const { positionInfo } = require('../lib/scoring');
const { getBank } = require('../lib/bank');

const router = express.Router();

const AUDIO_DIR     = process.env.AUDIO_DIR     || path.join(__dirname, '..', '..', 'public', 'audio');
const AUDIO_ENC_DIR = process.env.AUDIO_ENC_DIR || path.join(__dirname, '..', '..', 'public', 'audio_enc');

router.get('/:type/:file', (req, res) => {
  const { type, file } = req.params;
  
  if (!/^[a-z0-9_]+\.(mp3|vta)$/i.test(file)) return res.status(400).send('Invalid file name');
  const requestedBase = path.basename(file, path.extname(file));
  const safeName = requestedBase.replace(/[^a-z0-9_]/gi, '');

  let sessionId;
  
  if (req.query.at) {
    // Validate short-lived purpose-specific audio token
    const tokenRow = db.prepare('SELECT session_id, audio_file, expires_at FROM audio_tokens WHERE token = ?').get(req.query.at);
    if (!tokenRow) return res.status(403).send('Invalid or expired audio token');
    if (Date.now() > tokenRow.expires_at) return res.status(403).send('Audio token expired');
    if (tokenRow.audio_file.toLowerCase() !== safeName.toLowerCase()) {
      return res.status(403).send('Access denied: Audio token mismatch');
    }
    sessionId = tokenRow.session_id;
  } else {
    // Legacy / fallback via exam token
    const token = req.query.t || req.headers['x-exam-token'];
    if (!token) return res.status(401).send('Missing token');
    const decoded = verifyExamToken(token);
    if (!decoded) return res.status(401).send('Invalid token');
    sessionId = decoded.sid;
  }

  const session = db.prepare('SELECT id, status, candidate_position, question_ids, audio_listens, ip_address FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).send('Session not found');
  if (session.status === 'submitted') return res.status(409).send('Session closed');

  const { decryptPII } = require('../lib/crypto');
  const decryptedIp = decryptPII(session.ip_address);
  if (decryptedIp && decryptedIp !== req.ip) {
    return res.status(403).send('Access denied: IP mismatch');
  }

  // Verify that the file belongs to the session's assigned questions
  const posInfo = positionInfo(session.candidate_position);
  if (!posInfo) return res.status(400).send('Invalid position');
  const bank = getBank(posInfo.bank);
  const assignedListeningIds = JSON.parse(session.question_ids || '{}').listening || [];
  const assignedQuestions = bank.listening.filter(q => assignedListeningIds.includes(q.id));
  const matches = assignedQuestions.some(q => {
    const bankAudioBase = String(q.audioFile || '').replace(/\.[^/.]+$/, "");
    return bankAudioBase.toLowerCase() === safeName.toLowerCase();
  });
  if (!matches) {
    return res.status(403).send('Access denied: Audio not assigned to this session');
  }

  // Verify that a listen count was actually incremented (meaning they clicked Play in UI)
  const listens = JSON.parse(session.audio_listens || '{}');
  const used = listens[safeName] || 0;
  if (used <= 0) {
    return res.status(403).send('Access denied: Listen count not initiated. Call /api/exam/listen first.');
  }

  const dir = type === 'enc' ? AUDIO_ENC_DIR : AUDIO_DIR;
  const fullPath = path.join(dir, file);

  if (!fullPath.startsWith(path.resolve(dir))) return res.status(400).send('Invalid path');
  if (!fs.existsSync(fullPath)) return res.status(404).send('Audio not found');

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', file.endsWith('.vta') ? 'application/octet-stream' : 'audio/mpeg');
  res.sendFile(fullPath);
});

module.exports = router;
