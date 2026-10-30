'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Server } = require('ssh2');

class SshTransport extends EventEmitter {
  constructor(stream, { cols = 80, rows = 24, remoteAddress = '' } = {}) {
    super();
    this.stream = stream;
    this.cols = cols;
    this.rows = rows;
    this.remoteAddress = remoteAddress;
    this.closed = false;
    stream.on('data', (data) => this.emit('data', data.toString('utf8')));
    stream.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      this.emit('close');
    });
    stream.on('error', () => {
      if (this.closed) return;
      this.closed = true;
      this.emit('close');
    });
  }

  write(text) {
    if (!this.closed) this.stream.write(String(text));
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stream.exit(0);
      this.stream.end();
    } catch {
      // ignore
    }
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.emit('resize', cols, rows);
  }
}

function loadOrCreateHostKey(filename) {
  if (fs.existsSync(filename)) return fs.readFileSync(filename);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  fs.writeFileSync(filename, privateKey, { mode: 0o600 });
  return privateKey;
}

function startSshServer({ host, port, hostKeyFile, authenticate, onConnection, logger = console }) {
  const hostKey = loadOrCreateHostKey(hostKeyFile);
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    const remoteAddress = client._sock ? client._sock.remoteAddress : '';
    let user = null;
    let attempts = 0;

    client.on('authentication', (ctx) => {
      if (attempts >= 6) {
        ctx.reject(['password', 'keyboard-interactive']);
        setTimeout(() => client.end(), 500);
        return;
      }
      attempts += 1;

      const finish = (password) => {
        const result = authenticate(ctx.username, password);
        if (result.user) {
          user = result.user;
          client._bbsUser = result.user;
          ctx.accept();
        } else {
          ctx.reject(['password', 'keyboard-interactive']);
        }
      };

      if (ctx.method === 'password') {
        finish(ctx.password);
      } else if (ctx.method === 'keyboard-interactive') {
        ctx.prompt([{ prompt: 'Password: ', echo: false }], (answers) => {
          finish((answers && answers[0]) || '');
        });
      } else if (ctx.method === 'none') {
        ctx.reject(['password', 'keyboard-interactive'], false);
      } else {
        ctx.reject(['password', 'keyboard-interactive'], false);
      }
    });

    client.on('ready', () => {
      logger.log(`[ssh] ${user.handle} connected from ${remoteAddress}`);
      client.on('session', (accept) => {
        const session = accept();
        let cols = 80;
        let rows = 24;
        let transport = null;
        session.on('pty', (acceptPty, rejectPty, info) => {
          cols = Math.max(40, Math.min(160, info.cols || 80));
          rows = Math.max(12, Math.min(80, info.rows || 24));
          acceptPty();
        });
        session.on('window-change', (acceptChange, rejectChange, info) => {
          cols = Math.max(40, Math.min(160, info.cols || cols));
          rows = Math.max(12, Math.min(80, info.rows || rows));
          if (transport) transport.resize(cols, rows);
          if (acceptChange) acceptChange();
        });
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          transport = new SshTransport(stream, { cols, rows, remoteAddress });
          onConnection(transport, { user, remoteAddress });
        });
        session.on('exec', (_acceptExec, rejectExec) => {
          if (rejectExec) rejectExec();
        });
      });
    });

    client.on('error', () => {
      // connection-level errors are not interesting beyond the log
    });
  });

  server.on('error', (err) => logger.error('[ssh] server error:', err.message));
  server.listen(port, host, () => logger.log(`[ssh] listening on ${host}:${port}`));
  return server;
}

module.exports = { startSshServer, loadOrCreateHostKey, SshTransport };
