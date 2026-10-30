'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const OPT_ECHO = 1;
const OPT_SGA = 3;
const OPT_TTYPE = 24;
const OPT_NAWS = 31;

class TelnetTransport extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.cols = 80;
    this.rows = 24;
    this.remoteAddress = socket.remoteAddress || '';
    this.closed = false;
    this._state = 'data';
    this._sub = [];
    this._lastWasCR = false;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 60000);
    socket.on('data', (chunk) => this._receive(chunk));
    socket.on('close', () => {
      this.closed = true;
      this.emit('close');
    });
    socket.on('error', () => {
      this.closed = true;
      this.emit('close');
    });
    this._negotiate();
  }

  _sendRaw(buffer) {
    if (!this.closed) this.socket.write(buffer);
  }

  _negotiate() {
    // Ask the client to echo nothing, suppress go-ahead, and report window
    // size and terminal type.
    this._sendRaw(
      Buffer.from([
        IAC, WILL, OPT_ECHO,
        IAC, WILL, OPT_SGA,
        IAC, DO, OPT_NAWS,
        IAC, DO, OPT_TTYPE,
      ])
    );
  }

  _sendCommand(command, option) {
    this._sendRaw(Buffer.from([IAC, command, option]));
  }

  _handleOption(command, option) {
    if (command === WILL) {
      if (option === OPT_TTYPE) this._sendCommand(DO, option);
      else if (option === OPT_NAWS) this._sendCommand(DO, option);
      else this._sendCommand(DONT, option);
    } else if (command === DO) {
      if (option === OPT_NAWS || option === OPT_TTYPE || option === OPT_SGA || option === OPT_ECHO) {
        this._sendCommand(WILL, option);
      } else {
        this._sendCommand(WONT, option);
      }
    } else if (command === WONT) {
      // nothing to do
    } else if (command === DONT) {
      // nothing to do
    }
  }

  _handleSubnegotiation(payload) {
    if (payload.length >= 5 && payload[0] === OPT_NAWS) {
      const width = (payload[1] << 8) | payload[2];
      const height = (payload[3] << 8) | payload[4];
      if (width > 0 && height > 0) {
        this.cols = Math.max(40, Math.min(160, width));
        this.rows = Math.max(12, Math.min(80, height));
        this.emit('resize', this.cols, this.rows);
      }
    }
  }

  _receive(chunk) {
    const out = [];
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (this._state === 'iac') {
        if (byte === IAC) {
          out.push(0);
          this._state = 'data';
        } else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
          this._state = 'option';
          this._option = byte;
        } else if (byte === SB) {
          this._state = 'sub';
          this._sub = [];
        } else {
          this._state = 'data';
        }
        continue;
      }
      if (this._state === 'option') {
        this._handleOption(this._option, byte);
        this._state = 'data';
        continue;
      }
      if (this._state === 'sub') {
        if (byte === IAC) {
          this._state = 'sub-iac';
        } else {
          this._sub.push(byte);
        }
        continue;
      }
      if (this._state === 'sub-iac') {
        if (byte === SE) {
          this._handleSubnegotiation(this._sub);
          this._state = 'data';
          this._sub = [];
        } else if (byte === IAC) {
          this._sub.push(IAC);
          this._state = 'sub';
        } else {
          this._state = 'sub';
        }
        continue;
      }
      if (byte === IAC) {
        this._state = 'iac';
        continue;
      }
      if (byte === 0 && this._lastWasCR) {
        this._lastWasCR = false;
        continue;
      }
      this._lastWasCR = byte === 13;
      out.push(byte);
    }
    if (out.length) this.emit('data', Buffer.from(out).toString('utf8'));
  }

  write(text) {
    if (this.closed) return;
    // Escape 0xFF so payload bytes are not mistaken for telnet commands.
    const escaped = String(text).replace(/\xff/g, '\xff\xff');
    this.socket.write(escaped);
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.end();
    } catch {
      // ignore
    }
  }
}

function startTelnetServer({ host, port, onConnection, logger = console }) {
  const server = net.createServer((socket) => {
    const transport = new TelnetTransport(socket);
    logger.log(`[telnet] connection from ${transport.remoteAddress}`);
    onConnection(transport, { remoteAddress: transport.remoteAddress });
  });
  server.on('error', (err) => logger.error('[telnet] server error:', err.message));
  server.listen(port, host, () => logger.log(`[telnet] listening on ${host}:${port}`));
  return server;
}

module.exports = { startTelnetServer, TelnetTransport };
