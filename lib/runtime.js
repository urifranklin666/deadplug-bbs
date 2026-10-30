'use strict';

const crypto = require('node:crypto');

const sessions = new Map();
const byUser = new Map();

function allocateNode() {
  const used = new Set([...sessions.values()].map((session) => session.node));
  for (let node = 1; node <= 999; node++) {
    if (!used.has(node)) return node;
  }
  return 0;
}

function register({ userId, handle, level, terminal, ip = '', transport = 'unknown' }) {
  const id = crypto.randomBytes(9).toString('base64url');
  const session = {
    id,
    userId: userId || 0,
    handle: handle || 'Guest',
    level: level || 0,
    node: allocateNode(),
    transport,
    ip,
    terminal,
    connectedAt: Date.now(),
    state: 'Connecting',
    chat: false,
    chatQueue: [],
    pending: [],
  };
  sessions.set(id, session);
  if (userId) byUser.set(userId, session);
  return session;
}

function unregister(session) {
  if (!session) return;
  sessions.delete(session.id);
  if (session.userId && byUser.get(session.userId) === session) byUser.delete(session.userId);
}

function get(sessionId) {
  return sessions.get(sessionId) || null;
}

function forUser(userId) {
  return byUser.get(Number(userId)) || null;
}

function count() {
  return sessions.size;
}

function countIp(ip) {
  if (!ip) return 0;
  let total = 0;
  for (const session of sessions.values()) if (session.ip === ip) total += 1;
  return total;
}

function list() {
  return [...sessions.values()]
    .sort((a, b) => a.node - b.node)
    .map((session) => ({
      node: session.node,
      handle: session.handle,
      level: session.level,
      state: session.state,
      transport: session.transport,
      connectedAt: session.connectedAt,
      idleSeconds: Math.max(0, Math.floor((Date.now() - session.terminal.lastActivity) / 1000)),
    }));
}

function setState(session, state) {
  if (session) session.state = state;
}

function notify(session, text) {
  if (!session || !session.terminal || session.terminal.closed) return;
  session.pending.push(text);
}

function notifyUser(userId, text) {
  notify(forUser(userId), text);
}

function broadcast(text, { excludeUserId = null } = {}) {
  for (const session of sessions.values()) {
    if (excludeUserId && session.userId === excludeUserId) continue;
    notify(session, text);
  }
}

function drain(session) {
  if (!session || session.pending.length === 0) return [];
  const lines = session.pending;
  session.pending = [];
  return lines;
}

function joinChat(session) {
  if (session) session.chat = true;
}

function leaveChat(session) {
  if (session) {
    session.chat = false;
    session.chatQueue = [];
  }
}

function chatSubscribers() {
  return [...sessions.values()].filter((session) => session.chat && !session.terminal.closed);
}

/** Queue a chat line for everyone in the room. Returns the delivery count. */
function chatBroadcast(line, { excludeSessionId = null } = {}) {
  let delivered = 0;
  for (const session of chatSubscribers()) {
    if (excludeSessionId && session.id === excludeSessionId) continue;
    session.chatQueue.push(line);
    delivered += 1;
  }
  return delivered;
}

function drainChat(session) {
  if (!session || session.chatQueue.length === 0) return [];
  const lines = session.chatQueue;
  session.chatQueue = [];
  return lines;
}

function disconnectUser(userId, reason = 'Disconnected by the sysop.') {
  const session = forUser(userId);
  if (!session) return false;
  session.terminal.write(`\r\n\r\n*** ${reason} ***\r\n`);
  setTimeout(() => session.terminal.end(), 250);
  return true;
}

function shutdown(reason = 'The board is shutting down. Please call back shortly.') {
  for (const session of sessions.values()) {
    try {
      session.terminal.write(`\r\n\r\n*** ${reason} ***\r\n`);
      session.terminal.end();
    } catch {
      // ignore
    }
  }
  sessions.clear();
  byUser.clear();
}

module.exports = {
  register,
  unregister,
  get,
  forUser,
  count,
  countIp,
  list,
  setState,
  notify,
  notifyUser,
  broadcast,
  drain,
  joinChat,
  leaveChat,
  chatSubscribers,
  chatBroadcast,
  drainChat,
  disconnectUser,
  shutdown,
};
