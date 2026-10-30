'use strict';

const ansi = require('./ansi');

// 5x5 bitmap font, rendered as solid blocks with a column gradient and a
// one-cell drop shadow. Only the characters below are needed for board names.
const FONT = {
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  F: ['#####', '#....', '####.', '#....', '#....'],
  G: ['.####', '#....', '#..##', '#...#', '.###.'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '###..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '####.', '#....', '#....'],
  Q: ['.###.', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  Z: ['#####', '...#.', '..#..', '.#...', '#####'],
  0: ['.###.', '#..##', '#.#.#', '##..#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '..##.', '.#...', '#####'],
  3: ['####.', '....#', '.###.', '....#', '####.'],
  4: ['#...#', '#...#', '#####', '....#', '....#'],
  5: ['#####', '#....', '####.', '....#', '####.'],
  6: ['.###.', '#....', '####.', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...'],
  8: ['.###.', '#...#', '.###.', '#...#', '.###.'],
  9: ['.###.', '#...#', '.####', '....#', '.###.'],
  ' ': ['.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '#####', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '..#..'],
  '!': ['..#..', '..#..', '..#..', '.....', '..#..'],
};

const GLYPH_W = 5;
const GLYPH_GAP = 1;

const GRADIENT = [
  ansi.color.brightCyan,
  ansi.color.cyan,
  ansi.color.brightBlue,
  ansi.color.blue,
  ansi.color.brightMagenta,
  ansi.color.magenta,
];

const GREETZ = [
  'greetz to every sysop still keeping a node alive',
  '2400 baud and a dream',
  'no ratio, no leech, just text',
  'ANSI never died, it just went underground',
  'the signal never dies',
  'another node in the dark',
];

// One heading palette per board, cycled by board id. Colour is picked from the
// id rather than the name so renaming a board keeps its identity. No accent
// matches the bright-yellow row numbers, so list rows stay readable.
const PALETTES = [
  { accent: ansi.color.brightCyan, edge: ansi.color.magenta, fill: ansi.color.blue },
  { accent: ansi.color.brightMagenta, edge: ansi.color.brightCyan, fill: ansi.color.blue },
  { accent: ansi.color.brightGreen, edge: ansi.color.brightBlue, fill: ansi.color.cyan },
  { accent: ansi.color.brightWhite, edge: ansi.color.brightMagenta, fill: ansi.color.blue },
  { accent: ansi.color.brightBlue, edge: ansi.color.brightCyan, fill: ansi.color.magenta },
];

const DEFAULT_PALETTE = PALETTES[0];

function boardPalette(id) {
  const n = Math.trunc(Number(id));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PALETTE;
  return PALETTES[(n - 1) % PALETTES.length];
}

function sanitizeName(name) {
  const clean = String(name || 'BBS')
    .toUpperCase()
    .replace(/[^A-Z0-9 .!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return clean || 'BBS';
}

function letterSpace(text) {
  return String(text).split('').join(' ');
}

/**
 * Render a word as block characters. Every returned line has the same exact
 * visible width, including the shadow column, so callers can frame or center
 * it without measuring again.
 */
function logo(name) {
  const text = sanitizeName(name);
  const width = Math.max(1, text.length * (GLYPH_W + GLYPH_GAP) - GLYPH_GAP);
  const pixels = Array.from({ length: 5 }, () => new Array(width).fill(false));
  for (let i = 0; i < text.length; i++) {
    const rows = FONT[text[i]] || FONT[' '];
    const base = i * (GLYPH_W + GLYPH_GAP);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        if (rows[y][x] === '#') pixels[y][base + x] = true;
      }
    }
  }

  const outWidth = width + 1;
  const rowsHigh = 6;

  // Shadows are only painted on cells reachable from the border, so the
  // counters inside letters (B, O, R…) stay open instead of filling with
  // shade and turning the logo into mush.
  const outside = Array.from({ length: rowsHigh }, () => new Array(outWidth).fill(false));
  const queue = [];
  const visit = (x, y) => {
    if (x < 0 || y < 0 || x >= outWidth || y >= rowsHigh) return;
    if (outside[y][x]) return;
    if (y < 5 && x < width && pixels[y][x]) return;
    outside[y][x] = true;
    queue.push([x, y]);
  };
  for (let x = 0; x < outWidth; x++) {
    visit(x, 0);
    visit(x, rowsHigh - 1);
  }
  for (let y = 0; y < rowsHigh; y++) {
    visit(0, y);
    visit(outWidth - 1, y);
  }
  while (queue.length) {
    const [x, y] = queue.pop();
    visit(x + 1, y);
    visit(x - 1, y);
    visit(x, y + 1);
    visit(x, y - 1);
  }

  const lines = [];
  for (let y = 0; y < rowsHigh; y++) {
    let line = '';
    let current = null;
    const use = (color) => {
      if (color === current) return;
      line += color;
      current = color;
    };
    for (let x = 0; x < outWidth; x++) {
      const solid = y < 5 && x < width && pixels[y][x];
      const shadow =
        !solid && outside[y][x] && y > 0 && x > 0 && x - 1 < width && pixels[y - 1][x - 1];
      if (solid) {
        // Chunky bands read as a gradient on 16-colour terminals.
        const band = Math.min(GRADIENT.length - 1, Math.floor((x / width) * GRADIENT.length));
        use(GRADIENT[band]);
        line += '\u2588';
      } else if (shadow) {
        use(ansi.color.blue);
        line += '\u2593';
      } else {
        if (current !== null) {
          line += ansi.color.reset;
          current = null;
        }
        line += ' ';
      }
    }
    if (current !== null) line += ansi.color.reset;
    lines.push(line);
  }
  return { lines, width: outWidth };
}

function center(text, width) {
  return ansi.center(text, width);
}

/**
 * Full-screen splash shown before the login prompt: the block logo inside a
 * gradient frame, a tagline plate, one scene ad line, greetz and the board
 * stats. Sized to leave room for a prompt on an 80x24 terminal.
 */
function splash({ name, tagline = '', ad = '', greetz = '', stats = '', width = 78, plain = false }) {
  const art = logo(name);
  const inner = width - 2;
  const finish = (lines) => (plain ? lines.map(ansi.stripAnsi) : lines);

  if (plain || art.width + 6 > width) {
    const lines = [center(ansi.paint(letterSpace(sanitizeName(name)), ansi.color.bold + ansi.color.brightCyan), width)];
    if (tagline) lines.push(center(ansi.paint(ansi.truncate(tagline, width), ansi.color.brightWhite), width));
    if (ad) lines.push(center(ansi.paint(ansi.truncate(ad, width), ansi.color.brightMagenta), width));
    lines.push('');
    if (greetz) lines.push(center(ansi.truncate(greetz, width), width));
    if (stats) lines.push(center(ansi.paint(stats, ansi.color.gray), width));
    return finish(lines);
  }

  const wall = (text) => ansi.paint('\u2588', ansi.color.brightBlue) + text + ansi.paint('\u2588', ansi.color.brightBlue);
  const blank = wall(' '.repeat(inner));
  const lines = [ansi.paint('\u2584'.repeat(width), ansi.color.brightCyan)];
  const pad = inner - art.width;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  for (const row of art.lines) lines.push(wall(`${' '.repeat(left)}${row}${' '.repeat(right)}`));
  lines.push(blank);
  if (tagline) {
    lines.push(wall(center(ansi.paint(`\u00b7=[ ${ansi.truncate(tagline, inner - 6)} ]=\u00b7`, ansi.color.brightWhite), inner)));
    lines.push(blank);
  }
  if (ad) {
    lines.push(wall(center(ansi.paint(ansi.truncate(ad, inner - 2), ansi.color.bold + ansi.color.brightMagenta), inner)));
    lines.push(blank);
  }
  lines.push(ansi.paint('\u2580'.repeat(width), ansi.color.magenta));
  lines.push('');
  if (greetz) lines.push(center(greetz, width));
  if (stats) {
    lines.push('');
    lines.push(center(ansi.paint(stats, ansi.color.gray), width));
  }
  return finish(lines);
}

/**
 * Framed scene banner: block logo, tagline and a status footer inside a
 * gradient block frame. Falls back to spaced-out text when the name is too
 * wide for the terminal.
 */
function banner({ name, tagline = '', stats = '', width = 78, plain = false }) {
  const art = logo(name);
  const inner = width - 2;
  // Plain clients (no ANSI) and narrow terminals both get letter-spaced text
  // rather than a wall of block characters.
  if (plain || art.width + 6 > width) {
    const lines = [center(ansi.paint(letterSpace(sanitizeName(name)), ansi.color.bold + ansi.color.brightCyan), width)];
    if (tagline) lines.push(center(ansi.paint(ansi.truncate(tagline, width), ansi.color.brightWhite), width));
    if (stats) lines.push(center(ansi.paint(stats, ansi.color.gray), width));
    return plain ? lines.map(ansi.stripAnsi) : lines;
  }

  const side = '\u2588';
  const top = ansi.paint('\u2584'.repeat(width), ansi.color.brightCyan);
  const bottom = ansi.paint('\u2580'.repeat(width), ansi.color.magenta);
  const pad = inner - art.width;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  const lines = [top];
  for (const row of art.lines) lines.push(`${side}${' '.repeat(left)}${row}${' '.repeat(right)}${side}`);
  lines.push(`${side}${' '.repeat(inner)}${side}`);
  if (tagline) {
    const text = ansi.truncate(tagline, inner - 6);
    lines.push(`${side}${center(ansi.paint(`\u00b7=[ ${text} ]=\u00b7`, ansi.color.brightWhite), inner)}${side}`);
    lines.push(`${side}${' '.repeat(inner)}${side}`);
  }
  if (stats) {
    lines.push(`${side}${center(ansi.paint(stats, ansi.color.gray), inner)}${side}`);
  }
  lines.push(bottom);
  return lines;
}

function heading(title, extra = '', width = 78, { upper = true, palette = null } = {}) {
  const { accent, edge, fill: fillColor } = palette || DEFAULT_PALETTE;
  const label = upper ? String(title).toUpperCase() : String(title);
  const room = Math.max(8, width - 6);
  const shown = ansi.truncate(label, room);
  // Only add a suffix when at least one of its characters fits: a bare
  // leading space would push the row one cell past the requested width.
  const suffixRoom = Math.max(0, width - 6 - shown.length - 1);
  const suffix = extra && suffixRoom > 0 ? ` ${ansi.truncate(String(extra), suffixRoom)}` : '';
  const fill = Math.max(0, width - 6 - shown.length - suffix.length);
  return (
    ansi.paint('\u2584\u2584', edge) +
    ansi.paint(`[ ${shown} ]`, ansi.color.bold + accent) +
    ansi.paint('\u2584'.repeat(fill), fillColor) +
    (suffix ? ansi.paint(suffix, ansi.color.gray) : '')
  );
}

function menuRow(key, label, extra, width = 78) {
  const pad = ansi.padRight(label, 20);
  const suffix = extra ? ` ${extra}` : '';
  const dots = Math.max(0, width - 26 - suffix.length);
  return (
    `  ${ansi.paint(`[${key}]`, ansi.color.bold + ansi.color.brightYellow)} ` +
    ansi.paint(pad, ansi.color.brightWhite) +
    ansi.paint('\u00b7'.repeat(dots), ansi.color.blue) +
    (suffix ? ansi.paint(suffix, ansi.color.gray) : '')
  );
}

function rule(width = 78, char = '\u2500') {
  return ansi.paint(char.repeat(width), ansi.color.blue);
}

function greetz(index = 0) {
  return ansi.paint(`  \u00b7 \u00b7 \u00b7 greetz: ${GREETZ[index % GREETZ.length]} \u00b7 \u00b7 \u00b7`, ansi.color.gray);
}

function pickGreetz() {
  return Math.floor(Math.random() * GREETZ.length);
}

function carrierLost(width = 78) {
  const w = Math.min(width, 58);
  const inner = w - 2;
  const message = 'C A R R I E R   L O S T   \u00b7   7 3';
  return [
    ansi.paint('\u2584'.repeat(w), ansi.color.brightCyan),
    ansi.paint('\u2588', ansi.color.brightCyan) +
      center(ansi.paint(message, ansi.color.bold + ansi.color.brightWhite), inner) +
      ansi.paint('\u2588', ansi.color.brightCyan),
    ansi.paint('\u2580'.repeat(w), ansi.color.magenta),
  ];
}

module.exports = {
  FONT,
  GRADIENT,
  GREETZ,
  PALETTES,
  boardPalette,
  logo,
  banner,
  splash,
  heading,
  menuRow,
  rule,
  greetz,
  pickGreetz,
  carrierLost,
  letterSpace,
};
