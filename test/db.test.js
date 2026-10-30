'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const db = require('../lib/db');

let env;

before(() => {
  env = makeDb();
});

after(() => env.cleanup());

test('seeds default boards, areas, doors and settings', () => {
  const boards = db.getDb().prepare('SELECT * FROM boards ORDER BY id').all();
  assert.ok(boards.length >= 4);
  assert.equal(boards[0].name, 'Main Board');

  const areas = db.getDb().prepare('SELECT * FROM file_areas').all();
  assert.ok(areas.length >= 2);

  const doors = db.getDb().prepare('SELECT * FROM doors ORDER BY id').all();
  assert.equal(doors.length, 3);
  assert.ok(doors.every((door) => door.kind === 'builtin'));

  assert.equal(db.getSetting('bbs_name'), 'DEADPLUG BBS');
  assert.equal(db.getSetting('registration_open'), '1');
});

test('settings can be read and written', () => {
  db.setSetting('bbs_name', 'Test Board');
  assert.equal(db.getSetting('bbs_name'), 'Test Board');
  assert.equal(db.getSettings().bbs_name, 'Test Board');
});

test('foreign keys are enforced', () => {
  assert.throws(() => {
    db.getDb()
      .prepare('INSERT INTO posts (board_id, user_id, subject, body, created_at) VALUES (999, 999, ?, ?, ?)')
      .run('x', 'y', db.nowIso());
  });
});

test('audit entries are recorded', () => {
  db.audit(null, 'test', 'detail', '127.0.0.1');
  const row = db.getDb().prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 1').get();
  assert.equal(row.action, 'test');
  assert.equal(row.detail, 'detail');
});
