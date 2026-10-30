'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ansi = require('../lib/ansi');
const art = require('../lib/art');

const ESC = '\x1b';

test('every glyph is a five by five bitmap', () => {
  for (const [char, rows] of Object.entries(art.FONT)) {
    assert.equal(rows.length, 5, char);
    for (const row of rows) assert.equal(row.length, 5, `${char}: ${row}`);
    for (const row of rows) assert.match(row, /^[#.]+$/, `${char}: ${row}`);
  }
});

test('logo rows share one visible width and clear their colour', () => {
  const rendered = art.logo('DEADPLUG BBS');
  assert.equal(rendered.lines.length, 6);
  const width = rendered.width;
  assert.ok(width > 40 && width < 78, `width ${width}`);
  for (const row of rendered.lines) {
    assert.equal(ansi.visibleLength(row), width, row);
    // trailing blanks may follow the reset, so check the painted part
    assert.ok(row.replace(/ +$/, '').endsWith(ansi.color.reset), row);
  }
});

test('logo sanitises names and keeps a usable fallback', () => {
  const cleaned = art.logo('dead plug!!! 2026');
  assert.equal(cleaned.lines.length, 6);
  assert.equal(cleaned.width, 14 * 6, '14 characters including the shadow column');
  const fallback = art.logo('@@@');
  assert.equal(fallback.width, 3 * 6, 'falls back to "BBS"');
  assert.match(ansi.stripAnsi(fallback.lines[0]), /\u2588/, 'falls back to the default name');
});

test('banner lines are exactly as wide as requested', () => {
  const lines = art.banner({
    name: 'DEADPLUG',
    tagline: 'text only, no pictures',
    stats: 'node 01 · 2400 baud',
    width: 78,
  });
  assert.equal(lines.length, 12);
  for (const line of lines) assert.equal(ansi.visibleLength(line), 78, line);
});

test('banner degrades to letter spacing on narrow terminals', () => {
  const lines = art.banner({ name: 'DEADPLUG BBS', tagline: 'hi', stats: 'x', width: 40 });
  assert.equal(lines.length, 3);
  for (const line of lines) assert.equal(ansi.visibleLength(line), 40, line);
  assert.match(ansi.stripAnsi(lines[0]), /D E A D P L U G/);
});

test('plain banner contains no escape sequences', () => {
  const lines = art.banner({ name: 'DEADPLUG', tagline: 'plain', stats: 'x', width: 78, plain: true });
  for (const line of lines) assert.ok(!line.includes(ESC), line);
});

test('splash fits an 80x24 terminal and holds its width', () => {
  const lines = art.splash({
    name: 'DEADPLUG BBS',
    tagline: 'Where the signal never dies',
    ad: 'est. 1993 · no ratio, just text',
    greetz: art.greetz(0),
    stats: '1 online · node 01 · 2026',
    width: 78,
  });
  // 17 rows of art leaves room for the "press ENTER" prompt on 24 rows.
  assert.equal(lines.length, 17);
  for (const line of lines) {
    if (!line) continue;
    assert.equal(ansi.visibleLength(line), 78, ansi.stripAnsi(line));
  }
  assert.match(ansi.stripAnsi(lines[0]), /^\u2584{78}$/);
  assert.match(ansi.stripAnsi(lines[lines.length - 1]), /2026/);
});

test('splash falls back to letter spacing on narrow or plain terminals', () => {
  const narrow = art.splash({ name: 'DEADPLUG BBS', tagline: 'hi', greetz: 'greetz', stats: 'x', width: 50 });
  for (const line of narrow) {
    if (!line) continue;
    assert.equal(ansi.visibleLength(line), 50, line);
  }
  assert.match(ansi.stripAnsi(narrow[0]), /D E A D P L U G/);

  const plain = art.splash({ name: 'DEADPLUG BBS', tagline: 'hi', ad: 'ad', greetz: 'greetz', stats: 'x', width: 78, plain: true });
  for (const line of plain) {
    assert.ok(!line.includes(ESC), line);
    if (line) assert.equal(ansi.visibleLength(line), 78, line);
  }
});

test('splash drops optional rows instead of leaving holes', () => {
  const sparse = art.splash({ name: 'BBS', width: 78 });
  assert.equal(sparse.length, 10);
  for (const line of sparse) {
    if (!line) continue;
    assert.equal(ansi.visibleLength(line), 78, line);
  }
});

test('headings and menu rows hold their width with and without a suffix', () => {
  for (const line of [
    art.heading('MAIN MENU'),
    art.heading('MESSAGE BOARDS', '4 boards'),
    art.heading('SYSOP CONSOLE', 'level 100'),
    art.menuRow('B', 'Message Boards', '4 boards'),
    art.menuRow('Q', 'Log Off', ''),
  ]) {
    assert.equal(ansi.visibleLength(line), 78, ansi.stripAnsi(line));
  }
});

test('long headings are truncated rather than overflowing', () => {
  const line = art.heading('A'.repeat(200), 'x'.repeat(200));
  assert.equal(ansi.visibleLength(line), 78);
});

test('board palettes are deterministic and spread across the seeded boards', () => {
  assert.equal(art.boardPalette(1), art.boardPalette(1));
  const seen = new Set();
  for (let id = 1; id <= art.PALETTES.length; id++) {
    const palette = art.boardPalette(id);
    assert.ok(art.PALETTES.includes(palette), `board ${id}`);
    seen.add(palette.accent);
  }
  assert.equal(seen.size, art.PALETTES.length, 'each seeded board gets its own accent');
  assert.equal(art.boardPalette(art.PALETTES.length + 1), art.boardPalette(1), 'palettes cycle');
  assert.equal(art.boardPalette(undefined), art.boardPalette(1), 'unknown ids fall back');
  assert.equal(art.boardPalette('7'), art.boardPalette(7), 'ids arriving as strings still work');
});

test('palette headings keep their width and use the board colours', () => {
  const palette = art.boardPalette(3);
  const line = art.heading('Tech Talk', 'page 1/2', 78, { upper: false, palette });
  assert.equal(ansi.visibleLength(line), 78, ansi.stripAnsi(line));
  assert.ok(line.startsWith(ansi.paint('\u2584\u2584', palette.edge)));
  assert.ok(line.includes(ansi.paint('[ Tech Talk ]', ansi.color.bold + palette.accent)));
  // The default palette is unchanged for call sites that pass no options.
  assert.equal(ansi.stripAnsi(art.heading('MAIN MENU')), ansi.stripAnsi(art.heading('MAIN MENU', '', 78, { palette: art.PALETTES[0] })));
});

test('the carrier lost plate stays narrow and coloured', () => {
  const lines = art.carrierLost();
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal(ansi.visibleLength(line), 58, ansi.stripAnsi(line));
    assert.ok(line.includes(ESC));
  }
  assert.match(ansi.stripAnsi(lines[1]), /C A R R I E R   L O S T/);
});

test('greetz rotate through the pool', () => {
  const seen = new Set();
  for (let i = 0; i < art.GREETZ.length; i++) {
    const line = art.greetz(i);
    assert.equal(ansi.visibleLength(line), ansi.visibleLength(ansi.stripAnsi(line)));
    assert.ok(ansi.stripAnsi(line).includes(art.GREETZ[i]));
    seen.add(art.GREETZ[i]);
  }
  assert.equal(seen.size, art.GREETZ.length);
  assert.ok(art.pickGreetz() >= 0 && art.pickGreetz() < art.GREETZ.length);
});
