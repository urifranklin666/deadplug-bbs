'use strict';

const { getDb, nowIso, lastId } = require('./db');
const { sanitize } = require('./ansi');

const CHAT_COOLDOWN_MS = 2000;
const ONELINER_COOLDOWN_MS = 30000;

function postChat(userId, body) {
  const db = getDb();
  const text = sanitize(body, 160).replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Empty message.');
  const last = db
    .prepare('SELECT created_at FROM chat WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(Number(userId));
  if (last && Date.now() - new Date(last.created_at).getTime() < CHAT_COOLDOWN_MS) {
    throw new Error('Slow down a little.');
  }
  const result = db
    .prepare('INSERT INTO chat (user_id, body, created_at) VALUES (?, ?, ?)')
    .run(Number(userId), text, nowIso());
  db.prepare('DELETE FROM chat WHERE id < (SELECT MAX(id) - 500 FROM chat)').run();
  return db.prepare('SELECT * FROM chat WHERE id = ?').get(lastId(result));
}

function recentChat(limit = 15) {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.handle
       FROM chat c JOIN users u ON u.id = c.user_id
       ORDER BY c.id DESC LIMIT ?`
    )
    .all(Number(limit));
  return rows.reverse();
}

function postOneLiner(userId, body) {
  const db = getDb();
  const text = sanitize(body, 70).replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Empty one-liner.');
  const last = db
    .prepare('SELECT created_at FROM one_liners WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(Number(userId));
  if (last && Date.now() - new Date(last.created_at).getTime() < ONELINER_COOLDOWN_MS) {
    throw new Error('One one-liner every 30 seconds.');
  }
  const result = db
    .prepare('INSERT INTO one_liners (user_id, body, created_at) VALUES (?, ?, ?)')
    .run(Number(userId), text, nowIso());
  return db.prepare('SELECT * FROM one_liners WHERE id = ?').get(lastId(result));
}

function recentOneLiners(limit = 15) {
  return getDb()
    .prepare(
      `SELECT o.id, o.body, o.created_at, o.user_id, u.handle
       FROM one_liners o JOIN users u ON u.id = o.user_id
       WHERE o.deleted = 0 ORDER BY o.id DESC LIMIT ?`
    )
    .all(Number(limit));
}

function deleteOneLiner(id, { userId = 0, level = 0 } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM one_liners WHERE id = ?').get(Number(id));
  if (!row || row.deleted) return false;
  if (row.user_id !== Number(userId) && Number(level) < 100) return false;
  db.prepare('UPDATE one_liners SET deleted = 1 WHERE id = ?').run(row.id);
  return true;
}

function clearChat() {
  return getDb().prepare('DELETE FROM chat').changes;
}

module.exports = {
  postChat,
  recentChat,
  postOneLiner,
  recentOneLiners,
  deleteOneLiner,
  clearChat,
  CHAT_COOLDOWN_MS,
  ONELINER_COOLDOWN_MS,
};
