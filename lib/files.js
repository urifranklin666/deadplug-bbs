'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getDb, nowIso, lastId } = require('./db');
const { sanitize } = require('./ansi');

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function safeFilename(name) {
  const base = path.basename(String(name || 'file.bin')).replace(/[\x00-\x1f\x7f]/g, '').trim();
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 100);
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file.bin';
  return cleaned;
}

function listAreas(level = 0) {
  return getDb()
    .prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM files f WHERE f.area_id = a.id AND f.deleted = 0) AS files,
        (SELECT COALESCE(SUM(f.size), 0) FROM files f WHERE f.area_id = a.id AND f.deleted = 0) AS bytes
       FROM file_areas a WHERE a.min_level <= ? ORDER BY a.sort_order, a.id`
    )
    .all(Number(level));
}

function getArea(id) {
  return getDb().prepare('SELECT * FROM file_areas WHERE id = ?').get(Number(id)) || null;
}

function createArea({ name, description = '', minLevel = 0, sortOrder = 100 }) {
  const cleanName = sanitize(name, 40).trim();
  if (!cleanName) throw new Error('Area name is required.');
  const result = getDb()
    .prepare('INSERT INTO file_areas (name, description, min_level, sort_order) VALUES (?, ?, ?, ?)')
    .run(cleanName, sanitize(description, 200).trim(), Number(minLevel) || 0, Number(sortOrder) || 100);
  return getArea(lastId(result));
}

function updateArea(id, fields) {
  const area = getArea(id);
  if (!area) throw new Error('Area not found.');
  getDb()
    .prepare('UPDATE file_areas SET name = ?, description = ?, min_level = ?, sort_order = ? WHERE id = ?')
    .run(
      fields.name !== undefined ? sanitize(fields.name, 40).trim() : area.name,
      fields.description !== undefined ? sanitize(fields.description, 200).trim() : area.description,
      fields.minLevel !== undefined ? Number(fields.minLevel) || 0 : area.min_level,
      fields.sortOrder !== undefined ? Number(fields.sortOrder) || 0 : area.sort_order,
      area.id
    );
  return getArea(area.id);
}

function listFiles(areaId, { limit = 20, offset = 0, query = '' } = {}) {
  const db = getDb();
  const term = `%${String(query || '').replace(/[%_]/g, '')}%`;
  const where = query
    ? 'f.area_id = ? AND f.deleted = 0 AND (f.filename LIKE ? OR f.description LIKE ?)'
    : 'f.area_id = ? AND f.deleted = 0';
  const params = query
    ? [Number(areaId), term, term, Number(limit), Number(offset)]
    : [Number(areaId), Number(limit), Number(offset)];
  const rows = db
    .prepare(
      `SELECT f.id, f.filename, f.description, f.size, f.downloads, f.created_at, u.handle
       FROM files f JOIN users u ON u.id = f.uploader_id
       WHERE ${where} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params);
  const countParams = query ? [Number(areaId), term, term] : [Number(areaId)];
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM files f WHERE ${
        query ? 'f.area_id = ? AND f.deleted = 0 AND (f.filename LIKE ? OR f.description LIKE ?)' : 'f.area_id = ? AND f.deleted = 0'
      }`
    )
    .get(...countParams).n;
  return { rows, total };
}

function getFile(id) {
  return getDb()
    .prepare(
      `SELECT f.*, u.handle, a.name AS area_name
       FROM files f JOIN users u ON u.id = f.uploader_id JOIN file_areas a ON a.id = f.area_id
       WHERE f.id = ? AND f.deleted = 0`
    )
    .get(Number(id)) || null;
}

function saveUpload({ areaId, uploaderId, filename, description = '', data, filesDir, maxBytes }) {
  const area = getArea(areaId);
  if (!area) throw new Error('Area not found.');
  const size = data.length;
  if (!size) throw new Error('The uploaded file is empty.');
  if (maxBytes && size > maxBytes) throw new Error('The uploaded file is too large.');
  const originalName = safeFilename(filename);
  const storedName = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.bin`;
  const target = path.join(filesDir, storedName);
  fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, data, { mode: 0o600 });
  fs.renameSync(temp, target);
  const result = getDb()
    .prepare(
      'INSERT INTO files (area_id, uploader_id, filename, stored_name, description, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(area.id, Number(uploaderId), originalName, storedName, sanitize(description, 200).trim(), size, nowIso());
  getDb().prepare('UPDATE users SET uploads = uploads + 1 WHERE id = ?').run(Number(uploaderId));
  return getDb().prepare('SELECT * FROM files WHERE id = ?').get(lastId(result));
}

function recordDownload(fileId, userId = 0) {
  getDb().prepare('UPDATE files SET downloads = downloads + 1 WHERE id = ?').run(Number(fileId));
  if (userId) getDb().prepare('UPDATE users SET downloads = downloads + 1 WHERE id = ?').run(Number(userId));
}

function deleteFile(id, { filesDir = null, hard = false } = {}) {
  const db = getDb();
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(id));
  if (!file) return false;
  if (hard) {
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    if (filesDir) {
      try {
        fs.unlinkSync(path.join(filesDir, file.stored_name));
      } catch {
        // already gone
      }
    }
  } else {
    db.prepare('UPDATE files SET deleted = 1 WHERE id = ?').run(file.id);
  }
  return true;
}

function storagePath(filesDir, file) {
  if (!file || !file.stored_name) return null;
  const resolved = path.resolve(filesDir, file.stored_name);
  if (!resolved.startsWith(path.resolve(filesDir) + path.sep)) return null;
  return resolved;
}

module.exports = {
  formatBytes,
  safeFilename,
  listAreas,
  getArea,
  createArea,
  updateArea,
  listFiles,
  getFile,
  saveUpload,
  recordDownload,
  deleteFile,
  storagePath,
};
