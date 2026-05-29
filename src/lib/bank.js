const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const BANK_FILE = path.join(DATA_DIR, 'banks.json');
const SAMPLE_BANK = path.join(__dirname, '..', '..', 'data', 'sample-bank.json');
const WRITING_BANK_FILE = path.join(__dirname, '..', '..', 'data', 'writing-bank.json');

let cached = null;

function loadWritingBank() {
  const candidates = [
    path.join(DATA_DIR, 'writing-bank.json'),
    WRITING_BANK_FILE,
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    }
  }
  return null;
}

function loadBanks() {
  if (cached) return cached;
  if (!fs.existsSync(BANK_FILE)) {
    console.warn('[bank] No data/banks.json found — falling back to sample bank.');
    cached = JSON.parse(fs.readFileSync(SAMPLE_BANK, 'utf8'));
  } else {
    cached = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8'));
  }

  // Merge writing bank (auto-scorable questions)
  const wb = loadWritingBank();
  if (wb) {
    // Replace writing track with new auto-scorable questions
    if (wb.BANK_STAFF) {
      const extra = wb.BANK_STAFF_EXTRA || [];
      cached.BANK_STAFF.writing = [...(wb.BANK_STAFF || []), ...extra];
      console.log(`[bank] Loaded ${cached.BANK_STAFF.writing.length} writing questions for BANK_STAFF`);
    }
    if (wb.BANK_OFFICE_MGR) {
      cached.BANK_OFFICE_MGR.writing = wb.BANK_OFFICE_MGR;
    } else if (wb.BANK_STAFF) {
      // Use staff writing for mgr too (filtered by level)
      const all = [...(wb.BANK_STAFF || []), ...(wb.BANK_STAFF_EXTRA || [])];
      cached.BANK_OFFICE_MGR.writing = all.filter(q => ['B2', 'C1', 'C2'].includes(q.level));
      if (cached.BANK_OFFICE_MGR.writing.length < 10) {
        cached.BANK_OFFICE_MGR.writing = all; // fallback to all
      }
    }
  }

  return cached;
}

function reload() {
  cached = null;
  return loadBanks();
}

function getBank(name) {
  const banks = loadBanks();
  if (!banks[name]) {
    throw new Error(`Bank "${name}" does not exist. Known: ${Object.keys(banks).join(', ')}`);
  }
  return banks[name];
}

const VALID_BANKS = ['BANK_STAFF', 'BANK_OFFICE_MGR'];
const VALID_TRACKS = ['listening', 'reading', 'writing'];

function assertBankTrack(bank, track) {
  if (!VALID_BANKS.includes(bank)) {
    throw new Error(`invalid bank "${bank}" — must be one of ${VALID_BANKS.join(', ')}`);
  }
  if (!VALID_TRACKS.includes(track)) {
    throw new Error(`invalid track "${track}" — must be one of ${VALID_TRACKS.join(', ')}`);
  }
}

function getItem(bank, track, id) {
  assertBankTrack(bank, track);
  const list = loadBanks()[bank][track] || [];
  return list.find((q) => q.id === id) || null;
}

function listItems(bank, track) {
  assertBankTrack(bank, track);
  return (loadBanks()[bank][track] || []).slice();
}

let writing = false;

function writeBanks(banks) {
  if (writing) throw new Error('bank_write_in_progress');
  writing = true;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${BANK_FILE}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(banks, null, 2) + '\n');
    fs.renameSync(tmp, BANK_FILE);
    cached = banks;
  } finally {
    writing = false;
  }
}

/**
 * Insert or replace one item. Returns { mode: "created" | "updated", item }.
 * When `id` is missing in `item`, generates one. When the id already exists,
 * replaces in place; otherwise appends to the track.
 */
function upsertItem(bank, track, item) {
  assertBankTrack(bank, track);
  if (!item || typeof item !== 'object') throw new Error('item must be an object');

  const banks = JSON.parse(JSON.stringify(loadBanks())); // deep clone
  const list = banks[bank][track] = banks[bank][track] || [];

  let id = item.id && String(item.id).trim();
  let mode = 'created';
  if (!id) {
    id = nextId(bank, track, item);
  }
  validateItemShape(track, { ...item, id });

  const idx = list.findIndex((q) => q.id === id);
  const finalItem = { ...item, id };
  if (idx >= 0) {
    list[idx] = finalItem;
    mode = 'updated';
  } else {
    // refuse collision with another track in the same bank (id is bank-scoped)
    for (const otherTrack of VALID_TRACKS) {
      if (otherTrack === track) continue;
      if ((banks[bank][otherTrack] || []).some((q) => q.id === id)) {
        throw new Error(`id "${id}" already exists in ${bank}.${otherTrack}`);
      }
    }
    list.push(finalItem);
  }

  writeBanks(banks);
  return { mode, item: finalItem };
}

function removeItem(bank, track, id) {
  assertBankTrack(bank, track);
  const banks = JSON.parse(JSON.stringify(loadBanks()));
  const list = banks[bank][track] || [];
  const idx = list.findIndex((q) => q.id === id);
  if (idx < 0) return { removed: false };
  list.splice(idx, 1);
  writeBanks(banks);
  return { removed: true };
}

function nextId(bank, track, item) {
  const prefix = idPrefix(bank, track, item);
  const used = new Set();
  for (const t of VALID_TRACKS) {
    for (const q of (loadBanks()[bank][t] || [])) used.add(q.id);
  }
  for (let i = 1; i < 10000; i++) {
    const candidate = `${prefix}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('could not generate a unique id');
}

function idPrefix(bank, track, item) {
  if (bank === 'BANK_OFFICE_MGR') {
    if (track === 'listening') return 'OM_L';
    if (track === 'reading')   return 'OM_R';
    if (track === 'writing')   return 'OM_W';
  }
  if (track === 'listening') return `L${item.audioFile || 'X'}Q`;
  if (track === 'reading')   return 'R';
  if (track === 'writing')   {
    const lvl = String(item.level || '').toUpperCase();
    if (lvl === 'A2') return 'WA';
    if (lvl === 'B1' || lvl === 'B2' || lvl === 'C1' || lvl === 'C2') return 'WB';
    return 'W';
  }
  return 'X';
}

function validateItemShape(track, item) {
  const must = (cond, msg) => { if (!cond) throw new Error(`item invalid: ${msg}`); };
  must(item.id && /^[A-Za-z0-9_]+$/.test(item.id), 'id must be alphanumeric/underscore');
  must(typeof item.level === 'string' && /^[A-C][12]$/.test(item.level), 'level must be A2|B1|B2|C1|C2');
  must(typeof item.topic === 'string' && item.topic.trim().length > 0, 'topic is required');

  if (track === 'listening') {
    must(typeof item.audioFile === 'string', 'audioFile is required');
    must(typeof item.question === 'string', 'question is required');
    must(Array.isArray(item.options) && item.options.length === 4, 'options must have exactly 4 entries');
    must(Number.isInteger(item.correct) && item.correct >= 0 && item.correct <= 3, 'correct must be 0..3');
    return;
  }
  if (track === 'reading') {
    must(typeof item.passage === 'string', 'passage is required');
    must(typeof item.question === 'string', 'question is required');
    must(Array.isArray(item.options) && item.options.length === 4, 'options must have exactly 4 entries');
    must(Number.isInteger(item.correct) && item.correct >= 0 && item.correct <= 3, 'correct must be 0..3');
    return;
  }
  if (track === 'writing') {
    if (item.type === 'controlled_response') {
      must(typeof item.prompt === 'string' && item.prompt.trim().length > 0, 'prompt is required');
      must(Number.isInteger(item.minWords) && item.minWords > 0, 'minWords must be a positive integer');
      must(Number.isInteger(item.maxWords) && item.maxWords > item.minWords, 'maxWords must exceed minWords');
      must(Array.isArray(item.requiredElements), 'requiredElements must be an array');
    } else if (item.type && item.type !== 'short_answer') {
      const valid = ['fill_blank', 'error_correction', 'sentence_order', 'sentence_transform'];
      must(valid.includes(item.type), `writing item type must be short_answer, controlled_response, or one of ${valid.join(', ')}`);
    } else {
      must(!item.type || item.type === 'short_answer', 'writing items must have type "short_answer"');
      must(typeof item.prompt === 'string' && item.prompt.trim().length > 0, 'prompt is required');
      must(Number.isInteger(item.minWords) && item.minWords > 0, 'minWords must be a positive integer');
      must(Number.isInteger(item.maxWords) && item.maxWords > item.minWords, 'maxWords must exceed minWords');
      must(item.rubric && Array.isArray(item.rubric.criteria) && item.rubric.criteria.length > 0,
           'rubric.criteria must be non-empty');
      const totalWeight = item.rubric.criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0);
      must(Math.abs(totalWeight - 1) < 0.01, `rubric weights must sum to 1.0 (got ${totalWeight})`);
    }
  }
}

module.exports = {
  loadBanks, reload, getBank,
  getItem, listItems, upsertItem, removeItem,
  validateItemShape,
  VALID_BANKS, VALID_TRACKS,
};
