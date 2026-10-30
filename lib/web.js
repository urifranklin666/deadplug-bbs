'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const auth = require('./auth');
const db = require('./db');
const files = require('./files');
const runtime = require('./runtime');
const { startSession } = require('./bbs');
const { Terminal } = require('./terminal');
const { WebSocketTransport } = require('../transports/websocket');
const { createAdminRouter } = require('./admin');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const NODE_MODULES = path.join(__dirname, '..', 'node_modules');

function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket.remoteAddress || '';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('The uploaded file is too large.');
        error.status = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function createWebServer({ config, logger = console }) {
  const app = express();
  app.set('trust proxy', config.trustProxy ? true : false);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; font-src 'self'; frame-ancestors 'none'"
    );
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true, online: runtime.count() }));

  app.get('/api/status', (_req, res) => {
    const settings = db.getSettings();
    let users = 0;
    try {
      users = db.getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
    } catch {
      // database not ready yet
    }
    res.json({
      name: settings.bbs_name || config.bbsName,
      tagline: settings.tagline || '',
      online: runtime.count(),
      users,
      registrationOpen: settings.registration_open === '1',
      guestEnabled: settings.guest_enabled === '1',
    });
  });

  app.get(['/admin', '/admin/'], (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  });

  app.use('/admin', createAdminRouter({ config, logger }));

  app.use('/vendor/xterm', express.static(path.join(NODE_MODULES, '@xterm', 'xterm')));
  app.use('/vendor/addon-fit', express.static(path.join(NODE_MODULES, '@xterm', 'addon-fit')));
  app.use('/vendor/addon-web-links', express.static(path.join(NODE_MODULES, '@xterm', 'addon-web-links')));

  // ── file transfer ──────────────────────────────────────────────────────────
  app.get('/upload/:token', (req, res) => {
    const payload = auth.verifyToken(req.params.token, config.sessionSecret);
    if (!payload || payload.kind !== 'upload') {
      res.status(400).send('<!doctype html><meta charset="utf-8"><p>This upload link is invalid or expired. Return to the BBS and request a new one.</p>');
      return;
    }
    const user = auth.findUserById(payload.uid);
    const area = files.getArea(payload.aid);
    if (!user || user.banned || !area) {
      res.status(400).send('<!doctype html><meta charset="utf-8"><p>This upload link is no longer valid.</p>');
      return;
    }
    res.sendFile(path.join(PUBLIC_DIR, 'upload.html'));
  });

  app.get('/api/upload-info/:token', (req, res) => {
    const payload = auth.verifyToken(req.params.token, config.sessionSecret);
    if (!payload || payload.kind !== 'upload') {
      res.status(400).json({ error: 'This upload link is invalid or expired.' });
      return;
    }
    const user = auth.findUserById(payload.uid);
    const area = files.getArea(payload.aid);
    if (!user || user.banned || !area) {
      res.status(400).json({ error: 'This upload link is no longer valid.' });
      return;
    }
    res.json({
      area: area.name,
      handle: user.handle,
      maxBytes: config.maxUploadBytes,
      bbsUrl: config.publicUrl,
    });
  });

  app.post('/api/upload/:token', async (req, res) => {
    const payload = auth.verifyToken(req.params.token, config.sessionSecret);
    if (!payload || payload.kind !== 'upload') {
      res.status(400).json({ error: 'This upload link is invalid or expired.' });
      return;
    }
    const user = auth.findUserById(payload.uid);
    const area = files.getArea(payload.aid);
    if (!user || user.banned || !area) {
      res.status(400).json({ error: 'This upload link is no longer valid.' });
      return;
    }
    if (area.min_level > user.level) {
      res.status(403).json({ error: 'You do not have access to that area.' });
      return;
    }
    try {
      const data = await readBody(req, config.maxUploadBytes);
      const filename = req.query.name || 'upload.bin';
      const description = req.query.desc || '';
      const file = files.saveUpload({
        areaId: area.id,
        uploaderId: user.id,
        filename,
        description,
        data,
        filesDir: config.filesDir,
        maxBytes: config.maxUploadBytes,
      });
      db.audit(user.id, 'upload', `file=${file.id} ${file.filename}`, clientIp(req, config));
      res.json({ ok: true, id: file.id, filename: file.filename, size: file.size });
    } catch (err) {
      logger.error('[upload]', err.message);
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.get('/dl/:token', (req, res) => {
    const payload = auth.verifyToken(req.params.token, config.sessionSecret);
    if (!payload || payload.kind !== 'download') {
      res.status(400).send('This download link is invalid or expired.');
      return;
    }
    const file = files.getFile(payload.fid);
    if (!file) {
      res.status(404).send('File not found.');
      return;
    }
    const fullPath = files.storagePath(config.filesDir, file);
    if (!fullPath || !fs.existsSync(fullPath)) {
      res.status(404).send('The stored file is missing.');
      return;
    }
    files.recordDownload(file.id, payload.uid);
    db.audit(payload.uid, 'download', `file=${file.id} ${file.filename}`, clientIp(req, config));
    res.download(fullPath, file.filename, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  });

  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024, perMessageDeflate: false });
  const connectionsByIp = new Map();

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req, config);
    const current = connectionsByIp.get(ip) || 0;
    if (current >= config.maxSessionsPerIp) {
      ws.send(JSON.stringify({ t: 'o', d: '\r\n*** Too many connections from your address. Try again later. ***\r\n' }));
      setTimeout(() => ws.close(), 500);
      return;
    }
    connectionsByIp.set(ip, current + 1);

    const transport = new WebSocketTransport(ws);
    transport.remoteAddress = ip;
    const term = new Terminal({
      write: (text) => transport.write(text),
      end: () => transport.end(),
      cols: transport.cols,
      rows: transport.rows,
      name: 'web',
      remoteAddress: ip,
      idleTimeoutMs: config.idleTimeoutMinutes * 60 * 1000,
    });
    transport.on('data', (data) => term.feed(data));
    transport.on('resize', (cols, rows) => term.resize(cols, rows));
    transport.on('close', () => term.markClosed());

    let alive = true;
    const ping = setInterval(() => {
      if (!alive) {
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        // ignore
      }
    }, 30000);
    ws.on('pong', () => {
      alive = true;
    });

    ws.on('close', () => {
      clearInterval(ping);
      const count = (connectionsByIp.get(ip) || 1) - 1;
      if (count <= 0) connectionsByIp.delete(ip);
      else connectionsByIp.set(ip, count);
    });

    startSession(term, config, { transport: 'web', ip }).catch((err) => {
      logger.error('[web] session failed:', err);
      try {
        term.end();
      } catch {
        // ignore
      }
    });
  });

  return { app, server, wss };
}

module.exports = { createWebServer, clientIp };
