'use strict';

const { getDb, nowIso, lastId } = require('./db');
const { sanitize } = require('./ansi');
const { findUserByHandle } = require('./auth');

const MAX_SUBJECT = 60;
const MAX_BODY = 8000;

function sendMail({ fromId, toHandle, subject, body }) {
  const recipient = findUserByHandle(toHandle);
  if (!recipient) throw new Error('No such user.');
  if (recipient.id === Number(fromId)) throw new Error('You cannot mail yourself.');
  const cleanBody = sanitize(body, MAX_BODY).trim();
  if (!cleanBody) throw new Error('Message body is empty.');
  const result = getDb()
    .prepare('INSERT INTO mail (from_id, to_id, subject, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(
      Number(fromId),
      recipient.id,
      sanitize(subject, MAX_SUBJECT).trim() || '(no subject)',
      cleanBody,
      nowIso()
    );
  return getDb().prepare('SELECT * FROM mail WHERE id = ?').get(lastId(result));
}

function unreadCount(userId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS n FROM mail WHERE to_id = ? AND to_deleted = 0 AND read_at IS NULL')
    .get(Number(userId)).n;
}

function inbox(userId, { limit = 25, offset = 0 } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.id, m.subject, m.created_at, m.read_at, u.handle AS from_handle
       FROM mail m JOIN users u ON u.id = m.from_id
       WHERE m.to_id = ? AND m.to_deleted = 0
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(Number(userId), Number(limit), Number(offset));
  const total = db
    .prepare('SELECT COUNT(*) AS n FROM mail WHERE to_id = ? AND to_deleted = 0')
    .get(Number(userId)).n;
  return { rows, total };
}

function sent(userId, { limit = 25 } = {}) {
  return getDb()
    .prepare(
      `SELECT m.id, m.subject, m.created_at, m.read_at, u.handle AS to_handle
       FROM mail m JOIN users u ON u.id = m.to_id
       WHERE m.from_id = ? AND m.from_deleted = 0
       ORDER BY m.created_at DESC LIMIT ?`
    )
    .all(Number(userId), Number(limit));
}

function openMail(userId, mailId, { markRead = true } = {}) {
  const db = getDb();
  const mail = db
    .prepare(
      `SELECT m.*, f.handle AS from_handle, t.handle AS to_handle
       FROM mail m JOIN users f ON f.id = m.from_id JOIN users t ON t.id = m.to_id
       WHERE m.id = ?`
    )
    .get(Number(mailId));
  if (!mail) return null;
  const isRecipient = mail.to_id === Number(userId) && !mail.to_deleted;
  const isSender = mail.from_id === Number(userId) && !mail.from_deleted;
  if (!isRecipient && !isSender) return null;
  if (isRecipient && markRead && !mail.read_at) {
    db.prepare('UPDATE mail SET read_at = ? WHERE id = ?').run(nowIso(), mail.id);
    mail.read_at = nowIso();
  }
  return mail;
}

function deleteMail(userId, mailId) {
  const db = getDb();
  const mail = db.prepare('SELECT * FROM mail WHERE id = ?').get(Number(mailId));
  if (!mail) return false;
  let changed = false;
  if (mail.to_id === Number(userId) && !mail.to_deleted) {
    db.prepare('UPDATE mail SET to_deleted = 1 WHERE id = ?').run(mail.id);
    changed = true;
  }
  if (mail.from_id === Number(userId) && !mail.from_deleted) {
    db.prepare('UPDATE mail SET from_deleted = 1 WHERE id = ?').run(mail.id);
    changed = true;
  }
  if (mail.to_deleted && mail.from_deleted) db.prepare('DELETE FROM mail WHERE id = ?').run(mail.id);
  return changed;
}

function deleteAll(userId, box = 'inbox') {
  if (box === 'sent') {
    return getDb().prepare('UPDATE mail SET from_deleted = 1 WHERE from_id = ?').run(Number(userId)).changes;
  }
  return getDb().prepare('UPDATE mail SET to_deleted = 1 WHERE to_id = ?').run(Number(userId)).changes;
}

module.exports = {
  sendMail,
  unreadCount,
  inbox,
  sent,
  openMail,
  deleteMail,
  deleteAll,
};
