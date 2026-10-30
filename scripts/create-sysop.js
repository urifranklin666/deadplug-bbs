'use strict';

const path = require('node:path');
const db = require('../lib/db');
const auth = require('../lib/auth');
const { loadConfig, parseArgs } = require('../lib/config');

function usage() {
  console.log(`Usage: node scripts/create-sysop.js [options]

  --config <file>     Path to config.json (default: ./config.json)
  --data-dir <dir>    Override the data directory
  --handle <name>     Sysop handle (default: sysop)
  --password <pass>   Password (default: generated and printed)
  --reset             Reset the password of an existing sysop
  --help              Show this help
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const config = loadConfig(process.argv.slice(2));
  const dbFile = path.join(config.dataDir, 'bbs.db');
  db.initDb(dbFile);

  const handle = String(args.handle || 'sysop').trim();
  const existing = auth.findUserByHandle(handle);
  const password = String(args.password || auth.generatePassword(12));

  if (existing) {
    if (!args.reset) {
      console.error(`User ${existing.handle} already exists. Use --reset to set a new password.`);
      process.exitCode = 1;
      return;
    }
    auth.setPassword(existing.id, password);
    db.getDb().prepare('UPDATE users SET level = 100, validated = 1, banned = 0 WHERE id = ?').run(existing.id);
    db.audit(existing.id, 'sysop-reset', 'via create-sysop script', '');
    console.log(`Reset sysop ${existing.handle}.`);
  } else {
    const user = auth.createUser({
      handle,
      password,
      realName: 'Board Sysop',
      location: 'The NOC',
      level: 100,
      validated: 1,
    });
    db.audit(user.id, 'sysop-create', 'via create-sysop script', '');
    console.log(`Created sysop ${user.handle}.`);
  }

  console.log('');
  console.log(`  Handle:   ${handle}`);
  console.log(`  Password: ${password}`);
  console.log('');
  console.log('Log in through telnet, SSH or the web terminal. The web admin panel is at /admin.');
  db.closeDb();
}

main();
