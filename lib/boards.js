'use strict';

const { getDb, nowIso, lastId } = require('./db');
const { sanitize } = require('./ansi');

const MAX_SUBJECT = 60;

function listBoards(level = 0) {
  return getDb()
    .prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM posts p WHERE p.board_id = b.id AND p.deleted = 0) AS posts,
        (SELECT MAX(p.created_at) FROM posts p WHERE p.board_id = b.id AND p.deleted = 0) AS last_post_at
       FROM boards b
       WHERE b.min_level <= ?
       ORDER BY b.sort_order, b.id`
    )
    .all(Number(level));
}

function getBoard(id) {
  return getDb().prepare('SELECT * FROM boards WHERE id = ?').get(Number(id)) || null;
}

function createBoard({ name, description = '', minLevel = 0, readOnly = 0, sortOrder = 100 }) {
  const cleanName = sanitize(name, 40).trim();
  if (!cleanName) throw new Error('Board name is required.');
  const result = getDb()
    .prepare(
      'INSERT INTO boards (name, description, min_level, read_only, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(cleanName, sanitize(description, 200).trim(), Number(minLevel) || 0, readOnly ? 1 : 0, Number(sortOrder) || 100, nowIso());
  return getBoard(lastId(result));
}

function updateBoard(id, fields) {
  const board = getBoard(id);
  if (!board) throw new Error('Board not found.');
  const next = {
    name: fields.name !== undefined ? sanitize(fields.name, 40).trim() : board.name,
    description: fields.description !== undefined ? sanitize(fields.description, 200).trim() : board.description,
    min_level: fields.minLevel !== undefined ? Number(fields.minLevel) || 0 : board.min_level,
    read_only: fields.readOnly !== undefined ? (fields.readOnly ? 1 : 0) : board.read_only,
    sort_order: fields.sortOrder !== undefined ? Number(fields.sortOrder) || 0 : board.sort_order,
  };
  if (!next.name) throw new Error('Board name is required.');
  getDb()
    .prepare('UPDATE boards SET name = ?, description = ?, min_level = ?, read_only = ?, sort_order = ? WHERE id = ?')
    .run(next.name, next.description, next.min_level, next.read_only, next.sort_order, board.id);
  return getBoard(board.id);
}

function deleteBoard(id) {
  return getDb().prepare('DELETE FROM boards WHERE id = ?').run(Number(id)).changes > 0;
}

function threadCount(boardId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE board_id = ? AND parent_id IS NULL AND deleted = 0')
    .get(Number(boardId)).n;
}

function listThreads(boardId, { limit = 20, offset = 0 } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.subject, p.created_at, p.locked, u.handle,
        (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id AND r.deleted = 0) AS replies,
        (SELECT MAX(r.created_at) FROM posts r WHERE r.parent_id = p.id AND r.deleted = 0) AS last_reply_at
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.board_id = ? AND p.parent_id IS NULL AND p.deleted = 0
       ORDER BY COALESCE((SELECT MAX(r.created_at) FROM posts r WHERE r.parent_id = p.id AND r.deleted = 0), p.created_at) DESC
       LIMIT ? OFFSET ?`
    )
    .all(Number(boardId), Number(limit), Number(offset));
  return { rows, total: threadCount(boardId) };
}

function getRoot(postId) {
  return getDb()
    .prepare(
      `SELECT p.*, u.handle FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id = ? AND p.deleted = 0`
    )
    .get(Number(postId)) || null;
}

function getThread(rootId, { limit = 100 } = {}) {
  const root = getRoot(rootId);
  if (!root) return null;
  const replies = getDb()
    .prepare(
      `SELECT p.*, u.handle FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.parent_id = ? AND p.deleted = 0
       ORDER BY p.created_at ASC
       LIMIT ?`
    )
    .all(root.id, Number(limit));
  return { root, replies };
}

function createPost({ boardId, userId, subject, body, parentId = null }) {
  const db = getDb();
  const board = getBoard(boardId);
  if (!board) throw new Error('Board not found.');
  const user = db.prepare('SELECT level FROM users WHERE id = ?').get(Number(userId));
  if (!user) throw new Error('User not found.');
  if (board.read_only && user.level < 100) throw new Error('This board is read-only.');

  const cleanBody = sanitize(body, 8000).trim();
  if (!cleanBody) throw new Error('Message body is empty.');

  let rootId = parentId ? Number(parentId) : null;
  let cleanSubject = sanitize(subject, MAX_SUBJECT).trim();
  if (rootId) {
    const root = getRoot(rootId);
    if (!root) throw new Error('Thread not found.');
    if (root.board_id !== board.id) throw new Error('Thread belongs to another board.');
    if (root.locked && user.level < 100) throw new Error('This thread is locked.');
    if (!cleanSubject) cleanSubject = root.subject.startsWith('Re: ') ? root.subject : `Re: ${root.subject}`;
  } else if (!cleanSubject) {
    throw new Error('Subject is required.');
  }

  const result = db
    .prepare('INSERT INTO posts (board_id, user_id, parent_id, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(board.id, Number(userId), rootId, cleanSubject.slice(0, MAX_SUBJECT), cleanBody, nowIso());
  db.prepare('UPDATE users SET posts = posts + 1 WHERE id = ?').run(Number(userId));
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(lastId(result));
}

function deletePost(id, { hard = false } = {}) {
  const db = getDb();
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(id));
  if (!post) return false;
  if (hard) {
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    if (post.parent_id === null) db.prepare('DELETE FROM posts WHERE parent_id = ?').run(post.id);
  } else {
    db.prepare('UPDATE posts SET deleted = 1, body = ? WHERE id = ?').run('[removed by the sysop]', post.id);
  }
  return true;
}

function setLocked(id, locked) {
  return getDb().prepare('UPDATE posts SET locked = ? WHERE id = ?').run(locked ? 1 : 0, Number(id)).changes > 0;
}

function search(query, { limit = 20 } = {}) {
  const term = `%${String(query || '').replace(/[%_]/g, '')}%`;
  return getDb()
    .prepare(
      `SELECT p.id, p.subject, p.created_at, b.id AS board_id, b.name AS board, u.handle
       FROM posts p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.user_id
       WHERE p.deleted = 0 AND (p.subject LIKE ? OR p.body LIKE ?)
       ORDER BY p.created_at DESC LIMIT ?`
    )
    .all(term, term, Number(limit));
}

module.exports = {
  MAX_SUBJECT,
  listBoards,
  getBoard,
  createBoard,
  updateBoard,
  deleteBoard,
  listThreads,
  getRoot,
  getThread,
  createPost,
  deletePost,
  setLocked,
  search,
};
