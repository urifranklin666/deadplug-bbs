'use strict';

const express = require('express');
const auth = require('./auth');
const db = require('./db');
const runtime = require('./runtime');
const boards = require('./boards');
const mail = require('./mail');
const fileStore = require('./files');
const chat = require('./chat');
const doors = require('./doors');
const { sanitize } = require('./ansi');

const COOKIE = 'bbs_admin';
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'deadplug-bbs';
const SETTING_KEYS = new Set([
  'bbs_name',
  'tagline',
  'motd',
  'splash_enabled',
  'registration_open',
  'guest_enabled',
  'new_user_validation',
  'max_users',
  'min_password_length',
  'download_cost',
  'max_post_length',
  'chat_enabled',
  'oneliners_enabled',
]);

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || '';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function createAdminRouter({ config, logger = console }) {
  const router = express.Router();
  const failures = new Map();

  router.use(express.json({ limit: '128kb' }));

  function failureCount(ip) {
    const now = Date.now();
    const list = (failures.get(ip) || []).filter((time) => now - time < 60 * 1000);
    if (list.length) failures.set(ip, list);
    else failures.delete(ip);
    return list;
  }

  function requireAdmin(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const payload = auth.verifyToken(cookies[COOKIE], config.sessionSecret);
    if (!payload || payload.kind !== 'admin') {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }
    const user = auth.findUserById(payload.uid);
    if (!user || user.level < 100 || user.banned) {
      res.status(403).json({ error: 'Sysop access required.' });
      return;
    }
    req.adminUser = user;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers[CSRF_HEADER] !== CSRF_VALUE) {
        res.status(403).json({ error: 'Missing request token.' });
        return;
      }
    }
    next();
  }

  router.post('/api/login', (req, res) => {
    const ip = clientIp(req);
    if (failureCount(ip).length >= 8) {
      res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
      return;
    }
    const { handle, password } = req.body || {};
    const result = auth.authenticate(handle, password, ip);
    if (!result.user) {
      const list = failureCount(ip);
      list.push(Date.now());
      failures.set(ip, list);
      res.status(401).json({ error: 'Invalid handle or password.' });
      return;
    }
    if (result.user.level < 100) {
      res.status(403).json({ error: 'That account is not a sysop.' });
      return;
    }
    const token = auth.signToken({ kind: 'admin', uid: result.user.id }, config.sessionSecret, 12 * 60 * 60);
    const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
    failures.delete(ip);
    db.audit(result.user.id, 'admin-login', '', ip);
    res.json({ ok: true, user: auth.publicUser(result.user) });
  });

  router.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  router.use('/api', requireAdmin);

  router.get('/api/me', (req, res) => {
    res.json({ user: auth.publicUser(req.adminUser) });
  });

  router.get('/api/overview', (_req, res) => {
    const counts = db
      .getDb()
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM users) AS users,
          (SELECT COUNT(*) FROM users WHERE validated = 0) AS pending,
          (SELECT COUNT(*) FROM users WHERE banned = 1) AS banned,
          (SELECT COUNT(*) FROM posts WHERE deleted = 0) AS posts,
          (SELECT COUNT(*) FROM files WHERE deleted = 0) AS files,
          (SELECT COUNT(*) FROM mail) AS mail,
          (SELECT COUNT(*) FROM chat) AS chat`
      )
      .get();
    const audit = db
      .getDb()
      .prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 12')
      .all();
    res.json({ counts, online: runtime.list(), audit, settings: db.getSettings() });
  });

  router.get('/api/users', (req, res) => {
    const query = String(req.query.q || '').trim();
    const rows = query
      ? db
          .getDb()
          .prepare(
            `SELECT id, handle, real_name, location, email, level, validated, banned, credits, posts, uploads, downloads, ansi, created_at, last_login_at, last_ip
             FROM users WHERE handle LIKE ? OR real_name LIKE ? OR location LIKE ? ORDER BY id LIMIT 100`
          )
          .all(`%${query}%`, `%${query}%`, `%${query}%`)
      : db
          .getDb()
          .prepare(
            `SELECT id, handle, real_name, location, email, level, validated, banned, credits, posts, uploads, downloads, ansi, created_at, last_login_at, last_ip
             FROM users ORDER BY id LIMIT 200`
          )
          .all();
    res.json({ users: rows });
  });

  router.post('/api/users', (req, res) => {
    try {
      const { handle, password, level, validated, realName, location, email } = req.body || {};
      const user = auth.createUser({
        handle,
        password,
        realName: realName || '',
        location: location || '',
        email: email || '',
        level: Number(level) || 10,
        validated: validated === false ? 0 : 1,
        ip: clientIp(req),
      });
      db.audit(req.adminUser.id, 'admin-user-create', user.handle, clientIp(req));
      res.json({ ok: true, user: auth.publicUser(user) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/api/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const target = auth.findUserById(id);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const body = req.body || {};
    if (id === req.adminUser.id && (body.banned || (body.level !== undefined && Number(body.level) < 100))) {
      res.status(400).json({ error: 'You cannot ban or demote yourself.' });
      return;
    }
    const next = {
      validated: body.validated !== undefined ? (body.validated ? 1 : 0) : target.validated,
      banned: body.banned !== undefined ? (body.banned ? 1 : 0) : target.banned,
      level: body.level !== undefined ? Math.max(0, Math.min(100, Number(body.level) || 0)) : target.level,
      credits: body.credits !== undefined ? Math.max(0, Number(body.credits) || 0) : target.credits,
      ansi: body.ansi !== undefined ? (body.ansi ? 1 : 0) : target.ansi,
      real_name: body.realName !== undefined ? sanitize(body.realName, 60) : target.real_name,
      location: body.location !== undefined ? sanitize(body.location, 60) : target.location,
      email: body.email !== undefined ? sanitize(body.email, 120) : target.email,
    };
    db.getDb()
      .prepare(
        'UPDATE users SET validated = ?, banned = ?, level = ?, credits = ?, ansi = ?, real_name = ?, location = ?, email = ? WHERE id = ?'
      )
      .run(next.validated, next.banned, next.level, next.credits, next.ansi, next.real_name, next.location, next.email, id);
    if (body.password) {
      if (String(body.password).length < 6) {
        res.status(400).json({ error: 'Password must be at least 6 characters.' });
        return;
      }
      auth.setPassword(id, String(body.password));
    }
    db.audit(req.adminUser.id, 'admin-user-update', target.handle, clientIp(req));
    if (next.banned) runtime.disconnectUser(id, 'Your account has been banned by the sysop.');
    res.json({ ok: true, user: auth.publicUser(auth.findUserById(id)) });
  });

  router.delete('/api/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.adminUser.id) {
      res.status(400).json({ error: 'You cannot delete your own account here.' });
      return;
    }
    const target = auth.findUserById(id);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    runtime.disconnectUser(id, 'Your account has been removed by the sysop.');
    db.getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
    db.audit(req.adminUser.id, 'admin-user-delete', target.handle, clientIp(req));
    res.json({ ok: true });
  });

  router.get('/api/boards', (_req, res) => {
    res.json({ boards: boards.listBoards(100) });
  });

  router.post('/api/boards', (req, res) => {
    try {
      const board = boards.createBoard(req.body || {});
      db.audit(req.adminUser.id, 'admin-board-create', board.name, clientIp(req));
      res.json({ ok: true, board });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/api/boards/:id', (req, res) => {
    try {
      const board = boards.updateBoard(Number(req.params.id), req.body || {});
      db.audit(req.adminUser.id, 'admin-board-update', board.name, clientIp(req));
      res.json({ ok: true, board });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/boards/:id', (req, res) => {
    const board = boards.getBoard(Number(req.params.id));
    if (!board) {
      res.status(404).json({ error: 'Board not found.' });
      return;
    }
    boards.deleteBoard(board.id);
    db.audit(req.adminUser.id, 'admin-board-delete', board.name, clientIp(req));
    res.json({ ok: true });
  });

  router.get('/api/posts', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const rows = db
      .getDb()
      .prepare(
        `SELECT p.id, p.subject, p.created_at, p.deleted, p.locked, b.name AS board, u.handle
         FROM posts p JOIN boards b ON b.id = p.board_id JOIN users u ON u.id = p.user_id
         ORDER BY p.id DESC LIMIT ?`
      )
      .all(limit);
    res.json({ posts: rows });
  });

  router.delete('/api/posts/:id', (req, res) => {
    const ok = boards.deletePost(Number(req.params.id), { hard: req.query.hard === '1' });
    if (!ok) {
      res.status(404).json({ error: 'Post not found.' });
      return;
    }
    db.audit(req.adminUser.id, 'admin-post-delete', `post=${req.params.id}`, clientIp(req));
    res.json({ ok: true });
  });

  router.get('/api/areas', (_req, res) => {
    res.json({ areas: fileStore.listAreas(100) });
  });

  router.post('/api/areas', (req, res) => {
    try {
      const area = fileStore.createArea(req.body || {});
      db.audit(req.adminUser.id, 'admin-area-create', area.name, clientIp(req));
      res.json({ ok: true, area });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/api/areas/:id', (req, res) => {
    try {
      const area = fileStore.updateArea(Number(req.params.id), req.body || {});
      db.audit(req.adminUser.id, 'admin-area-update', area.name, clientIp(req));
      res.json({ ok: true, area });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/api/files', (req, res) => {
    const rows = db
      .getDb()
      .prepare(
        `SELECT f.id, f.filename, f.description, f.size, f.downloads, f.created_at, a.name AS area, u.handle
         FROM files f JOIN file_areas a ON a.id = f.area_id JOIN users u ON u.id = f.uploader_id
         WHERE f.deleted = 0 ORDER BY f.id DESC LIMIT 200`
      )
      .all();
    res.json({ files: rows });
  });

  router.delete('/api/files/:id', (req, res) => {
    const ok = fileStore.deleteFile(Number(req.params.id), { filesDir: config.filesDir, hard: true });
    if (!ok) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    db.audit(req.adminUser.id, 'admin-file-delete', `file=${req.params.id}`, clientIp(req));
    res.json({ ok: true });
  });

  router.get('/api/oneliners', (_req, res) => {
    const rows = db
      .getDb()
      .prepare(
        `SELECT o.id, o.body, o.created_at, o.user_id, u.handle FROM one_liners o
         JOIN users u ON u.id = o.user_id WHERE o.deleted = 0 ORDER BY o.id DESC LIMIT 100`
      )
      .all();
    res.json({ oneliners: rows });
  });

  router.delete('/api/oneliners/:id', (req, res) => {
    const ok = chat.deleteOneLiner(Number(req.params.id), { userId: 0, level: 100 });
    if (!ok) {
      res.status(404).json({ error: 'One-liner not found.' });
      return;
    }
    db.audit(req.adminUser.id, 'admin-oneliner-delete', `id=${req.params.id}`, clientIp(req));
    res.json({ ok: true });
  });

  router.get('/api/chat', (_req, res) => {
    res.json({ chat: chat.recentChat(50) });
  });

  router.delete('/api/chat', (req, res) => {
    const count = chat.clearChat();
    db.audit(req.adminUser.id, 'admin-chat-clear', `${count} messages`, clientIp(req));
    res.json({ ok: true, cleared: count });
  });

  router.get('/api/doors', (_req, res) => {
    const rows = db.getDb().prepare('SELECT * FROM doors ORDER BY sort_order, id').all();
    res.json({ doors: rows });
  });

  router.post('/api/doors', (req, res) => {
    try {
      const door = doors.createDoor(req.body || {});
      db.audit(req.adminUser.id, 'admin-door-create', door.name, clientIp(req));
      res.json({ ok: true, door });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/api/doors/:id', (req, res) => {
    try {
      const door = doors.updateDoor(Number(req.params.id), req.body || {});
      db.audit(req.adminUser.id, 'admin-door-update', door.name, clientIp(req));
      res.json({ ok: true, door });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/api/doors/:id', (req, res) => {
    const ok = doors.deleteDoor(Number(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'Door not found.' });
      return;
    }
    db.audit(req.adminUser.id, 'admin-door-delete', `door=${req.params.id}`, clientIp(req));
    res.json({ ok: true });
  });

  router.get('/api/settings', (_req, res) => {
    res.json({ settings: db.getSettings() });
  });

  router.put('/api/settings', (req, res) => {
    const body = req.body || {};
    const changed = [];
    for (const [key, value] of Object.entries(body)) {
      if (!SETTING_KEYS.has(key)) continue;
      db.setSetting(key, sanitize(value, 2000));
      changed.push(key);
    }
    db.audit(req.adminUser.id, 'admin-settings', changed.join(','), clientIp(req));
    res.json({ ok: true, settings: db.getSettings() });
  });

  router.get('/api/audit', (_req, res) => {
    const rows = db.getDb().prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all();
    res.json({ audit: rows });
  });

  router.post('/api/broadcast', (req, res) => {
    const message = sanitize((req.body || {}).message, 200).trim();
    if (!message) {
      res.status(400).json({ error: 'Message is empty.' });
      return;
    }
    runtime.broadcast(`[${req.adminUser.handle}] ${message}`);
    db.audit(req.adminUser.id, 'admin-broadcast', message, clientIp(req));
    res.json({ ok: true, online: runtime.count() });
  });

  router.use((err, _req, res, _next) => {
    logger.error('[admin]', err.message);
    res.status(500).json({ error: 'Internal error.' });
  });

  return router;
}

module.exports = { createAdminRouter, CSRF_VALUE };
