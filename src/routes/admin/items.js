const express = require('express');
const bank = require('../../lib/bank');
const { adminRequired, requireAdminRole, audit } = require('../../lib/auth');

const router = express.Router();

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

module.exports = router;
