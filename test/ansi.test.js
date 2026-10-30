'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ansi = require('../lib/ansi');

test('ANSI sequences are stripped for measurement', () => {
  const text = ansi.paint('hello', ansi.color.brightGreen);
  assert.equal(ansi.stripAnsi(text), 'hello');
  assert.equal(ansi.visibleLength(text), 5);
});

test('box lines all have the requested visible width', () => {
  const rendered = ansi.box('Title', ['short', 'a much longer line that has to wrap several times inside the box'], 40);
  const lines = rendered.split('\r\n');
  assert.ok(lines.length >= 5);
  for (const line of lines) assert.equal(ansi.visibleLength(line), 40, line);
});

test('plain boxes avoid unicode borders', () => {
  const rendered = ansi.box('T', ['x'], 30, { plain: true });
  assert.ok(rendered.includes('+'));
  assert.ok(!rendered.includes('╔'));
  for (const line of rendered.split('\r\n')) assert.equal(ansi.visibleLength(line), 30);
});

test('wrap respects width and preserves blank lines', () => {
  assert.deepEqual(ansi.wrap('one two three', 7), ['one two', 'three']);
  assert.deepEqual(ansi.wrap('a\n\nb', 10), ['a', '', 'b']);
  const long = 'x'.repeat(25);
  assert.deepEqual(ansi.wrap(long, 10), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
});

test('sanitize strips control characters and normalizes CRLF', () => {
  assert.equal(ansi.sanitize('a\r\nb\rc\u0007d'), 'a\nb\ncd');
  assert.equal(ansi.sanitize('x'.repeat(20), 10).length, 10);
});

test('truncate keeps visible width and adds an ellipsis', () => {
  const text = ansi.paint('abcdefghij', ansi.color.red);
  const out = ansi.truncate(text, 5);
  assert.equal(ansi.visibleLength(out), 5);
  assert.ok(out.includes('…'));
});

test('centering and padding use visible length', () => {
  assert.equal(ansi.center(ansi.paint('ab', ansi.color.red), 6), '  ' + ansi.paint('ab', ansi.color.red) + '  ');
  assert.equal(ansi.visibleLength(ansi.padRight(ansi.paint('ab', ansi.color.red), 6)), 6);
});

test('wrapping preserves color sequences and drops stray control characters', () => {
  const painted = ansi.paint('one two three four', ansi.color.brightGreen);
  const lines = ansi.wrap(painted, 9);
  assert.equal(ansi.stripAnsi(lines[0]), 'one two');
  assert.ok(lines[0].startsWith(ansi.color.brightGreen));
  assert.ok(lines[lines.length - 1].endsWith(ansi.color.reset));
  assert.equal(ansi.stripAnsi(ansi.wrap('\x07hi', 10)[0]), 'hi');
});

test('art lines are detected from block and box characters', () => {
  assert.equal(ansi.looksLikeArt('just plain prose here'), false);
  assert.equal(ansi.looksLikeArt('a single ─ dash'), false);
  assert.equal(ansi.looksLikeArt('───'), true);
  assert.equal(ansi.looksLikeArt('  ░▒▓█ scene █▓▒░'), true);
  assert.equal(ansi.looksLikeArt(ansi.paint('█ █', ansi.color.brightCyan)), true);
});

test('renderBody keeps art verbatim and wraps prose', () => {
  const body = 'one two three four\n\n  ▄▄█▄▄\n  █   █\n  ▀▀▀▀▀\n\ntrailing words';
  const lines = ansi.renderBody(body, 10);
  assert.deepEqual(lines.slice(0, 2), ['one two', 'three four']);
  assert.equal(lines[2], '');
  assert.deepEqual(lines.slice(3, 6), ['  ▄▄█▄▄', '  █   █', '  ▀▀▀▀▀'], 'art keeps its exact indentation');
  assert.equal(lines[6], '');
  assert.deepEqual(lines.slice(7), ['trailing', 'words']);
});

test('renderBody truncates overlong art instead of wrapping it', () => {
  const lines = ansi.renderBody('█'.repeat(20), 12);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], '█'.repeat(12));
});

test('renderBody drops stray control characters and trailing blanks', () => {
  const lines = ansi.renderBody('\x07hi there   \n\n', 20);
  assert.deepEqual(lines, ['hi there', '', '']);
});

test('boxes keep preformatted, centered and colored lines intact', () => {
  const banner = ansi.center(ansi.paint('B B S', ansi.color.bold), 30);
  const line = ansi.box('', [banner], 34).split('\r\n')[1];
  assert.ok(line.includes(ansi.color.bold + 'B B S'));
  assert.ok(line.includes(ansi.color.reset));
  assert.ok(line.includes(ansi.paint('║', ansi.color.cyan)));
  assert.equal(ansi.visibleLength(line), 34);
  assert.equal(ansi.stripAnsi(line).indexOf('B B S'), 14);
});
