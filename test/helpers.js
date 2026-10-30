'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadplug-bbs-'));
  db.initDb(path.join(dir, 'bbs.db'));
  return {
    dir,
    cleanup() {
      db.closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { makeDb };
