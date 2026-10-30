'use strict';

const { visibleLength } = require('./ansi');

class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

class IdleTimeout extends Error {
  constructor() {
    super('idle timeout');
    this.name = 'IdleTimeout';
  }
}

class Disconnected extends Error {
  constructor() {
    super('disconnected');
    this.name = 'Disconnected';
  }
}

/**
 * Transport-agnostic terminal. Telnet, SSH and WebSocket transports all feed
 * bytes into one of these and receive output through the write callback.
 */
class Terminal {
  constructor({ write, end, cols = 80, rows = 24, name = 'node', remoteAddress = '', idleTimeoutMs = 15 * 60 * 1000 }) {
    this._writeFn = write;
    this._endFn = end || (() => {});
    this.cols = Math.max(40, Math.min(160, Number(cols) || 80));
    this.rows = Math.max(12, Math.min(80, Number(rows) || 24));
    this.name = name;
    this.remoteAddress = remoteAddress || '';
    this.idleTimeoutMs = idleTimeoutMs;
    this.lastActivity = Date.now();
    this.closed = false;
    this._input = '';
    this._waiter = null;
    this._escState = null;
    this._child = null;
    this._lastWasCR = false;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  write(text) {
    if (this.closed || text === undefined || text === null) return;
    this._writeFn(String(text));
  }

  writeLine(text = '') {
    this.write(`${text}\r\n`);
  }

  bell() {
    this.write('\x07');
  }

  clearScreen() {
    this.write('\x1b[2J\x1b[H');
  }

  resize(cols, rows) {
    this.cols = Math.max(40, Math.min(160, Number(cols) || this.cols));
    this.rows = Math.max(12, Math.min(80, Number(rows) || this.rows));
  }

  feed(chunk) {
    if (this.closed || !chunk) return;
    this.touch();
    if (this._child && this._child.stdin && this._child.stdin.writable) {
      this._child.stdin.write(chunk);
      return;
    }
    let text = String(chunk);
    if (this._lastWasCR && text.startsWith('\n')) text = text.slice(1);
    text = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    this._lastWasCR = text.endsWith('\r');
    this._input += text;
    this._wake();
  }

  _wake() {
    if (!this._waiter || !this._input) return;
    const waiter = this._waiter;
    this._waiter = null;
    const data = this._input;
    this._input = '';
    waiter(data);
  }

  _pushBack(chunk, index) {
    if (index < chunk.length) this._input = chunk.slice(index) + this._input;
  }

  _readChunk(timeoutMs) {
    if (this._input) {
      const data = this._input;
      this._input = '';
      return Promise.resolve(data);
    }
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this._waiter === waiter) this._waiter = null;
        resolve(null);
      }, timeoutMs);
      const waiter = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
      this._waiter = waiter;
    });
  }

  _nextChar(chunk, index) {
    const char = chunk[index];
    if (this._escState === 'csi') {
      const code = char.charCodeAt(0);
      if (code >= 0x40 && code <= 0x7e) this._escState = null;
      return { char: null, next: index + 1 };
    }
    if (this._escState === 'start') {
      this._escState = char === '[' || char === 'O' ? 'csi' : null;
      return { char: null, next: index + 1 };
    }
    if (char === '\x1b') {
      this._escState = 'start';
      return { char: null, next: index + 1 };
    }
    return { char, next: index + 1 };
  }

  _erase(count) {
    if (count > 0) this.write('\b \b'.repeat(count));
  }

  _redraw(prompt, buffer, mask) {
    this.write(`\r${prompt}${' '.repeat(Math.min(buffer.length + 2, this.cols - 1))}\r${prompt}`);
    if (buffer.length) this.write(mask ? '*'.repeat(buffer.length) : buffer);
  }

  _checkIdle() {
    if (Date.now() - this.lastActivity > this.idleTimeoutMs) throw new IdleTimeout();
  }

  /**
   * Read one line with basic editing. `onTick` runs once per second while
   * waiting and may return true after printing output, which triggers a
   * prompt redraw (used for live chat).
   */
  async readLine(options = {}) {
    const {
      prompt = '',
      mask = false,
      max = 200,
      min = 0,
      allowEmpty = true,
      onTick = null,
      tickMs = 1000,
      echoPrompt = true,
    } = options;
    if (echoPrompt) this.write(prompt);
    let buffer = '';
    while (true) {
      this._checkIdle();
      const chunk = await this._readChunk(Math.min(tickMs, 1000));
      if (this.closed) throw new Disconnected();
      if (chunk === null) {
        if (onTick && (await onTick()) === true) this._redraw(prompt, buffer, mask);
        continue;
      }
      let index = 0;
      while (index < chunk.length) {
        const { char, next } = this._nextChar(chunk, index);
        index = next;
        if (char === null) continue;
        if (char === '\r' || char === '\n') {
          if (buffer.length < min || (!allowEmpty && buffer.length === 0)) {
            this.bell();
            continue;
          }
          this.write('\r\n');
          this._pushBack(chunk, index);
          return buffer;
        }
        if (char === '\x03') {
          this.write('^C\r\n');
          throw new Cancelled();
        }
        if (char === '\x04') {
          if (!buffer) throw new Cancelled();
          continue;
        }
        if (char === '\x7f' || char === '\x08') {
          if (buffer.length) {
            buffer = buffer.slice(0, -1);
            this._erase(1);
          }
          continue;
        }
        if (char === '\x15') {
          this._erase(buffer.length);
          buffer = '';
          continue;
        }
        if (char < ' ') continue;
        if (buffer.length >= max) {
          this.bell();
          continue;
        }
        buffer += char;
        this.write(mask ? '*' : char);
      }
    }
  }

  async readKey(options = {}) {
    const { prompt = '', valid = null, echo = false } = options;
    if (prompt) this.write(prompt);
    while (true) {
      this._checkIdle();
      const chunk = await this._readChunk(1000);
      if (this.closed) throw new Disconnected();
      if (chunk === null) continue;
      let index = 0;
      while (index < chunk.length) {
        const { char, next } = this._nextChar(chunk, index);
        index = next;
        if (char === null) continue;
        if (char === '\x03') {
          this.write('^C\r\n');
          throw new Cancelled();
        }
        const lower = char.toLowerCase();
        if (valid && !valid.includes(lower) && char !== '\r' && char !== '\n') {
          this.bell();
          continue;
        }
        if (echo) this.write(char === '\r' || char === '\n' ? '\r\n' : char);
        this._pushBack(chunk, index);
        return char === '\n' ? '\r' : lower;
      }
    }
  }

  async pressEnter(prompt = '\r\nPress ENTER to continue...') {
    this.write(prompt);
    await this.readKey({});
  }

  async more(lines, options = {}) {
    const pageSize = Math.max(5, this.rows - 4);
    const list = Array.isArray(lines) ? lines : String(lines).split('\r\n');
    if (list.length <= pageSize) {
      this.write(list.join('\r\n') + '\r\n');
      return true;
    }
    for (let i = 0; i < list.length; i += pageSize) {
      this.write(list.slice(i, i + pageSize).join('\r\n') + '\r\n');
      if (i + pageSize < list.length) {
        const key = await this.readKey({ prompt: '\x1b[7m -- More -- \x1b[0m (ENTER=next, Q=quit) ', valid: 'q\r' });
        if (key === 'q') return false;
      }
    }
    return true;
  }

  /**
   * Hand the terminal to a child process (an external door). Input is piped
   * straight to the process and its output is written back verbatim until it
   * exits or the timeout fires.
   */
  attachProcess(child, { timeoutMs = 0 } = {}) {
    this._child = child;
    let timer = null;
    const forward = (data) => {
      if (this.closed) return;
      const text = String(data).replace(/\r?\n/g, '\r\n');
      this._writeFn(text);
    };
    if (child.stdout) child.stdout.on('data', forward);
    if (child.stderr) child.stderr.on('data', forward);
    return new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        this._child = null;
        resolve(result);
      };
      child.on('error', (err) => {
        this.write(`\r\n*** Door error: ${err.message} ***\r\n`);
        finish({ code: -1, timedOut: false });
      });
      child.on('close', (code) => finish({ code, timedOut: false }));
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.write('\r\n*** Door time limit reached. Terminating. ***\r\n');
          try {
            child.kill('SIGTERM');
          } catch {
            // ignore
          }
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore
            }
          }, 3000);
          finish({ code: null, timedOut: true });
        }, timeoutMs);
      }
    });
  }

  markClosed() {
    if (this.closed) return;
    this.closed = true;
    if (this._waiter) {
      const waiter = this._waiter;
      this._waiter = null;
      waiter(null);
    }
    if (this._child) {
      try {
        this._child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  }

  end() {
    this.markClosed();
    try {
      this._endFn();
    } catch {
      // ignore
    }
  }
}

module.exports = { Terminal, Cancelled, IdleTimeout, Disconnected };
