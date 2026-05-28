const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'exam.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    exam_id             TEXT UNIQUE NOT NULL,
    candidate_name      TEXT NOT NULL,
    candidate_email     TEXT NOT NULL,
    candidate_position  TEXT NOT NULL,
    position_label      TEXT,
    is_management       INTEGER DEFAULT 0,
    ip_address          TEXT,
    user_agent          TEXT,
    consent_given       INTEGER DEFAULT 0,
    consent_at          INTEGER,
    started_at          INTEGER NOT NULL,
    submitted_at        INTEGER,
    elapsed_seconds     INTEGER,
    score_listening     INTEGER,
    score_reading       INTEGER,
    score_writing       INTEGER,
    score_speaking      REAL,
    score_total         INTEGER,
    score_max           INTEGER DEFAULT 30,
    cefr_level          TEXT,
    cefr_status         TEXT,
    question_ids        TEXT,
    answers             TEXT,
    audio_listens       TEXT DEFAULT '{}',
    cheat_events        INTEGER DEFAULT 0,
    status              TEXT DEFAULT 'in_progress'
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_email     ON sessions(candidate_email);
  CREATE INDEX IF NOT EXISTS idx_sessions_submitted ON sessions(submitted_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_status    ON sessions(status);

  CREATE TABLE IF NOT EXISTS audio_tokens (
    token       TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    audio_file  TEXT NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audio_tokens_session ON audio_tokens(session_id);

  CREATE TABLE IF NOT EXISTS admins (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    role            TEXT DEFAULT 'admin',
    created_at      INTEGER NOT NULL,
    last_login_at   INTEGER
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    actor       TEXT,
    action      TEXT NOT NULL,
    target      TEXT,
    detail      TEXT,
    ip_address  TEXT
  );

  CREATE TABLE IF NOT EXISTS invitations (
    id          TEXT PRIMARY KEY,
    name        TEXT,
    email       TEXT,
    position    TEXT,
    message     TEXT,
    created_by  TEXT,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER,
    used_at     INTEGER,
    session_id  TEXT,
    status      TEXT DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
  CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS exam_configs (
    position          TEXT PRIMARY KEY,
    config_type       TEXT DEFAULT 'random',
    selected_audio    TEXT,
    selected_passage  TEXT,
    selected_writing  TEXT
  );
`);

// Seed default exam configs if not present
try {
  const hasConfig = db.prepare("SELECT COUNT(*) c FROM exam_configs").get().c;
  if (hasConfig === 0) {
    db.prepare("INSERT INTO exam_configs (position, config_type) VALUES ('staff', 'random')").run();
    db.prepare("INSERT INTO exam_configs (position, config_type) VALUES ('manager', 'random')").run();
    console.log('[db] Seeded default exam configs');
  }
} catch (e) {
  console.error('[db] Error seeding exam configs:', e);
}

// Migration: add score_speaking column if not exists
try {
  db.prepare("SELECT score_speaking FROM sessions LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE sessions ADD COLUMN score_speaking REAL");
  console.log('[db] Migrated: added score_speaking column');
}

// Migration: add cheat_events column if not exists
try {
  db.prepare("SELECT cheat_events FROM sessions LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE sessions ADD COLUMN cheat_events INTEGER DEFAULT 0");
  console.log('[db] Migrated: added cheat_events column');
}

// Migration: add role column to admins if not exists
try {
  db.prepare("SELECT role FROM admins LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'admin'");
  console.log('[db] Migrated: added role column to admins table');
}

module.exports = db;
