/**
 * Bank Manager API — CRUD for question bank + Excel import/export
 */
const express = require('express');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { adminRequired, requireAdminRole, audit } = require('../lib/auth');

const router = express.Router();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const WRITING_BANK_FILE = path.join(DATA_DIR, 'writing-bank.json');
const MAIN_BANK_FILE = path.join(DATA_DIR, 'banks.json');

// ── Helpers ────────────────────────────────────────────────
function readBank(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeBank(file, data) {
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, file);
}

function validateItemShape(skill, q) {
  if (!q || typeof q !== 'object') {
    throw new Error('Câu hỏi phải là một object.');
  }
  if (!q.id || typeof q.id !== 'string' || !q.id.trim()) {
    throw new Error('Mã câu hỏi (id) không hợp lệ hoặc bị thiếu.');
  }
  if (!q.level || typeof q.level !== 'string' || !['B1', 'B2', 'C1'].includes(q.level.toUpperCase())) {
    throw new Error(`Cấp độ (level) "${q.level}" không hợp lệ (phải là B1, B2, C1).`);
  }
  
  if (skill === 'writing') {
    const validTypes = ['fill_blank', 'error_correction', 'sentence_order', 'sentence_transform'];
    if (!validTypes.includes(q.type)) {
      throw new Error(`Loại câu hỏi viết "${q.type}" không hợp lệ.`);
    }
    if (q.type === 'fill_blank') {
      if (!q.passage || typeof q.passage !== 'string') {
        throw new Error('Thiếu đoạn văn (passage) cho câu hỏi fill_blank.');
      }
      if (!Array.isArray(q.options) || q.options.length === 0) {
        throw new Error('Thiếu hoặc sai định dạng danh sách options cho câu hỏi fill_blank.');
      }
      if (!q.blanks || typeof q.blanks !== 'object' || Object.keys(q.blanks).length === 0) {
        throw new Error('Thiếu hoặc sai định dạng danh sách blanks cho câu hỏi fill_blank.');
      }
    } else if (q.type === 'error_correction') {
      if (!Array.isArray(q.sentences) || q.sentences.length === 0) {
        throw new Error('Thiếu danh sách sentences cho câu hỏi error_correction.');
      }
      q.sentences.forEach((s, idx) => {
        if (!s.original || typeof s.original !== 'string') {
          throw new Error(`Sentence thứ ${idx+1} thiếu câu gốc (original).`);
        }
        if (!Array.isArray(s.options) || s.options.length === 0) {
          throw new Error(`Sentence thứ ${idx+1} thiếu hoặc sai định dạng options.`);
        }
        if (typeof s.correct !== 'number' || s.correct < 0 || s.correct >= s.options.length) {
          throw new Error(`Sentence thứ ${idx+1} chỉ số đáp án đúng (correct) không hợp lệ.`);
        }
      });
    } else if (q.type === 'sentence_order') {
      if (!Array.isArray(q.sentences) || q.sentences.length === 0) {
        throw new Error('Thiếu danh sách sentences cho câu hỏi sentence_order.');
      }
      if (!Array.isArray(q.correct_order) || q.correct_order.length !== q.sentences.length) {
        throw new Error('Thiếu hoặc độ dài correct_order không khớp với sentences.');
      }
      q.correct_order.forEach((val, idx) => {
        if (typeof val !== 'number' || val < 1 || val > q.sentences.length) {
          throw new Error(`Giá trị correct_order tại vị trí thứ ${idx+1} không hợp lệ (phải từ 1 đến số câu).`);
        }
      });
    } else if (q.type === 'sentence_transform') {
      if (!Array.isArray(q.sentences) || q.sentences.length === 0) {
        throw new Error('Thiếu danh sách sentences cho câu hỏi sentence_transform.');
      }
      q.sentences.forEach((s, idx) => {
        if (!s.original || typeof s.original !== 'string') {
          throw new Error(`Sentence thứ ${idx+1} thiếu câu gốc (original).`);
        }
        if (!s.keyword || typeof s.keyword !== 'string') {
          throw new Error(`Sentence thứ ${idx+1} thiếu keyword.`);
        }
        if (!Array.isArray(s.accept) || s.accept.length === 0) {
          throw new Error(`Sentence thứ ${idx+1} thiếu danh sách các câu trả lời chấp nhận (accept).`);
        }
      });
    }
  } else if (skill === 'listening' || skill === 'reading') {
    if (!q.question || typeof q.question !== 'string' || !q.question.trim()) {
      throw new Error('Thiếu nội dung câu hỏi (question).');
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error('Danh sách lựa chọn (options) phải có đúng 4 câu trả lời.');
    }
    q.options.forEach((opt, idx) => {
      if (typeof opt !== 'string' || !opt.trim()) {
        throw new Error(`Lựa chọn thứ ${idx+1} trống hoặc không hợp lệ.`);
      }
    });
    if (typeof q.correct !== 'number' || q.correct < 0 || q.correct > 3) {
      throw new Error('Chỉ số đáp án đúng (correct) phải là số từ 0 đến 3.');
    }
    
    if (skill === 'listening') {
      if (!q.audioFile || typeof q.audioFile !== 'string' || !q.audioFile.trim()) {
        throw new Error('Thiếu đường dẫn file âm thanh (audioFile).');
      }
    } else { // reading
      if (!q.passage || typeof q.passage !== 'string' || !q.passage.trim()) {
        throw new Error('Thiếu đoạn văn đọc hiểu (passage).');
      }
    }
  } else {
    throw new Error(`Kỹ năng "${skill}" không được hỗ trợ để kiểm tra.`);
  }
}

function getWritingBank() {
  let bank = readBank(WRITING_BANK_FILE);
  if (!bank) bank = { BANK_STAFF: [], BANK_STAFF_EXTRA: [] };
  return bank;
}

function getMainBank() {
  let bank = readBank(MAIN_BANK_FILE);
  if (!bank) bank = { BANK_STAFF: { listening: [], reading: [], writing: [] }, BANK_OFFICE_MGR: { listening: [], reading: [], writing: [] } };
  return bank;
}

// ── POST /upload-audio — Direct binary MP3 upload ─────────
router.post('/upload-audio', adminRequired, requireAdminRole, (req, res) => {
  const fileName = req.query.filename;
  if (!fileName) return res.status(400).json({ error: 'missing_filename' });

  const safeName = path.basename(fileName).replace(/[^a-z0-9_.-]/gi, '');
  if (!safeName.toLowerCase().endsWith('.mp3')) {
    return res.status(400).json({ error: 'invalid_file_type', message: 'Chỉ chấp nhận file .mp3' });
  }

  const mimeType = req.headers['content-type'];
  if (!mimeType || !mimeType.startsWith('audio/')) {
    return res.status(400).json({ error: 'invalid_mime_type', message: 'Content-Type phải là kiểu audio/.' });
  }

  const AUDIO_DIR = process.env.AUDIO_DIR || path.join(__dirname, '..', '..', 'public', 'audio');
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }

  const destPath = path.join(AUDIO_DIR, safeName);
  
  let bytesReceived = 0;
  const MAX_SIZE = 20 * 1024 * 1024; // 20MB
  let isHeaderChecked = false;
  let fileDescriptor = null;
  let hasAborted = false;

  const cleanUpFile = () => {
    if (fileDescriptor !== null) {
      try { fs.closeSync(fileDescriptor); } catch(e) {}
      fileDescriptor = null;
    }
    try {
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
    } catch(e) {}
  };

  try {
    fileDescriptor = fs.openSync(destPath, 'w');
  } catch (err) {
    return res.status(500).json({ error: 'create_failed', message: err.message });
  }

  req.on('data', (chunk) => {
    if (hasAborted) return;
    
    bytesReceived += chunk.length;
    if (bytesReceived > MAX_SIZE) {
      hasAborted = true;
      req.destroy();
      cleanUpFile();
      return res.status(413).json({ error: 'file_too_large', message: 'Kích thước file vượt quá giới hạn 20MB.' });
    }

    if (!isHeaderChecked) {
      isHeaderChecked = true;
      const isID3 = chunk.length >= 3 && chunk[0] === 0x49 && chunk[1] === 0x44 && chunk[2] === 0x33;
      const isSyncFrame = chunk.length >= 2 && chunk[0] === 0xFF && (chunk[1] & 0xE0) === 0xE0;
      
      if (!isID3 && !isSyncFrame) {
        hasAborted = true;
        req.destroy();
        cleanUpFile();
        return res.status(400).json({ error: 'invalid_signature', message: 'Tệp không phải là định dạng MP3 hợp lệ (thiếu ID3 hoặc sync frame).' });
      }
    }

    try {
      fs.writeSync(fileDescriptor, chunk);
    } catch (err) {
      hasAborted = true;
      req.destroy();
      cleanUpFile();
      return res.status(500).json({ error: 'write_failed', message: err.message });
    }
  });

  req.on('end', () => {
    if (hasAborted) return;
    
    if (fileDescriptor !== null) {
      try { fs.closeSync(fileDescriptor); } catch(e) {}
      fileDescriptor = null;
    }
    
    audit('admin.upload_audio', safeName, null, req.admin.username, req.ip);
    res.json({ ok: true, filename: safeName.substring(0, safeName.lastIndexOf('.')) });
  });

  req.on('aborted', () => {
    hasAborted = true;
    cleanUpFile();
  });

  req.on('close', () => {
    if (!req.readableEnded && !hasAborted) {
      hasAborted = true;
      cleanUpFile();
    }
  });

  req.on('error', (err) => {
    if (hasAborted) return;
    hasAborted = true;
    cleanUpFile();
    res.status(500).json({ error: 'stream_error', message: err.message });
  });
});

// ── GET /summary — overview of all banks ───────────────────
router.get('/summary', adminRequired, requireAdminRole, (req, res) => {
  const main = getMainBank();
  const writing = getWritingBank();

  const summary = {
    listening: {
      BANK_STAFF: (main.BANK_STAFF?.listening || []).length,
      BANK_OFFICE_MGR: (main.BANK_OFFICE_MGR?.listening || []).length,
    },
    reading: {
      BANK_STAFF: (main.BANK_STAFF?.reading || []).length,
      BANK_OFFICE_MGR: (main.BANK_OFFICE_MGR?.reading || []).length,
    },
    writing: {
      BANK_STAFF: (writing.BANK_STAFF || []).length,
      BANK_STAFF_EXTRA: (writing.BANK_STAFF_EXTRA || []).length,
      total: (writing.BANK_STAFF || []).length + (writing.BANK_STAFF_EXTRA || []).length,
    },
  };
  res.json(summary);
});

// ── GET /questions — list questions by skill ───────────────
router.get('/questions', adminRequired, requireAdminRole, (req, res) => {
  const { skill, bank: bankName, level } = req.query;
  if (!skill) return res.status(400).json({ error: 'missing_skill' });

  let items = [];

  if (skill === 'writing') {
    const wb = getWritingBank();
    items = [...(wb.BANK_STAFF || []), ...(wb.BANK_STAFF_EXTRA || [])];
  } else {
    const main = getMainBank();
    const bn = bankName || 'BANK_STAFF';
    items = main[bn]?.[skill] || [];
  }

  if (level) items = items.filter(q => q.level === level);

  res.json({ skill, count: items.length, items });
});

// ── POST /questions — add a question ───────────────────────
router.post('/questions', adminRequired, requireAdminRole, (req, res) => {
  const { skill, question } = req.body;
  if (!skill || !question) return res.status(400).json({ error: 'missing_fields' });
  if (!question.id) question.id = `${skill[0].toUpperCase()}${Date.now().toString(36).toUpperCase()}`;

  if (skill === 'writing') {
    const wb = getWritingBank();
    // Check duplicate ID
    const all = [...(wb.BANK_STAFF || []), ...(wb.BANK_STAFF_EXTRA || [])];
    if (all.find(q => q.id === question.id)) {
      return res.status(409).json({ error: 'duplicate_id' });
    }
    wb.BANK_STAFF_EXTRA = wb.BANK_STAFF_EXTRA || [];
    wb.BANK_STAFF_EXTRA.push(question);
    writeBank(WRITING_BANK_FILE, wb);
  } else {
    const main = getMainBank();
    const bankName = req.body.bank || 'BANK_STAFF';
    if (!main[bankName]) main[bankName] = { listening: [], reading: [], writing: [] };
    if (!main[bankName][skill]) main[bankName][skill] = [];
    main[bankName][skill].push(question);
    writeBank(MAIN_BANK_FILE, main);
  }

  // Reload bank cache
  try { require('../lib/bank').reload(); } catch {}

  audit('bank.add_question', question.id, { skill, level: question.level }, req.admin.username, req.ip);
  res.json({ ok: true, id: question.id });
});

// ── POST /ai-generate — generate AI questions ──────────────────
router.post('/ai-generate', adminRequired, requireAdminRole, async (req, res) => {
  const { skill, level, count } = req.body;
  if (skill !== 'writing') return res.status(400).json({ error: 'unsupported_skill' });
  
  try {
    const { generateWritingQuestions } = require('../lib/llm');
    const questions = await generateWritingQuestions(level || 'B1', 'staff', count || 1);
    
    // Add to bank
    const wb = getWritingBank();
    wb.BANK_STAFF_EXTRA = wb.BANK_STAFF_EXTRA || [];
    const added = [];
    for (const q of questions) {
      const all = [...(wb.BANK_STAFF || []), ...(wb.BANK_STAFF_EXTRA || [])];
      if (!all.find(exist => exist.id === q.id)) {
        wb.BANK_STAFF_EXTRA.push(q);
        added.push(q);
      }
    }
    writeBank(WRITING_BANK_FILE, wb);
    try { require('../lib/bank').reload(); } catch {}
    
    audit('bank.ai_generate', null, { skill, level, generated: added.length }, req.admin.username, req.ip);
    res.json({ ok: true, generated: added.length, items: added });
  } catch (err) {
    console.error('[bank/ai-generate]', err.message);
    res.status(500).json({ error: 'ai_error', message: err.message });
  }
});

// ── PUT /questions/:id — update a question ─────────────────
router.put('/questions/:id', adminRequired, requireAdminRole, (req, res) => {
  const { skill, question } = req.body;
  if (!skill || !question) return res.status(400).json({ error: 'missing_fields' });

  if (skill === 'writing') {
    const wb = getWritingBank();
    let found = false;
    for (const pool of ['BANK_STAFF', 'BANK_STAFF_EXTRA']) {
      if (!wb[pool]) continue;
      const idx = wb[pool].findIndex(q => q.id === req.params.id);
      if (idx !== -1) { wb[pool][idx] = { ...question, id: req.params.id }; found = true; break; }
    }
    if (!found) return res.status(404).json({ error: 'not_found' });
    writeBank(WRITING_BANK_FILE, wb);
  } else {
    const main = getMainBank();
    let found = false;
    for (const bn of ['BANK_STAFF', 'BANK_OFFICE_MGR']) {
      if (!main[bn]?.[skill]) continue;
      const idx = main[bn][skill].findIndex(q => q.id === req.params.id);
      if (idx !== -1) { main[bn][skill][idx] = { ...question, id: req.params.id }; found = true; break; }
    }
    if (!found) return res.status(404).json({ error: 'not_found' });
    writeBank(MAIN_BANK_FILE, main);
  }

  try { require('../lib/bank').reload(); } catch {}
  audit('bank.update_question', req.params.id, { skill }, req.admin.username, req.ip);
  res.json({ ok: true });
});

// ── DELETE /questions/:id ──────────────────────────────────
router.delete('/questions/:id', adminRequired, requireAdminRole, (req, res) => {
  const { skill } = req.query;
  if (!skill) return res.status(400).json({ error: 'missing_skill' });

  let found = false;

  if (skill === 'writing') {
    const wb = getWritingBank();
    for (const pool of ['BANK_STAFF', 'BANK_STAFF_EXTRA']) {
      if (!wb[pool]) continue;
      const idx = wb[pool].findIndex(q => q.id === req.params.id);
      if (idx !== -1) { wb[pool].splice(idx, 1); found = true; break; }
    }
    if (found) writeBank(WRITING_BANK_FILE, wb);
  } else {
    const main = getMainBank();
    for (const bn of ['BANK_STAFF', 'BANK_OFFICE_MGR']) {
      if (!main[bn]?.[skill]) continue;
      const idx = main[bn][skill].findIndex(q => q.id === req.params.id);
      if (idx !== -1) { main[bn][skill].splice(idx, 1); found = true; break; }
    }
    if (found) writeBank(MAIN_BANK_FILE, main);
  }

  if (!found) return res.status(404).json({ error: 'not_found' });
  try { require('../lib/bank').reload(); } catch {}
  audit('bank.delete_question', req.params.id, { skill }, req.admin.username, req.ip);
  res.json({ ok: true });
});

// ── GET /export-template — download Excel template ─────────
router.get('/export-template', adminRequired, requireAdminRole, async (req, res) => {
  const skill = req.query.skill || 'writing';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Vietravel Exam';

  if (skill === 'writing') {
    // Fill Blank sheet
    const ws1 = wb.addWorksheet('Fill Blank');
    ws1.columns = [
      { header: 'ID', key: 'id', width: 12 },
      { header: 'Level (A1/A2/B1/B2/C1/C2)', key: 'level', width: 12 },
      { header: 'Topic', key: 'topic', width: 20 },
      { header: 'Instruction', key: 'instruction', width: 40 },
      { header: 'Passage (dùng ___1___, ___2___ cho chỗ trống)', key: 'passage', width: 60 },
      { header: 'Options (cách nhau bởi |)', key: 'options', width: 40 },
      { header: 'Answers (1=word1|2=word2|3=word3...)', key: 'blanks', width: 40 },
    ];
    ws1.getRow(1).font = { bold: true };
    ws1.addRow({ id: 'WFB01', level: 'B1', topic: 'Hotel Email', instruction: 'Complete the email with correct words.', passage: 'Dear Guest, Thank you for your ___1___. Your room is ___2___ for 2 nights.', options: 'reservation|confirmed|after', blanks: '1=reservation|2=confirmed' });

    // Error Correction sheet
    const ws2 = wb.addWorksheet('Error Correction');
    ws2.columns = [
      { header: 'ID', key: 'id', width: 12 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Topic', key: 'topic', width: 20 },
      { header: 'Instruction', key: 'instruction', width: 40 },
      { header: 'Sentence 1 (sai)', key: 's1_original', width: 40 },
      { header: 'Option A', key: 's1_a', width: 40 },
      { header: 'Option B', key: 's1_b', width: 40 },
      { header: 'Option C', key: 's1_c', width: 40 },
      { header: 'Correct (0=A, 1=B, 2=C)', key: 's1_correct', width: 10 },
      { header: 'Sentence 2 (sai)', key: 's2_original', width: 40 },
      { header: 'Option A', key: 's2_a', width: 40 },
      { header: 'Option B', key: 's2_b', width: 40 },
      { header: 'Option C', key: 's2_c', width: 40 },
      { header: 'Correct', key: 's2_correct', width: 10 },
      { header: 'Sentence 3 (sai)', key: 's3_original', width: 40 },
      { header: 'Option A', key: 's3_a', width: 40 },
      { header: 'Option B', key: 's3_b', width: 40 },
      { header: 'Option C', key: 's3_c', width: 40 },
      { header: 'Correct', key: 's3_correct', width: 10 },
    ];
    ws2.getRow(1).font = { bold: true };

    // Sentence Order sheet
    const ws3 = wb.addWorksheet('Sentence Order');
    ws3.columns = [
      { header: 'ID', key: 'id', width: 12 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Topic', key: 'topic', width: 20 },
      { header: 'Instruction', key: 'instruction', width: 40 },
      { header: 'Sentence 1', key: 's1', width: 50 },
      { header: 'Sentence 2', key: 's2', width: 50 },
      { header: 'Sentence 3', key: 's3', width: 50 },
      { header: 'Sentence 4', key: 's4', width: 50 },
      { header: 'Sentence 5', key: 's5', width: 50 },
      { header: 'Correct Order (vd: 1,3,0,2,4)', key: 'order', width: 20 },
    ];
    ws3.getRow(1).font = { bold: true };

    // Sentence Transform sheet
    const ws4 = wb.addWorksheet('Sentence Transform');
    ws4.columns = [
      { header: 'ID', key: 'id', width: 12 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Topic', key: 'topic', width: 20 },
      { header: 'Instruction', key: 'instruction', width: 40 },
      { header: 'Original 1', key: 's1_orig', width: 50 },
      { header: 'Keyword 1', key: 's1_kw', width: 15 },
      { header: 'Accepted answers 1 (cách bởi |)', key: 's1_accept', width: 60 },
      { header: 'Original 2', key: 's2_orig', width: 50 },
      { header: 'Keyword 2', key: 's2_kw', width: 15 },
      { header: 'Accepted answers 2', key: 's2_accept', width: 60 },
      { header: 'Original 3', key: 's3_orig', width: 50 },
      { header: 'Keyword 3', key: 's3_kw', width: 15 },
      { header: 'Accepted answers 3', key: 's3_accept', width: 60 },
    ];
    ws4.getRow(1).font = { bold: true };

  } else if (skill === 'reading') {
    const ws = wb.addWorksheet('Reading');
    ws.columns = [
      { header: 'ID', key: 'id', width: 12 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Topic', key: 'topic', width: 20 },
      { header: 'Passage', key: 'passage', width: 80 },
      { header: 'Question', key: 'question', width: 50 },
      { header: 'Option A', key: 'opt_a', width: 30 },
      { header: 'Option B', key: 'opt_b', width: 30 },
      { header: 'Option C', key: 'opt_c', width: 30 },
      { header: 'Option D', key: 'opt_d', width: 30 },
      { header: 'Correct (0=A,1=B,2=C,3=D)', key: 'correct', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };

  } else if (skill === 'listening') {
    const ws = wb.addWorksheet('Listening');
    ws.columns = [
      { header: 'ID', key: 'id', width: 12 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Topic', key: 'topic', width: 20 },
      { header: 'Audio File (tên file không có .mp3)', key: 'audioFile', width: 15 },
      { header: 'Audio Description', key: 'audio', width: 40 },
      { header: 'Question', key: 'question', width: 50 },
      { header: 'Option A', key: 'opt_a', width: 30 },
      { header: 'Option B', key: 'opt_b', width: 30 },
      { header: 'Option C', key: 'opt_c', width: 30 },
      { header: 'Option D', key: 'opt_d', width: 30 },
      { header: 'Correct (0=A,1=B,2=C,3=D)', key: 'correct', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="template-${skill}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

// ── POST /import — import from Excel ───────────────────────
router.post('/import', adminRequired, requireAdminRole, express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const skill = req.query.skill || 'writing';

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.body);

    let imported = 0;
    const errors = [];

    if (skill === 'writing') {
      const bank = getWritingBank();
      if (!bank.BANK_STAFF_EXTRA) bank.BANK_STAFF_EXTRA = [];

      // Process each sheet
      for (const ws of wb.worksheets) {
        const sheetName = ws.name.toLowerCase();
        ws.eachRow((row, rowNum) => {
          if (rowNum === 1) return; // skip header
          try {
            const id = String(row.getCell(1).value || '').trim();
            if (!id) return;

            let question = null;

            if (sheetName.includes('fill')) {
              question = {
                id, type: 'fill_blank',
                level: String(row.getCell(2).value || 'B1').trim(),
                topic: String(row.getCell(3).value || '').trim(),
                instruction: String(row.getCell(4).value || 'Complete with correct words.').trim(),
                passage: String(row.getCell(5).value || '').trim(),
                options: String(row.getCell(6).value || '').split('|').map(s => s.trim()).filter(Boolean),
                blanks: {},
              };
              String(row.getCell(7).value || '').split('|').forEach(pair => {
                const [k, v] = pair.split('=');
                if (k && v) question.blanks[k.trim()] = v.trim();
              });
            } else if (sheetName.includes('error')) {
              question = {
                id, type: 'error_correction',
                level: String(row.getCell(2).value || 'B1').trim(),
                topic: String(row.getCell(3).value || '').trim(),
                instruction: String(row.getCell(4).value || 'Choose the correct version.').trim(),
                sentences: [],
              };
              for (let s = 0; s < 3; s++) {
                const base = 5 + s * 5;
                const orig = String(row.getCell(base).value || '').trim();
                if (!orig) continue;
                question.sentences.push({
                  original: orig,
                  options: [
                    String(row.getCell(base + 1).value || '').trim(),
                    String(row.getCell(base + 2).value || '').trim(),
                    String(row.getCell(base + 3).value || '').trim(),
                  ].filter(Boolean),
                  correct: parseInt(row.getCell(base + 4).value) || 0,
                });
              }
            } else if (sheetName.includes('order')) {
              question = {
                id, type: 'sentence_order',
                level: String(row.getCell(2).value || 'B1').trim(),
                topic: String(row.getCell(3).value || '').trim(),
                instruction: String(row.getCell(4).value || 'Put sentences in correct order.').trim(),
                sentences: [],
                correct_order: [],
              };
              for (let s = 1; s <= 5; s++) {
                const val = String(row.getCell(4 + s).value || '').trim();
                if (val) question.sentences.push(val);
              }
              const orderStr = String(row.getCell(10).value || '').trim();
              question.correct_order = orderStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
            } else if (sheetName.includes('transform')) {
              question = {
                id, type: 'sentence_transform',
                level: String(row.getCell(2).value || 'B1').trim(),
                topic: String(row.getCell(3).value || '').trim(),
                instruction: String(row.getCell(4).value || 'Rewrite using the word given.').trim(),
                sentences: [],
              };
              for (let s = 0; s < 3; s++) {
                const base = 5 + s * 3;
                const orig = String(row.getCell(base).value || '').trim();
                if (!orig) continue;
                question.sentences.push({
                  original: orig,
                  keyword: String(row.getCell(base + 1).value || '').trim(),
                  accept: String(row.getCell(base + 2).value || '').split('|').map(s => s.trim()).filter(Boolean),
                });
              }
            }

            if (question) {
              // Validate question shape
              validateItemShape('writing', question);

              // Check duplicate
              const existing = [...(bank.BANK_STAFF || []), ...(bank.BANK_STAFF_EXTRA || [])];
              if (!existing.find(q => q.id === question.id)) {
                bank.BANK_STAFF_EXTRA.push(question);
                imported++;
              } else {
                errors.push(`Row ${rowNum}: ID "${id}" already exists`);
              }
            }
          } catch (e) {
            errors.push(`Row ${rowNum}: ${e.message}`);
          }
        });
      }
      writeBank(WRITING_BANK_FILE, bank);

    } else if (skill === 'reading' || skill === 'listening') {
      const main = getMainBank();
      const bankName = req.query.bank || 'BANK_STAFF';
      if (!main[bankName]) main[bankName] = { listening: [], reading: [], writing: [] };
      if (!main[bankName][skill]) main[bankName][skill] = [];

      const ws = wb.worksheets[0];
      if (ws) {
        ws.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          try {
            const id = String(row.getCell(1).value || '').trim();
            if (!id) return;
            if (main[bankName][skill].find(q => q.id === id)) {
              errors.push(`Row ${rowNum}: ID "${id}" exists`);
              return;
            }

            const question = {
              id,
              level: String(row.getCell(2).value || 'B1').trim(),
              topic: String(row.getCell(3).value || '').trim(),
            };

            if (skill === 'listening') {
              question.audioFile = String(row.getCell(4).value || '').trim();
              question.audio = String(row.getCell(5).value || '').trim();
              question.question = String(row.getCell(6).value || '').trim();
              question.options = [
                String(row.getCell(7).value || '').trim(),
                String(row.getCell(8).value || '').trim(),
                String(row.getCell(9).value || '').trim(),
                String(row.getCell(10).value || '').trim(),
              ].filter(Boolean);
              question.correct = parseInt(row.getCell(11).value) || 0;
            } else {
              question.passage = String(row.getCell(4).value || '').trim();
              question.question = String(row.getCell(5).value || '').trim();
              question.options = [
                String(row.getCell(6).value || '').trim(),
                String(row.getCell(7).value || '').trim(),
                String(row.getCell(8).value || '').trim(),
                String(row.getCell(9).value || '').trim(),
              ].filter(Boolean);
              question.correct = parseInt(row.getCell(10).value) || 0;
            }

            // Validate question shape
            validateItemShape(skill, question);

            main[bankName][skill].push(question);
            imported++;
          } catch (e) {
            errors.push(`Row ${rowNum}: ${e.message}`);
          }
        });
      }
      writeBank(MAIN_BANK_FILE, main);
    }

    // Reload bank cache
    try { require('../lib/bank').reload(); } catch {}

    audit('bank.import', null, { skill, imported, errors: errors.length }, req.admin.username, req.ip);
    res.json({ ok: true, imported, errors });
  } catch (e) {
    res.status(400).json({ error: 'import_failed', message: e.message });
  }
});

module.exports = router;
