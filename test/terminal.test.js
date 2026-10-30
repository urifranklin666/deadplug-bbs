'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Terminal, Cancelled, IdleTimeout, Disconnected } = require('../lib/terminal');

function makeTerminal(options = {}) {
  let output = '';
  const term = new Terminal({
    write: (text) => {
      output += text;
    },
    end: () => {},
    cols: 80,
    rows: 24,
    ...options,
  });
  return { term, output: () => output };
}

test('reads a line and echoes it', async () => {
  const { term, output } = makeTerminal();
  const line = term.readLine({ prompt: '> ' });
  term.feed('hello\r');
  assert.equal(await line, 'hello');
  assert.ok(output().includes('> hello'));
});

test('backspace removes characters', async () => {
  const { term } = makeTerminal();
  const line = term.readLine({});
  term.feed('ab\x7fc\r');
  assert.equal(await line, 'ac');
});

test('masked input does not echo the secret', async () => {
  const { term, output } = makeTerminal();
  const line = term.readLine({ prompt: 'Password: ', mask: true });
  term.feed('secret\r');
  assert.equal(await line, 'secret');
  assert.ok(!output().includes('secret'));
  assert.ok(output().includes('******'));
});

test('CRLF and LF both terminate a line and remaining input is kept', async () => {
  const { term } = makeTerminal();
  const first = term.readLine({});
  term.feed('one\r\ntwo\n');
  assert.equal(await first, 'one');
  const second = term.readLine({});
  assert.equal(await second, 'two');
});

test('Ctrl-C cancels the read', async () => {
  const { term } = makeTerminal();
  const line = term.readLine({});
  term.feed('\x03');
  await assert.rejects(line, (err) => err instanceof Cancelled);
});

test('the minimum length is enforced before accepting ENTER', async () => {
  const { term, output } = makeTerminal();
  const line = term.readLine({ min: 3 });
  term.feed('\r');
  term.feed('abc\r');
  assert.equal(await line, 'abc');
  assert.ok(output().includes('\x07'));
});

test('readKey filters invalid keys and lowercases', async () => {
  const { term } = makeTerminal();
  const key = term.readKey({ valid: 'ab' });
  term.feed('zA');
  assert.equal(await key, 'a');
});

test('arrow-key escape sequences are ignored by readLine', async () => {
  const { term } = makeTerminal();
  const line = term.readLine({});
  term.feed('\x1b[Aok\r');
  assert.equal(await line, 'ok');
});

test('idle timeout fires while reading', async () => {
  const { term } = makeTerminal({ idleTimeoutMs: 5 });
  const line = term.readLine({ tickMs: 20 });
  await assert.rejects(line, (err) => err instanceof IdleTimeout);
});

test('a closed terminal rejects reads', async () => {
  const { term } = makeTerminal();
  term.markClosed();
  await assert.rejects(term.readLine({}), (err) => err instanceof Disconnected);
});

test('resize clamps terminal dimensions', () => {
  const { term } = makeTerminal();
  term.resize(10, 5);
  assert.equal(term.cols, 40);
  assert.equal(term.rows, 12);
  term.resize(500, 500);
  assert.equal(term.cols, 160);
  assert.equal(term.rows, 80);
});
