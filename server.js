'use strict';

const path = require('node:path');
const db = require('./lib/db');
const auth = require('./lib/auth');
const runtime = require('./lib/runtime');
const { loadConfig } = require('./lib/config');
const { Terminal } = require('./lib/terminal');
const { startSession } = require('./lib/bbs');
const { createWebServer } = require('./lib/web');
const { startTelnetServer } = require('./transports/telnet');
const { startSshServer } = require('./transports/ssh');

const VERSION = require('./package.json').version;

async function main() {
  const config = loadConfig();
  if (process.argv.includes('--version')) {
    console.log(VERSION);
    return;
  }

  const dbFile = path.join(config.dataDir, 'bbs.db');
  db.initDb(dbFile);

  const users = db.getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (users === 0) {
    console.warn('[bbs] no accounts exist yet.');
    console.warn(`[bbs] create a sysop with: node scripts/create-sysop.js --config ${config.configPath}`);
  }

  const servers = [];
  const closers = [];
  let shuttingDown = false;

  // ── web terminal + HTTP ────────────────────────────────────────────────────
  const web = createWebServer({ config, logger: console });
  await new Promise((resolve, reject) => {
    web.server.once('error', reject);
    web.server.listen(config.webPort, config.host, () => {
      console.log(`[web] listening on http://${config.host}:${config.webPort}`);
      resolve();
    });
  });
  servers.push(web.server);
  closers.push(() => new Promise((resolve) => web.wss.close(() => resolve())));

  // ── telnet ────────────────────────────────────────────────────────────────
  const telnetByIp = new Map();
  if (config.telnetPort > 0) {
    const telnet = startTelnetServer({
      host: config.host,
      port: config.telnetPort,
      logger: console,
      onConnection: (transport) => {
        const ip = transport.remoteAddress;
        const count = (telnetByIp.get(ip) || 0) + 1;
        if (count > config.maxSessionsPerIp) {
          transport.write('\r\n*** Too many connections from your address. Try again later. ***\r\n');
          setTimeout(() => transport.end(), 300);
          return;
        }
        telnetByIp.set(ip, count);

        const term = new Terminal({
          write: (text) => transport.write(text),
          end: () => transport.end(),
          cols: transport.cols,
          rows: transport.rows,
          name: 'telnet',
          remoteAddress: ip,
          idleTimeoutMs: config.idleTimeoutMinutes * 60 * 1000,
        });
        transport.on('data', (data) => term.feed(data));
        transport.on('resize', (cols, rows) => term.resize(cols, rows));
        transport.on('close', () => {
          term.markClosed();
          const remaining = (telnetByIp.get(ip) || 1) - 1;
          if (remaining <= 0) telnetByIp.delete(ip);
          else telnetByIp.set(ip, remaining);
        });

        startSession(term, config, { transport: 'telnet', ip }).catch((err) => {
          console.error('[telnet] session failed:', err);
          term.end();
        });
      },
    });
    servers.push(telnet);
    closers.push(() => new Promise((resolve) => telnet.close(resolve)));
  }

  // ── ssh ────────────────────────────────────────────────────────────────────
  if (config.sshPort > 0) {
    const ssh = startSshServer({
      host: config.host,
      port: config.sshPort,
      hostKeyFile: config.sshHostKey,
      logger: console,
      authenticate: (handle, password) => auth.authenticate(handle, password, 'ssh'),
      onConnection: (transport, meta) => {
        const ip = meta.remoteAddress || transport.remoteAddress;
        const term = new Terminal({
          write: (text) => transport.write(text),
          end: () => transport.end(),
          cols: transport.cols,
          rows: transport.rows,
          name: 'ssh',
          remoteAddress: ip,
          idleTimeoutMs: config.idleTimeoutMinutes * 60 * 1000,
        });
        transport.on('data', (data) => term.feed(data));
        transport.on('resize', (cols, rows) => term.resize(cols, rows));
        transport.on('close', () => term.markClosed());

        startSession(term, config, { user: meta.user, transport: 'ssh', ip }).catch((err) => {
          console.error('[ssh] session failed:', err);
          term.end();
        });
      },
    });
    servers.push(ssh);
    closers.push(() => new Promise((resolve) => ssh.close(resolve)));
  }

  console.log(`[bbs] ${config.bbsName} v${VERSION}`);
  console.log(`[bbs] data: ${config.dataDir}`);
  console.log(`[bbs] public URL: ${config.publicUrl}`);
  console.log(`[bbs] telnet ${config.host}:${config.telnetPort} · ssh ${config.host}:${config.sshPort} · web ${config.host}:${config.webPort}`);

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[bbs] ${signal} received, shutting down`);
    runtime.shutdown();
    await Promise.allSettled(closers.map((close) => close()));
    for (const server of servers) {
      try {
        server.close();
      } catch {
        // ignore
      }
    }
    db.closeDb();
    setTimeout(() => process.exit(0), 200).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[bbs] fatal:', err);
  process.exit(1);
});
