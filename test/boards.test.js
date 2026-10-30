'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const boards = require('../lib/boards');
const auth = require('../lib/auth');

let env;
let alice;
let sysop;
let mainBoard;

before(() => {
  env = makeDb();
  alice = auth.createUser({ handle: 'Alice', password: 'secret123' });
  sysop = auth.createUser({ handle: 'Sysop', password: 'secret123', level: 100 });
  mainBoard = boards.listBoards(0)[0];
});

after(() => env.cleanup());

test('boards are filtered by level', () => {
  const board = boards.createBoard({ name: 'Veterans', minLevel: 50 });
  assert.equal(boards.getBoard(board.id).name, 'Veterans');

  const userBoards = boards.listBoards(10).map((row) => row.name);
  const vetBoards = boards.listBoards(50).map((row) => row.name);
  assert.ok(!userBoards.includes('Veterans'));
  assert.ok(vetBoards.includes('Veterans'));
});

test('threads, replies and counters work', () => {
  const root = boards.createPost({
    boardId: mainBoard.id,
    userId: alice.id,
    subject: 'First post',
    body: 'Hello from the test suite.',
  });
  assert.equal(root.parent_id, null);

  const reply = boards.createPost({
    boardId: mainBoard.id,
    userId: sysop.id,
    parentId: root.id,
    subject: '',
    body: 'A reply.',
  });
  assert.equal(reply.parent_id, root.id);

  const { rows, total } = boards.listThreads(mainBoard.id, { limit: 20 });
  assert.ok(total >= 1);
  const thread = rows.find((row) => row.id === root.id);
  assert.equal(thread.replies, 1);
  assert.equal(thread.handle, 'Alice');

  const full = boards.getThread(root.id);
  assert.equal(full.root.subject, 'First post');
  assert.equal(full.replies.length, 1);
  assert.equal(full.replies[0].body, 'A reply.');

  const user = auth.findUserByHandle('Alice');
  assert.equal(user.posts, 1);
});

test('replies inherit the thread subject and stay in the board', () => {
  const root = boards.createPost({
    boardId: mainBoard.id,
    userId: alice.id,
    subject: 'Subject line',
    body: 'Body',
  });
  const reply = boards.createPost({
    boardId: mainBoard.id,
    userId: sysop.id,
    parentId: root.id,
    subject: '',
    body: 'Reply',
  });
  assert.equal(reply.subject, 'Re: Subject line');

  const other = boards.createBoard({ name: 'Other' });
  assert.throws(
    () =>
      boards.createPost({
        boardId: other.id,
        userId: sysop.id,
        parentId: root.id,
        body: 'wrong board',
      }),
    /another board/
  );
});

test('read-only boards reject regular users but not the sysop', () => {
  const board = boards.createBoard({ name: 'News', readOnly: 1 });
  assert.throws(
    () => boards.createPost({ boardId: board.id, userId: alice.id, subject: 'x', body: 'y' }),
    /read-only/
  );
  const post = boards.createPost({ boardId: board.id, userId: sysop.id, subject: 'x', body: 'y' });
  assert.ok(post.id);
});

test('empty messages and subjects are rejected', () => {
  assert.throws(
    () => boards.createPost({ boardId: mainBoard.id, userId: alice.id, subject: '', body: 'body' }),
    /Subject/
  );
  assert.throws(
    () => boards.createPost({ boardId: mainBoard.id, userId: alice.id, subject: 's', body: '   ' }),
    /empty/
  );
});

test('search finds subjects and bodies', () => {
  boards.createPost({
    boardId: mainBoard.id,
    userId: alice.id,
    subject: 'Zebra protocol',
    body: 'Something about stripes.',
  });
  const bySubject = boards.search('Zebra');
  assert.ok(bySubject.some((row) => row.subject === 'Zebra protocol'));
  const byBody = boards.search('stripes');
  assert.ok(byBody.length >= 1);
});

test('soft delete hides posts', () => {
  const post = boards.createPost({ boardId: mainBoard.id, userId: alice.id, subject: 'Temp', body: 'temp' });
  assert.equal(boards.deletePost(post.id), true);
  assert.equal(boards.getRoot(post.id), null);
  const rows = boards.listThreads(mainBoard.id, { limit: 100 }).rows;
  assert.ok(!rows.some((row) => row.id === post.id));
});
