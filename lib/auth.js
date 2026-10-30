'use strict';

const crypto = require('node:crypto');
const { getDb, nowIso, lastId } = require('./db');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const RESERVED_HANDLES = new Set(['new', 'guest', 'admin', 'root', 'system', 'bbs']);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64url'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function validateHandle(handle) {
  const value = String(handle || '').trim();
  if (!/^[A-Za-z0-9_.-]{2,20}$/.test(value)) {
    return 'Handle must be 2-20 characters: letters, numbers, dot, dash or underscore.';
  }
  if (RESERVED_HANDLES.has(value.toLowerCase())) {
    return 'That handle is reserved.';
  }
  return null;
}

function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return rest;
}

function findUserByHandle(handle) {
  return getDb()
    .prepare('SELECT * FROM users WHERE handle = ? COLLATE NOCASE')
    .get(String(handle || '').trim());
}

function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
}

function createUser({
  handle,
  password,
  realName = '',
  location = '',
  email = '',
  ansi = 1,
  level = 10,
  validated = 1,
  ip = '',
}) {
  const handleError = validateHandle(handle);
  if (handleError) throw new Error(handleError);
  if (findUserByHandle(handle)) throw new Error('That handle is already taken.');
  const result = getDb()
    .prepare(
      `INSERT INTO users
       (handle, password_hash, real_name, location, email, level, validated, ansi, created_at, last_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(handle).trim(),
      hashPassword(password),
      String(realName).slice(0, 60),
      String(location).slice(0, 60),
      String(email).slice(0, 120),
      Number(level),
      validated ? 1 : 0,
      ansi ? 1 : 0,
      nowIso(),
      ip
    );
  return findUserById(lastId(result));
}

function authenticate(handle, password, ip = '') {
  const user = findUserByHandle(handle);
  if (!user) {
    // Burn comparable CPU time so unknown handles are not obviously faster.
    verifyPassword(String(password || ''), hashPassword('invalid-handle-placeholder'));
    return { error: 'invalid' };
  }
  if (!verifyPassword(password, user.password_hash)) return { error: 'invalid' };
  if (user.banned) return { error: 'banned' };
  if (!user.validated) return { error: 'unvalidated' };
  getDb()
    .prepare('UPDATE users SET last_login_at = ?, last_ip = ? WHERE id = ?')
    .run(nowIso(), ip || '', user.id);
  return { user: findUserById(user.id) };
}

function setPassword(userId, password) {
  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(password), Number(userId));
}

function generatePassword(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const TOKEN_VERSION = 'v1';

function signToken(payload, secret, ttlSeconds = 900) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${TOKEN_VERSION}.${encoded}.${mac}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, encoded, mac] = parts;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  validateHandle,
  publicUser,
  findUserByHandle,
  findUserById,
  createUser,
  authenticate,
  setPassword,
  generatePassword,
  signToken,
  verifyToken,
  RESERVED_HANDLES,
};
