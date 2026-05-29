const express = require('express');
const db = require('../../lib/db');
const bank = require('../../lib/bank');
const { adminRequired, requireAdminRole, audit } = require('../../lib/auth');

const router = express.Router();

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

module.exports = router;
