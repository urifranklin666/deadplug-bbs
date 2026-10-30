'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { getDb } = require('./db');

const BUILTINS = {
  blackjack: () => require('./games/blackjack'),
  trivia: () => require('./games/trivia'),
  dungeon: () => require('./games/dungeon'),
};

function listDoors(level = 0) {
  return getDb()
    .prepare('SELECT * FROM doors WHERE enabled = 1 AND min_level <= ? ORDER BY sort_order, id')
    .all(Number(level));
}

function getDoor(id) {
  return getDb().prepare('SELECT * FROM doors WHERE id = ?').get(Number(id)) || null;
}

function createDoor(fields) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO doors
       (name, description, kind, builtin, command, args, drop_file, pty, timeout_seconds, min_level, enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(fields.name || 'Untitled door').slice(0, 40),
      String(fields.description || '').slice(0, 200),
      fields.kind === 'external' ? 'external' : 'builtin',
      fields.builtin || null,
      fields.command || null,
      JSON.stringify(Array.isArray(fields.args) ? fields.args : []),
      fields.dropFile || 'DORINFO1.DEF',
      fields.pty === false ? 0 : 1,
      Number(fields.timeoutSeconds) || 900,
      Number(fields.minLevel) || 10,
      fields.enabled ? 1 : 0,
      Number(fields.sortOrder) || 100
    );
  return getDoor(Number(result.lastInsertRowid));
}

function updateDoor(id, fields) {
  const door = getDoor(id);
  if (!door) throw new Error('Door not found.');
  getDb()
    .prepare(
      `UPDATE doors SET name = ?, description = ?, kind = ?, builtin = ?, command = ?, args = ?,
       drop_file = ?, pty = ?, timeout_seconds = ?, min_level = ?, enabled = ?, sort_order = ? WHERE id = ?`
    )
    .run(
      fields.name !== undefined ? String(fields.name).slice(0, 40) : door.name,
      fields.description !== undefined ? String(fields.description).slice(0, 200) : door.description,
      fields.kind !== undefined ? (fields.kind === 'external' ? 'external' : 'builtin') : door.kind,
      fields.builtin !== undefined ? fields.builtin : door.builtin,
      fields.command !== undefined ? fields.command : door.command,
      fields.args !== undefined ? JSON.stringify(Array.isArray(fields.args) ? fields.args : []) : door.args,
      fields.dropFile !== undefined ? fields.dropFile : door.drop_file,
      fields.pty !== undefined ? (fields.pty ? 1 : 0) : door.pty,
      fields.timeoutSeconds !== undefined ? Number(fields.timeoutSeconds) : door.timeout_seconds,
      fields.minLevel !== undefined ? Number(fields.minLevel) : door.min_level,
      fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : door.enabled,
      fields.sortOrder !== undefined ? Number(fields.sortOrder) : door.sort_order,
      door.id
    );
  return getDoor(door.id);
}

function deleteDoor(id) {
  return getDb().prepare('DELETE FROM doors WHERE id = ?').run(Number(id)).changes > 0;
}

function parseArgs(text) {
  const args = [];
  const input = String(text || '');
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function writeDropFile(dir, type, bbs) {
  const user = bbs.user;
  const node = bbs.runtimeSession ? bbs.runtimeSession.node : 1;
  const bbsName = bbs.bbsName;
  const location = user.location || 'Parts Unknown';
  const realName = user.real_name || user.handle;
  const minutesLeft = Math.max(1, Math.round((bbs.term.idleTimeoutMs - (Date.now() - bbs.term.lastActivity)) / 60000));
  const ansiFlag = user.ansi ? '1' : '0';

  if (type === 'DOOR.SYS') {
    const lines = [
      'COM0',
      '38400',
      '8N1',
      String(node),
      '0',
      'Y',
      'N',
      'Y',
      'Y',
      realName,
      location,
      '',
      '',
      '',
      String(user.level || 10),
      String(user.posts || 0),
      new Date().toLocaleDateString('en-US'),
      String(minutesLeft * 60),
      String(minutesLeft),
      'GR',
      String(bbs.term.rows),
      'Y',
      ansiFlag,
      'Y',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      'N',
      user.handle,
      '',
      '',
      '0',
    ];
    while (lines.length < 52) lines.push('');
    return lines.slice(0, 52).join('\r\n') + '\r\n';
  }

  if (type === 'CHAIN.TXT') {
    return [
      realName,
      user.handle,
      location,
      String(user.level || 10),
      String(minutesLeft),
      ansiFlag,
      String(bbs.term.cols),
      String(bbs.term.rows),
      String(node),
      bbsName,
      '',
    ].join('\r\n') + '\r\n';
  }

  // DORINFO1.DEF
  return [
    bbsName,
    bbs.bbsName,
    realName,
    location,
    'COM0',
    '38400',
    '0',
    String(node),
    user.handle,
    String(user.level || 10),
    String(minutesLeft),
    ansiFlag,
  ].join('\r\n') + '\r\n';
}

function resolveTemplate(value, context) {
  return String(value)
    .replaceAll('%DROPDIR%', context.dropDir)
    .replaceAll('%DROPFILE%', context.dropPath)
    .replaceAll('%HANDLE%', context.handle)
    .replaceAll('%NODE%', String(context.node))
    .replaceAll('%BBSNAME%', context.bbsName)
    .replaceAll('%LEVEL%', String(context.level));
}

async function runExternal(bbs, door) {
  const term = bbs.term;
  if (!door.command) {
    term.write('\r\nThis door has no command configured.\r\n');
    await term.pressEnter();
    return;
  }

  const baseDir = path.join(bbs.config.doorsDir, 'tmp');
  const dropDir = path.join(baseDir, `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dropDir, { recursive: true, mode: 0o700 });

  const dropType = door.drop_file || 'DORINFO1.DEF';
  const dropPath = dropType === 'none' ? '' : path.join(dropDir, dropType);
  if (dropPath) fs.writeFileSync(dropPath, writeDropFile(dropDir, dropType, bbs), { mode: 0o600 });

  const context = {
    dropDir,
    dropPath,
    handle: bbs.user.handle,
    node: bbs.runtimeSession ? bbs.runtimeSession.node : 1,
    bbsName: bbs.bbsName,
    level: bbs.user.level,
  };

  let args = [];
  try {
    args = JSON.parse(door.args || '[]').map((arg) => resolveTemplate(arg, context));
  } catch {
    args = parseArgs(door.args).map((arg) => resolveTemplate(arg, context));
  }
  const command = resolveTemplate(door.command, context);

  term.write(`\r\nLaunching ${door.name}...\r\n\r\n`);

  let child;
  try {
    if (door.pty) {
      const line = [command, ...args].map(shellQuote).join(' ');
      child = spawn('/usr/bin/script', ['-qefc', line, '/dev/null'], {
        cwd: dropDir,
        env: {
          ...process.env,
          BBS_HANDLE: bbs.user.handle,
          BBS_LEVEL: String(bbs.user.level),
          BBS_NODE: String(context.node),
          BBS_DROPDIR: dropDir,
          BBS_DROPFILE: dropPath,
          TERM: 'ansi',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      child = spawn(command, args, {
        cwd: dropDir,
        env: {
          ...process.env,
          BBS_HANDLE: bbs.user.handle,
          BBS_LEVEL: String(bbs.user.level),
          BBS_NODE: String(context.node),
          BBS_DROPDIR: dropDir,
          BBS_DROPFILE: dropPath,
          TERM: 'ansi',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    await term.attachProcess(child, { timeoutMs: Math.max(30, Number(door.timeout_seconds) || 900) * 1000 });
  } catch (err) {
    term.write(`\r\n*** Could not start door: ${err.message} ***\r\n`);
  } finally {
    term.write('\r\n');
    try {
      fs.rmSync(dropDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  await term.pressEnter('\r\nDoor finished. Press ENTER to return.');
}

module.exports = {
  BUILTINS,
  listDoors,
  getDoor,
  createDoor,
  updateDoor,
  deleteDoor,
  parseArgs,
  writeDropFile,
  runExternal,
};
