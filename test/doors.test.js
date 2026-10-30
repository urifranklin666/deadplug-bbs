'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const doors = require('../lib/doors');
const auth = require('../lib/auth');

let env;

before(() => {
  env = makeDb();
  auth.createUser({ handle: 'Alice', password: 'secret123' });
});

after(() => env.cleanup());

function fakeBbs() {
  const user = auth.findUserByHandle('Alice');
  return {
    user,
    bbsName: 'Test BBS',
    term: { cols: 80, rows: 24, idleTimeoutMs: 900000, lastActivity: Date.now() },
    runtimeSession: { node: 3 },
  };
}

test('argument parsing handles quotes and whitespace', () => {
  assert.deepEqual(doors.parseArgs('/usr/bin/door --node 3 --name "Test BBS"'), [
    '/usr/bin/door',
    '--node',
    '3',
    '--name',
    'Test BBS',
  ]);
  assert.deepEqual(doors.parseArgs(''), []);
});

test('DORINFO1.DEF contains caller details', () => {
  const text = doors.writeDropFile('/tmp', 'DORINFO1.DEF', fakeBbs());
  const lines = text.trimEnd().split('\r\n');
  assert.equal(lines.length, 12);
  assert.equal(lines[0], 'Test BBS');
  assert.equal(lines[2], 'Alice');
  assert.equal(lines[8], 'Alice');
});

test('DOOR.SYS has 52 lines and fills the handle', () => {
  const text = doors.writeDropFile('/tmp', 'DOOR.SYS', fakeBbs());
  const lines = text.split('\r\n');
  assert.equal(lines.length, 53);
  assert.ok(lines.includes('Alice'));
  assert.equal(lines[3], '3');
});

test('CHAIN.TXT starts with the caller identity', () => {
  const lines = doors.writeDropFile('/tmp', 'CHAIN.TXT', fakeBbs()).trimEnd().split('\r\n');
  assert.equal(lines[0], 'Alice');
  assert.equal(lines[1], 'Alice');
  assert.equal(lines[8], '3');
});

test('built-in doors are registered', () => {
  assert.equal(typeof doors.BUILTINS.blackjack, 'function');
  assert.equal(typeof doors.BUILTINS.trivia, 'function');
  assert.equal(typeof doors.BUILTINS.dungeon, 'function');
});

test('doors can be created, updated and deleted', () => {
  const door = doors.createDoor({
    name: 'External Test',
    kind: 'external',
    command: '/bin/echo',
    args: ['hello'],
    dropFile: 'DOOR.SYS',
    enabled: true,
    minLevel: 10,
  });
  assert.equal(door.kind, 'external');
  assert.equal(door.args, '["hello"]');

  const updated = doors.updateDoor(door.id, { enabled: false });
  assert.equal(updated.enabled, 0);
  assert.ok(doors.listDoors(100).every((row) => row.id !== door.id));

  assert.equal(doors.deleteDoor(door.id), true);
  assert.equal(doors.getDoor(door.id), null);
});
