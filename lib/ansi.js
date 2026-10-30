'use strict';

const ESC = '\x1b[';

const color = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  inverse: `${ESC}7m`,
  black: `${ESC}30m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,
  brightRed: `${ESC}91m`,
  brightGreen: `${ESC}92m`,
  brightYellow: `${ESC}93m`,
  brightBlue: `${ESC}94m`,
  brightMagenta: `${ESC}95m`,
  brightCyan: `${ESC}96m`,
  brightWhite: `${ESC}97m`,
};

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '');
}

function visibleLength(text) {
  return stripAnsi(text).length;
}

function paint(text, code) {
  return `${code}${text}${color.reset}`;
}

function center(text, width) {
  const length = visibleLength(text);
  if (length >= width) return text;
  const left = Math.floor((width - length) / 2);
  return ' '.repeat(left) + text + ' '.repeat(width - length - left);
}

function padRight(text, width) {
  const length = visibleLength(text);
  return length >= width ? text : text + ' '.repeat(width - length);
}

function truncate(text, width) {
  if (visibleLength(text) <= width) return text;
  if (width <= 0) return '';
  let out = '';
  let visible = 0;
  for (let i = 0; i < text.length; ) {
    if (text[i] === '\x1b') {
      const match = text.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (visible >= width - 1) {
      out += '…';
      break;
    }
    out += text[i++];
    visible += 1;
  }
  return out;
}

/** Sanitize user-authored text: keep newlines and tabs, drop other controls. */
function sanitize(text, maxLength = 10000) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, maxLength);
}

// Wrapping works on visible width, so escape sequences are kept as zero-width
// tokens instead of being dropped by sanitize(). User text is sanitized before
// it reaches the database, so the only sequences seen here are our own.
function stripControls(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const match = text[i] === '\x1b' && text.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
    if (match) {
      out += match[0];
      i += match[0].length - 1;
      continue;
    }
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) continue;
    out += text[i];
  }
  return out;
}

function splitWords(paragraph) {
  const words = [];
  let word = '';
  for (let i = 0; i < paragraph.length; i++) {
    const match = paragraph[i] === '\x1b' && paragraph.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
    if (match) {
      word += match[0];
      i += match[0].length - 1;
    } else if (/\s/.test(paragraph[i])) {
      if (word) words.push(word);
      word = '';
    } else {
      word += paragraph[i];
    }
  }
  if (word) words.push(word);
  return words;
}

function sliceVisible(text, width) {
  let out = '';
  let visible = 0;
  let i = 0;
  while (i < text.length && visible < width) {
    const match = text[i] === '\x1b' && text.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
    if (match) {
      out += match[0];
      i += match[0].length;
      continue;
    }
    out += text[i];
    visible += 1;
    i += 1;
  }
  return [out, text.slice(i)];
}

function wrap(text, width) {
  const limit = Math.max(10, width);
  const out = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const paragraph = stripControls(raw);
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of splitWords(paragraph)) {
      const size = visibleLength(word);
      if (!line) {
        if (size <= limit) {
          line = word;
        } else {
          let rest = word;
          while (visibleLength(rest) > limit) {
            const [head, tail] = sliceVisible(rest, limit);
            out.push(head);
            rest = tail;
          }
          line = rest;
        }
      } else if (visibleLength(line) + 1 + size <= limit) {
        line += ` ${word}`;
      } else {
        out.push(line);
        if (size <= limit) {
          line = word;
        } else {
          let rest = word;
          while (visibleLength(rest) > limit) {
            const [head, tail] = sliceVisible(rest, limit);
            out.push(head);
            rest = tail;
          }
          line = rest;
        }
      }
    }
    if (line) out.push(line);
  }
  return out;
}

// Posts are plain text, so scene art arrives as block/box characters. Re-flowing
// those lines would shear the picture apart, so they are detected and kept
// verbatim while prose is still wrapped to the terminal.
const ART_CHARS = /[\u2500-\u259f\u25a0-\u25ff]/;
const ART_MIN_CHARS = 2;

function looksLikeArt(line) {
  let hits = 0;
  for (const char of stripAnsi(line)) {
    if (ART_CHARS.test(char)) hits += 1;
    if (hits >= ART_MIN_CHARS) return true;
  }
  return false;
}

function renderBody(text, width) {
  const limit = Math.max(10, width);
  const out = [];
  let prose = [];
  const flush = () => {
    if (!prose.length) return;
    out.push(...wrap(prose.join('\n'), limit));
    prose = [];
  };
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = stripControls(raw).replace(/\s+$/, '');
    if (!line.trim()) {
      flush();
      out.push('');
    } else if (looksLikeArt(line)) {
      flush();
      // Truncate instead of wrapping: an ellipsis would break the alignment.
      out.push(visibleLength(line) > limit ? sliceVisible(line, limit)[0] : line);
    } else {
      prose.push(line);
    }
  }
  flush();
  return out;
}

function box(title, contentLines, width = 76, options = {}) {
  const w = Math.max(24, width);
  const plain = Boolean(options.plain);
  const border = plain ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' } : { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' };
  const inner = w - 4;
  const lines = [];
  if (title) {
    const label = ` ${truncate(title, inner - 2)} `;
    const fill = Math.max(0, w - 3 - label.length);
    lines.push(
      paint(
        border.tl + border.h + label + border.h.repeat(fill) + border.tr,
        options.borderColor || color.cyan
      )
    );
  } else {
    lines.push(paint(border.tl + border.h.repeat(w - 2) + border.tr, options.borderColor || color.cyan));
  }
  for (const raw of contentLines) {
    const rows = visibleLength(raw) <= inner ? [raw] : wrap(raw, inner);
    for (const line of rows) {
      lines.push(
        paint(border.v, options.borderColor || color.cyan) +
          ' ' +
          padRight(truncate(line, inner), inner) +
          ' ' +
          paint(border.v, options.borderColor || color.cyan)
      );
    }
  }
  lines.push(paint(border.bl + border.h.repeat(w - 2) + border.br, options.borderColor || color.cyan));
  return lines.join('\r\n');
}

function clear() {
  return `${ESC}2J${ESC}H`;
}

function home() {
  return `${ESC}H`;
}

function formatDate(iso, withTime = true) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}` : base;
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

module.exports = {
  ESC,
  color,
  stripAnsi,
  visibleLength,
  paint,
  center,
  padRight,
  truncate,
  sanitize,
  wrap,
  looksLikeArt,
  renderBody,
  box,
  clear,
  home,
  formatDate,
  relativeTime,
};
