'use strict';

const { EventEmitter } = require('node:events');

class WebSocketTransport extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.cols = 80;
    this.rows = 24;
    this.remoteAddress = '';
    this.closed = false;

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (message.t === 'i' && typeof message.d === 'string') {
        this.emit('data', message.d);
      } else if (message.t === 'r') {
        const cols = Math.max(40, Math.min(160, Number(message.c) || 80));
        const rows = Math.max(12, Math.min(80, Number(message.r) || 24));
        this.cols = cols;
        this.rows = rows;
        this.emit('resize', cols, rows);
      } else if (message.t === 'p') {
        this.writeRaw(JSON.stringify({ t: 'p' }));
      }
    });

    ws.on('close', () => {
      if (this.closed) return;
      this.closed = true;
      this.emit('close');
    });
    ws.on('error', () => {
      if (this.closed) return;
      this.closed = true;
      this.emit('close');
    });
  }

  writeRaw(payload) {
    if (this.closed || this.ws.readyState !== 1) return;
    try {
      this.ws.send(payload);
    } catch {
      // client went away
    }
  }

  write(text) {
    this.writeRaw(JSON.stringify({ t: 'o', d: String(text) }));
  }

  end() {
    if (this.closed) return;
    try {
      this.writeRaw(JSON.stringify({ t: 'c' }));
    } catch {
      // ignore
    }
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

module.exports = { WebSocketTransport };
