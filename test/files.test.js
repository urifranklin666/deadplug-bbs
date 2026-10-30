'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const files = require('../lib/files');
const auth = require('../lib/auth');

let env;
let alice;
let area;
let filesDir;

before(() => {
  env = makeDb();
  alice = auth.createUser({ handle: 'Alice', password: 'secret123' });
  area = files.listAreas(0)[0];
  filesDir = path.join(env.dir, 'files');
});

after(() => env.cleanup());

test('uploads are stored and listed', () => {
  const file = files.saveUpload({
    areaId: area.id,
    uploaderId: alice.id,
    filename: '../../evil name.txt',
    description: 'A test file',
    data: Buffer.from('hello world'),
    filesDir,
  });
  assert.equal(file.filename, 'evil name.txt');
  assert.equal(file.size, 11);
  assert.ok(file.stored_name);

  const stored = files.storagePath(filesDir, file);
  assert.ok(stored.startsWith(filesDir));
  assert.equal(fs.readFileSync(stored, 'utf8'), 'hello world');

  const listed = files.listFiles(area.id);
  assert.ok(listed.rows.some((row) => row.id === file.id));
  assert.equal(listed.rows[0].handle, 'Alice');

  const detail = files.getFile(file.id);
  assert.equal(detail.description, 'A test file');
});

test('file search filters by name and description', () => {
  files.saveUpload({
    areaId: area.id,
    uploaderId: alice.id,
    filename: 'manual.pdf',
    description: 'Terminal client documentation',
    data: Buffer.from('pdf'),
    filesDir,
  });
  assert.equal(files.listFiles(area.id, { query: 'manual' }).rows.length, 1);
  assert.equal(files.listFiles(area.id, { query: 'documentation' }).rows.length, 1);
  assert.equal(files.listFiles(area.id, { query: 'missing' }).rows.length, 0);
});

test('downloads are counted for the file and the user', () => {
  const file = files.saveUpload({
    areaId: area.id,
    uploaderId: alice.id,
    filename: 'counted.bin',
    data: Buffer.from('x'),
    filesDir,
  });
  files.recordDownload(file.id, alice.id);
  files.recordDownload(file.id, alice.id);
  assert.equal(files.getFile(file.id).downloads, 2);
  assert.equal(auth.findUserByHandle('Alice').downloads, 2);
});

test('empty uploads and oversize uploads are rejected', () => {
  assert.throws(
    () => files.saveUpload({ areaId: area.id, uploaderId: alice.id, filename: 'x', data: Buffer.alloc(0), filesDir }),
    /empty/
  );
  assert.throws(
    () =>
      files.saveUpload({
        areaId: area.id,
        uploaderId: alice.id,
        filename: 'x',
        data: Buffer.alloc(20),
        filesDir,
        maxBytes: 10,
      }),
    /too large/
  );
});

test('safe filenames strip traversal and control characters', () => {
  assert.equal(files.safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(files.safeFilename('..'), 'file.bin');
  assert.equal(files.safeFilename('a\u0000b.txt'), 'ab.txt');
});

test('hard delete removes metadata and the stored file', () => {
  const file = files.saveUpload({
    areaId: area.id,
    uploaderId: alice.id,
    filename: 'remove-me.txt',
    data: Buffer.from('bye'),
    filesDir,
  });
  const stored = files.storagePath(filesDir, file);
  assert.ok(fs.existsSync(stored));
  files.deleteFile(file.id, { filesDir, hard: true });
  assert.equal(files.getFile(file.id), null);
  assert.ok(!fs.existsSync(stored));
});
