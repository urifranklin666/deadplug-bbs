'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let database = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  handle        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  real_name     TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  level         INTEGER NOT NULL DEFAULT 10,
  validated     INTEGER NOT NULL DEFAULT 1,
  banned        INTEGER NOT NULL DEFAULT 0,
  credits       INTEGER NOT NULL DEFAULT 100,
  posts         INTEGER NOT NULL DEFAULT 0,
  uploads       INTEGER NOT NULL DEFAULT 0,
  downloads     INTEGER NOT NULL DEFAULT 0,
  ansi          INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  last_ip       TEXT
);

CREATE TABLE IF NOT EXISTS boards (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_level   INTEGER NOT NULL DEFAULT 0,
  read_only   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at  TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  locked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mail (
  id           INTEGER PRIMARY KEY,
  from_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  read_at      TEXT,
  from_deleted INTEGER NOT NULL DEFAULT 0,
  to_deleted   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS file_areas (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  min_level   INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY,
  area_id     INTEGER NOT NULL REFERENCES file_areas(id) ON DELETE CASCADE,
  uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  size        INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS one_liners (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS doors (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL CHECK (kind IN ('builtin','external')),
  builtin         TEXT,
  command         TEXT,
  args            TEXT NOT NULL DEFAULT '[]',
  drop_file       TEXT NOT NULL DEFAULT 'DORINFO1.DEF',
  pty             INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER NOT NULL DEFAULT 900,
  min_level       INTEGER NOT NULL DEFAULT 10,
  enabled         INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY,
  game       TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts(parent_id);
CREATE INDEX IF NOT EXISTS idx_mail_to ON mail(to_id, to_deleted, read_at);
CREATE INDEX IF NOT EXISTS idx_mail_from ON mail(from_id, from_deleted);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat(created_at);
CREATE INDEX IF NOT EXISTS idx_oneliners_created ON one_liners(created_at);
CREATE INDEX IF NOT EXISTS idx_files_area ON files(area_id, deleted);
CREATE INDEX IF NOT EXISTS idx_scores_game ON scores(game, score DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at);
`;

const DEFAULT_SETTINGS = {
  bbs_name: 'DEADPLUG BBS',
  tagline: 'Where the signal never dies',
  motd: 'Welcome to the board. Be excellent to each other.',
  splash_enabled: '1',
  registration_open: '1',
  guest_enabled: '1',
  new_user_validation: '0',
  max_users: '200',
  min_password_length: '6',
  download_cost: '0',
  max_post_length: '8000',
  chat_enabled: '1',
  oneliners_enabled: '1',
};

const DEFAULT_BOARDS = [
  ['Main Board', 'General discussion for everyone on the board.', 0, 0, 10],
  ['Announcements', 'Sysop announcements. Read-only for regular users.', 0, 1, 20],
  ['Tech Talk', 'Hardware, software, networking and retro computing.', 0, 0, 30],
  ['The Lounge', 'Off-topic conversation and general nonsense.', 0, 0, 40],
];

const DEFAULT_AREAS = [
  ['General Files', 'Anything useful or interesting.', 0, 10],
  ['BBS Utilities', 'Doors, terminal clients and BBS tooling.', 0, 20],
];

const DEFAULT_DOORS = [
  ['Blackjack', 'Beat the dealer. Wager your credits.', 'builtin', 'blackjack', '[]', 'none', 0, 300, 10, 10],
  ['Trivia', 'Seven questions. How much do you remember?', 'builtin', 'trivia', '[]', 'none', 0, 600, 10, 20],
  ['The Dungeon', 'A short text crawl for glory and credits.', 'builtin', 'dungeon', '[]', 'none', 0, 900, 10, 30],
];

function nowIso() {
  return new Date().toISOString();
}

function initDb(filename) {
  if (database) closeDb();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  database = new DatabaseSync(filename);
  // Set the busy handler before switching journal modes: journal_mode is a
  // write, and a concurrent writer (e.g. a restart overlapping the old process)
  // otherwise fails immediately with SQLITE_BUSY.
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(SCHEMA);
  seed();
  return database;
}

function seed() {
  const db = database;
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

  const boardCount = db.prepare('SELECT COUNT(*) AS n FROM boards').get().n;
  if (boardCount === 0) {
    const insert = db.prepare(
      'INSERT INTO boards (name, description, min_level, read_only, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [name, description, minLevel, readOnly, order] of DEFAULT_BOARDS) {
      insert.run(name, description, minLevel, readOnly, order, nowIso());
    }
  }

  const areaCount = db.prepare('SELECT COUNT(*) AS n FROM file_areas').get().n;
  if (areaCount === 0) {
    const insert = db.prepare(
      'INSERT INTO file_areas (name, description, min_level, sort_order) VALUES (?, ?, ?, ?)'
    );
    for (const [name, description, minLevel, order] of DEFAULT_AREAS) {
      insert.run(name, description, minLevel, order);
    }
  }

  const doorCount = db.prepare('SELECT COUNT(*) AS n FROM doors').get().n;
  if (doorCount === 0) {
    const insert = db.prepare(
      `INSERT INTO doors
       (name, description, kind, builtin, args, drop_file, pty, timeout_seconds, min_level, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of DEFAULT_DOORS) insert.run(...row);
  }
}

function getDb() {
  if (!database) throw new Error('Database not initialised');
  return database;
}

function closeDb() {
  if (database) {
    try {
      database.close();
    } catch {
      // already closed
    }
    database = null;
  }
}

function lastId(result) {
  return Number(result.lastInsertRowid);
}

function getSetting(key, fallback = '') {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function audit(userId, action, detail = '', ip = '') {
  getDb()
    .prepare('INSERT INTO audit (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, action, String(detail).slice(0, 500), ip, nowIso());
}

module.exports = {
  initDb,
  getDb,
  closeDb,
  seed,
  nowIso,
  lastId,
  getSetting,
  setSetting,
  getSettings,
  audit,
  DEFAULT_SETTINGS,
};
