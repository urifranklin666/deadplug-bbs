'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const mail = require('../lib/mail');
const auth = require('../lib/auth');

let env;
let alice;
let bob;

before(() => {
  env = makeDb();
  alice = auth.createUser({ handle: 'Alice', password: 'secret123' });
  bob = auth.createUser({ handle: 'Bob', password: 'secret123' });
});

after(() => env.cleanup());

test('mail is delivered, counted and marked read', () => {
  const message = mail.sendMail({
    fromId: alice.id,
    toHandle: 'bob',
    subject: 'Hello',
    body: 'First line\nSecond line',
  });
  assert.equal(message.to_id, bob.id);
  assert.equal(mail.unreadCount(bob.id), 1);

  const inbox = mail.inbox(bob.id);
  assert.equal(inbox.total, 1);
  assert.equal(inbox.rows[0].from_handle, 'Alice');
  assert.equal(inbox.rows[0].read_at, null);

  const opened = mail.openMail(bob.id, message.id);
  assert.equal(opened.subject, 'Hello');
  assert.ok(opened.read_at);
  assert.equal(mail.unreadCount(bob.id), 0);
});

test('only participants can open a message', () => {
  const carol = auth.createUser({ handle: 'Carol', password: 'secret123' });
  const message = mail.sendMail({ fromId: alice.id, toHandle: 'Bob', subject: 'Private', body: 'secret' });
  assert.equal(mail.openMail(carol.id, message.id), null);
  assert.ok(mail.openMail(alice.id, message.id));
});

test('senders keep a copy after the recipient deletes', () => {
  const message = mail.sendMail({ fromId: alice.id, toHandle: 'Carol', subject: 'Keep', body: 'body' });
  const carol = auth.findUserByHandle('Carol');
  mail.deleteMail(carol.id, message.id);
  assert.equal(mail.inbox(carol.id).total, 0);
  assert.ok(mail.sent(alice.id).some((row) => row.id === message.id));
  assert.ok(mail.openMail(alice.id, message.id));
});

test('mailing yourself or an unknown handle fails', () => {
  assert.throws(() => mail.sendMail({ fromId: alice.id, toHandle: 'Alice', subject: 's', body: 'b' }), /yourself/);
  assert.throws(() => mail.sendMail({ fromId: alice.id, toHandle: 'Nobody', subject: 's', body: 'b' }), /No such user/);
  assert.throws(() => mail.sendMail({ fromId: alice.id, toHandle: 'Bob', subject: 's', body: '  ' }), /empty/);
});

test('delete all clears the inbox', () => {
  mail.sendMail({ fromId: alice.id, toHandle: 'Bob', subject: 'One', body: '1' });
  mail.sendMail({ fromId: alice.id, toHandle: 'Bob', subject: 'Two', body: '2' });
  assert.ok(mail.inbox(bob.id).total >= 2);
  mail.deleteAll(bob.id, 'inbox');
  assert.equal(mail.inbox(bob.id).total, 0);
});
