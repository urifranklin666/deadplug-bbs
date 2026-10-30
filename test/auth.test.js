'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const auth = require('../lib/auth');

let env;

before(() => {
  env = makeDb();
});

after(() => env.cleanup());

test('password hashes verify only the right password', () => {
  const hash = auth.hashPassword('correct horse battery staple');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(auth.verifyPassword('correct horse battery staple', hash), true);
  assert.equal(auth.verifyPassword('wrong', hash), false);
  assert.equal(auth.verifyPassword('', 'garbage'), false);
});

test('hashes are salted', () => {
  assert.notEqual(auth.hashPassword('same'), auth.hashPassword('same'));
});

test('handle validation rejects reserved and malformed names', () => {
  assert.equal(auth.validateHandle('ok_handle'), null);
  assert.match(auth.validateHandle('a'), /2-20/);
  assert.match(auth.validateHandle('has space'), /2-20/);
  assert.match(auth.validateHandle('guest'), /reserved/);
});

test('users can be created and authenticated case-insensitively', () => {
  const user = auth.createUser({ handle: 'Alice', password: 'secret123', realName: 'Alice A' });
  assert.equal(user.handle, 'Alice');
  assert.equal(user.level, 10);
  assert.equal(user.validated, 1);
  assert.ok(user.password_hash);

  const result = auth.authenticate('alice', 'secret123', '10.0.0.1');
  assert.ok(result.user);
  assert.equal(result.user.id, user.id);
  assert.equal(result.user.last_ip, '10.0.0.1');

  assert.equal(auth.authenticate('alice', 'bad').error, 'invalid');
  assert.equal(auth.authenticate('nobody', 'secret123').error, 'invalid');
});

test('duplicate handles and unvalidated accounts are rejected', () => {
  auth.createUser({ handle: 'Bob', password: 'secret123' });
  assert.throws(() => auth.createUser({ handle: 'bob', password: 'secret123' }), /already taken/);

  auth.createUser({ handle: 'Pending', password: 'secret123', validated: 0 });
  assert.equal(auth.authenticate('Pending', 'secret123').error, 'unvalidated');
});

test('banned accounts cannot authenticate', () => {
  const user = auth.createUser({ handle: 'Banned', password: 'secret123' });
  require('../lib/db').getDb().prepare('UPDATE users SET banned = 1 WHERE id = ?').run(user.id);
  assert.equal(auth.authenticate('Banned', 'secret123').error, 'banned');
});

test('tokens verify, expire and reject tampering', () => {
  const secret = 'test-secret';
  const token = auth.signToken({ kind: 'download', uid: 1, fid: 2 }, secret, 60);
  const payload = auth.verifyToken(token, secret);
  assert.equal(payload.kind, 'download');
  assert.equal(payload.uid, 1);

  assert.equal(auth.verifyToken(token, 'other-secret'), null);
  assert.equal(auth.verifyToken(`${token}x`, secret), null);
  assert.equal(auth.verifyToken('nonsense', secret), null);

  const expired = auth.signToken({ kind: 'download', uid: 1 }, secret, -1);
  assert.equal(auth.verifyToken(expired, secret), null);
});
