'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const chat = require('../lib/chat');
const auth = require('../lib/auth');

let env;
let alice;

before(() => {
  env = makeDb();
  alice = auth.createUser({ handle: 'Alice', password: 'secret123' });
});

after(() => env.cleanup());

test('chat lines persist and come back in order', () => {
  chat.postChat(alice.id, '  hello   room  ');
  const recent = chat.recentChat(10);
  assert.equal(recent.at(-1).body, 'hello room');
  assert.equal(recent.at(-1).handle, 'Alice');
});

test('chat has a short cooldown', () => {
  assert.throws(() => chat.postChat(alice.id, 'again'), /Slow down/);
});

test('one-liners can be posted and deleted by their author', () => {
  const liner = chat.postOneLiner(alice.id, '  This board is still standing.  ');
  assert.equal(liner.body, 'This board is still standing.');
  assert.ok(chat.recentOneLiners(5).some((row) => row.id === liner.id));
  assert.equal(chat.deleteOneLiner(liner.id, { userId: alice.id, level: 10 }), true);
  assert.ok(!chat.recentOneLiners(5).some((row) => row.id === liner.id));
});

test('one-liners cannot be deleted by another user', () => {
  const bob = auth.createUser({ handle: 'Bob', password: 'secret123' });
  const liner = chat.postOneLiner(bob.id, 'Mine');
  assert.equal(chat.deleteOneLiner(liner.id, { userId: alice.id, level: 10 }), false);
  assert.equal(chat.deleteOneLiner(liner.id, { userId: alice.id, level: 100 }), true);
});

test('one-liners are capped at 70 characters', () => {
  const bob = auth.createUser({ handle: 'Carol', password: 'secret123' });
  const liner = chat.postOneLiner(bob.id, 'x'.repeat(200));
  assert.equal(liner.body.length, 70);
});
