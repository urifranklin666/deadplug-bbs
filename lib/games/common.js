'use strict';

const ansi = require('../ansi');

function drawHeader(term, title, subtitle = '') {
  term.clearScreen();
  const width = Math.min(76, Math.max(50, term.cols - 2));
  term.write(ansi.paint(ansi.center(` ${title} `, width), ansi.color.bold + ansi.color.brightYellow) + '\r\n');
  if (subtitle) term.write(ansi.color.gray + ansi.center(subtitle, width) + ansi.color.reset + '\r\n');
  term.write('\r\n');
  return width;
}

function rule(width = 60) {
  return ansi.color.gray + '─'.repeat(width) + ansi.color.reset;
}

function cardLabel(card) {
  const red = card.suit === '♥' || card.suit === '♦';
  const text = `${card.rank}${card.suit}`;
  return red ? ansi.paint(text, ansi.color.brightRed) : text;
}

function cardLine(cards) {
  return cards.map(cardLabel).join('  ');
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      aces += 1;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function saveScore(game, userId, score) {
  const { getDb, nowIso, lastId } = require('../db');
  return lastId(
    getDb()
      .prepare('INSERT INTO scores (game, user_id, score, created_at) VALUES (?, ?, ?, ?)')
      .run(game, Number(userId), Number(score), nowIso())
  );
}

function highScores(game, limit = 5) {
  const { getDb } = require('../db');
  return getDb()
    .prepare(
      `SELECT s.score, s.created_at, u.handle FROM scores s JOIN users u ON u.id = s.user_id
       WHERE s.game = ? ORDER BY s.score DESC, s.id ASC LIMIT ?`
    )
    .all(game, Number(limit));
}

function showScores(term, game, label = 'High scores') {
  const rows = highScores(game);
  term.write(`\r\n${ansi.paint(label, ansi.color.bold + ansi.color.brightCyan)}\r\n`);
  if (!rows.length) term.write(ansi.color.gray + '  (nobody yet)' + ansi.color.reset + '\r\n');
  rows.forEach((row, index) => {
    term.write(`  ${index + 1}. ${ansi.padRight(row.handle, 18)} ${String(row.score).padStart(8)}\r\n`);
  });
}

module.exports = { drawHeader, rule, cardLabel, cardLine, handValue, saveScore, highScores, showScores };
