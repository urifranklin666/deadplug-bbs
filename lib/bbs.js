'use strict';

const ansi = require('./ansi');
const art = require('./art');
const auth = require('./auth');
const boards = require('./boards');
const mail = require('./mail');
const files = require('./files');
const chat = require('./chat');
const doors = require('./doors');
const runtime = require('./runtime');
const db = require('./db');
const { Cancelled, IdleTimeout, Disconnected } = require('./terminal');

const TITLE_LEVELS = [
  [100, 'Sysop'],
  [90, 'Co-Sysop'],
  [50, 'Veteran'],
  [10, 'User'],
  [0, 'Guest'],
];

const BOARD_PAGE = 15;
const MAIL_PAGE = 15;
const FILE_PAGE = 12;

function titleFor(level) {
  for (const [min, title] of TITLE_LEVELS) if (level >= min) return title;
  return 'User';
}

function letterSpace(text) {
  return text.split('').join(' ');
}

class BbsSession {
  constructor(term, config, { user = null, transport = 'telnet', ip = '' } = {}) {
    this.term = term;
    this.config = config;
    this.user = user;
    this.transport = transport;
    this.ip = ip;
    this.runtimeSession = null;
    this.settings = db.getSettings();
    this.bbsName = this.settings.bbs_name || config.bbsName;
    this.ansi = user ? Boolean(user.ansi) : true;
    this.width = Math.min(80, Math.max(50, term.cols - 2));
    this.shuttingDown = false;
    this.greetz = art.pickGreetz();
    this.introShown = false;
  }

  // ── output helpers ─────────────────────────────────────────────────────────
  write(text) {
    this.term.write(this.ansi ? text : ansi.stripAnsi(text));
  }

  line(text = '') {
    this.write(`${text}\r\n`);
  }

  clear() {
    if (this.ansi) this.term.clearScreen();
    else this.term.write('\r\n');
  }

  rule(char = '─', width = this.width) {
    return char === '─' ? art.rule(width) : ansi.paint(char.repeat(width), ansi.color.blue);
  }

  heading(title, extra = '', options = {}) {
    this.line(art.heading(title, extra, this.width, options));
  }

  // Prompts go straight to the terminal, so strip colour when ANSI is off.
  prompt(text) {
    return this.ansi ? text : ansi.stripAnsi(text);
  }

  async ask(prompt, options = {}) {
    const text = await this.term.readLine({ prompt: this.prompt(prompt), ...options });
    return ansi.sanitize(text, options.max || 200);
  }

  async key(prompt, valid) {
    return this.term.readKey({ prompt: this.prompt(prompt), valid });
  }

  async pressEnter(prompt = '\r\n\x1b[90m[\x1b[0m \x1b[1;97mENTER\x1b[0m \x1b[90m]\x1b[0m ') {
    await this.term.pressEnter(this.prompt(prompt));
  }

  async pause(lines, options = {}) {
    return this.term.more(lines, options);
  }

  refreshUser() {
    if (!this.user || !this.user.id) return;
    const fresh = auth.findUserById(this.user.id);
    if (fresh) this.user = fresh;
  }

  changeCredits(delta) {
    if (!this.user || !this.user.id) return this.user ? this.user.credits : 0;
    const amount = Number(delta) || 0;
    db.getDb().prepare('UPDATE users SET credits = MAX(0, credits + ?) WHERE id = ?').run(amount, this.user.id);
    this.refreshUser();
    return this.user.credits;
  }

  unreadMail() {
    return this.user && this.user.id ? mail.unreadCount(this.user.id) : 0;
  }

  get isGuest() {
    return !this.user || !this.user.id;
  }

  get isSysop() {
    return Boolean(this.user && this.user.level >= 100);
  }

  get isOnlineUser() {
    return Boolean(this.runtimeSession && this.runtimeSession.userId);
  }

  updateState(state) {
    if (this.runtimeSession) runtime.setState(this.runtimeSession, state);
  }

  async drainNotifications() {
    if (!this.runtimeSession) return;
    for (const text of runtime.drain(this.runtimeSession)) {
      const lines = String(text).split('\n');
      for (const line of lines) this.line(ansi.paint(`*** ${line} ***`, ansi.color.brightYellow));
    }
    this.settings = db.getSettings();
    this.bbsName = this.settings.bbs_name || this.config.bbsName;
  }

  // ── session lifecycle ──────────────────────────────────────────────────────
  async run() {
    try {
      if (!this.user) {
        this.user = await this.login();
        if (!this.user) return;
      }
      this.ansi = Boolean(this.user.ansi);
      await this.startOnline();
      await this.welcomeBack();
      await this.mainMenu();
    } catch (err) {
      if (err instanceof IdleTimeout) {
        this.write('\r\n\r\nYou have been idle too long. Goodbye.\r\n');
      } else if (err instanceof Disconnected) {
        // transport went away; nothing to say
      } else if (err instanceof Cancelled) {
        this.write('\r\nGoodbye.\r\n');
      } else {
        console.error('[bbs] session error:', err);
        try {
          this.write(`\r\n\r\n*** Internal error: ${err.message} ***\r\n`);
        } catch {
          // ignore
        }
      }
    } finally {
      if (this.runtimeSession) {
        runtime.leaveChat(this.runtimeSession);
        runtime.unregister(this.runtimeSession);
      }
      this.term.end();
    }
  }

  async startOnline() {
    this.runtimeSession = runtime.register({
      userId: this.user.id,
      handle: this.user.handle,
      level: this.user.level,
      terminal: this.term,
      ip: this.ip,
      transport: this.transport,
    });
    this.updateState('Main Menu');
  }

  async welcomeBack() {
    this.clear();
    this.showBanner();
    this.line();
    this.line(ansi.paint('  \u2591\u2592\u2593\u2588[ A C C E S S   G R A N T E D ]\u2588\u2593\u2592\u2591', ansi.color.bold + ansi.color.brightGreen));
    this.line();
    this.line(
      `  ${ansi.paint(this.user.handle, ansi.color.bold + ansi.color.brightYellow)}` +
        ansi.paint(` · ${titleFor(this.user.level)}`, ansi.color.brightWhite)
    );
    if (this.user.last_login_at) {
      this.line(ansi.paint(`  last login ${ansi.formatDate(this.user.last_login_at)} from ${this.user.last_ip || 'unknown'}`, ansi.color.gray));
    }
    const unread = this.unreadMail();
    if (unread) this.line(ansi.paint(`  >> ${unread} unread private message${unread === 1 ? '' : 's'} waiting`, ansi.color.brightYellow));
    this.line();
    const motd = (this.settings.motd || '').trim();
    if (motd) {
      this.line(ansi.paint('  \u00b7: \u00b7: \u00b7: motd :\u00b7 :\u00b7 :\u00b7', ansi.color.blue));
      for (const line of ansi.wrap(motd, this.width - 4)) this.line(`  ${line}`);
      this.line();
    }
    this.line(
      ansi.paint(
        `  node ${String(this.runtimeSession ? this.runtimeSession.node : 1).padStart(2, '0')} \u00b7 ` +
          `${runtime.count()} online \u00b7 ${this.settings.max_users || '\u221e'} max \u00b7 ` +
          new Date().toLocaleString('en-US', { hour12: false }),
        ansi.color.gray
      )
    );
    await this.pressEnter();
  }

  showBanner() {
    const stats = `${runtime.count()} online \u00b7 node ${String(this.runtimeSession ? this.runtimeSession.node : 1).padStart(2, '0')} \u00b7 ${new Date().getFullYear()}`;
    const lines = art.banner({
      name: this.bbsName,
      tagline: this.settings.tagline || '',
      stats,
      width: this.width,
      plain: !this.ansi,
    });
    for (const line of lines) this.line(line);
  }

  async showSplash() {
    const node = this.runtimeSession ? this.runtimeSession.node : 1;
    const lines = art.splash({
      name: this.bbsName,
      tagline: this.settings.tagline || '',
      ad: 'est. 1993 \u00b7 no ratio, just text \u00b7 keep the scene alive',
      greetz: art.greetz(this.greetz),
      stats: `${runtime.count()} online \u00b7 node ${String(node).padStart(2, '0')} \u00b7 ${new Date().getFullYear()}`,
      width: this.width,
      plain: !this.ansi,
    });
    for (const line of lines) this.line(line);
    this.line();
    await this.pressEnter('\r\n  \x1b[90m[\x1b[0m \x1b[1;97mPRESS ENTER TO JACK IN\x1b[0m \x1b[90m]\x1b[0m ');
  }

  // ── login and registration ────────────────────────────────────────────────
  async login() {
    this.clear();
    // The splash doubles as the board ad, so it stands in for the banner on the
    // first visit; later prompts (bad password, cancelled registration) are quiet.
    const intro = !this.introShown;
    this.introShown = true;
    if (intro && this.settings.splash_enabled === '1') {
      await this.showSplash();
      this.clear();
      this.line(ansi.paint(`  ${this.bbsName} \u00b7 ${this.settings.tagline || 'no carrier, no problem'}`, ansi.color.brightCyan));
      this.line();
    } else {
      this.showBanner();
      this.line();
      this.line(art.greetz(this.greetz));
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const handleInput = (
        await this.ask(
          '  \x1b[1;93mHandle\x1b[0m \x1b[90m[NEW to register \u00b7 GUEST to browse \u00b7 Q to quit]\x1b[0m: ',
          { max: 20 }
        )
      ).trim();
      if (!handleInput) continue;
      if (/^q(uit)?$/i.test(handleInput)) {
        this.line('\r\n  Goodbye.');
        return null;
      }
      if (/^new$/i.test(handleInput)) {
        const created = await this.register();
        if (created) return created;
        continue;
      }
      if (/^guest$/i.test(handleInput)) {
        if (this.settings.guest_enabled !== '1') {
          this.line(ansi.paint('\r\n  Guest access is disabled.\r\n', ansi.color.brightRed));
          continue;
        }
        return this.guestUser();
      }

      const password = await this.ask('  Password: ', { mask: true, max: 128 });
      const result = auth.authenticate(handleInput, password, this.ip);
      if (result.user) return result.user;
      if (result.error === 'banned') {
        this.line(ansi.paint('\r\n  This account is banned.\r\n', ansi.color.brightRed));
      } else if (result.error === 'unvalidated') {
        this.line(ansi.paint('\r\n  This account is awaiting sysop validation.\r\n', ansi.color.brightYellow));
      } else {
        this.line(ansi.paint(`\r\n  Invalid handle or password. Attempt ${attempt} of 3.\r\n`, ansi.color.brightRed));
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    this.line(ansi.paint('\r\n  Too many failed attempts. Goodbye.\r\n', ansi.color.brightRed));
    return null;
  }

  guestUser() {
    const node = runtime.count() + 1;
    return {
      id: 0,
      handle: `Guest${node}`,
      real_name: '',
      location: '',
      email: '',
      level: 0,
      validated: 1,
      banned: 0,
      credits: 0,
      posts: 0,
      uploads: 0,
      downloads: 0,
      ansi: 1,
      created_at: new Date().toISOString(),
      last_login_at: null,
      last_ip: this.ip,
      guest: true,
    };
  }

  async register() {
    if (this.settings.registration_open !== '1') {
      this.line(ansi.paint('\r\n  Registration is currently closed.\r\n', ansi.color.brightRed));
      return null;
    }
    this.line();
    this.heading('NEW USER REGISTRATION', 'apply for access');
    const handle = (await this.ask('  \x1b[1;93mHandle\x1b[0m \x1b[90m(2-20 chars)\x1b[0m: ', { max: 20 })).trim();
    const handleError = auth.validateHandle(handle);
    if (handleError) {
      this.line(ansi.paint(`  ${handleError}`, ansi.color.brightRed));
      return null;
    }
    if (auth.findUserByHandle(handle)) {
      this.line(ansi.paint('  That handle is already taken.', ansi.color.brightRed));
      return null;
    }

    const minLength = Math.max(4, Number(this.settings.min_password_length) || 6);
    const password = await this.ask(`  Password (min ${minLength} chars): `, { mask: true, max: 128, min: minLength });
    const confirm = await this.ask('  Repeat password: ', { mask: true, max: 128, min: minLength });
    if (password !== confirm) {
      this.line(ansi.paint('  Passwords do not match.', ansi.color.brightRed));
      return null;
    }

    const realName = (await this.ask('  Real name (optional): ', { max: 60 })).trim();
    const location = (await this.ask('  Location (optional): ', { max: 60 })).trim();
    const email = (await this.ask('  Email (optional): ', { max: 120 })).trim();
    const ansiAnswer = await this.key('  ANSI colour? [Y/n]: ', 'yn\r');
    const useAnsi = ansiAnswer !== 'n';

    try {
      const requiresValidation = this.settings.new_user_validation === '1';
      const user = auth.createUser({
        handle,
        password,
        realName,
        location,
        email,
        ansi: useAnsi ? 1 : 0,
        level: 10,
        validated: requiresValidation ? 0 : 1,
        ip: this.ip,
      });
      db.audit(user.id, 'register', `handle=${user.handle}`, this.ip);
      this.ansi = useAnsi;
      this.line();
      this.line(ansi.paint(`  Account ${user.handle} created.`, ansi.color.bold + ansi.color.brightGreen));
      if (requiresValidation) {
        this.line(ansi.paint('  The sysop must validate your account before you can log in.', ansi.color.brightYellow));
        await this.pressEnter();
        return null;
      }
      this.line('  Welcome to the board.');
      await this.pressEnter();
      return user;
    } catch (err) {
      this.line(ansi.paint(`  ${err.message}`, ansi.color.brightRed));
      return null;
    }
  }

  // ── main menu ──────────────────────────────────────────────────────────────
  mainMenuItems() {
    const items = [
      ['B', 'Message Boards', `${this.boardCountLabel()}`],
      ['M', 'Private Mail', this.isGuest ? 'guests cannot send mail' : `${this.unreadMail()} unread`],
      ['F', 'Files', 'upload / download'],
      ['C', 'Chat Room', 'live conversation'],
      ['O', 'One-liners', 'the wall'],
      ['G', 'Door Games', 'blackjack, trivia, dungeon'],
      ['W', "Who's Online", `${runtime.count()} connected`],
      ['U', 'User List', ''],
      ['S', 'Settings', 'profile and password'],
    ];
    if (this.isSysop) items.push(['A', 'Sysop Console', '']);
    return items;
  }

  boardCountLabel() {
    const list = boards.listBoards(this.user.level);
    const total = list.reduce((sum, board) => sum + board.posts, 0);
    return `${total} messages`;
  }

  async mainMenu() {
    let first = true;
    while (!this.shuttingDown) {
      await this.drainNotifications();
      this.clear();
      // The splash belongs to the login screen; repeating it above every menu
      // redraw pushes the actual menu off a 24-row terminal.
      if (first && this.term.rows >= 30) {
        this.showBanner();
        this.line();
      }
      first = false;
      const online = this.runtimeSession ? this.runtimeSession.node : 1;
      this.line();
      this.line(
        `  ${ansi.paint(this.user.handle, ansi.color.bold + ansi.color.brightYellow)}` +
          ansi.paint(' \u00b7 ', ansi.color.gray) +
          ansi.paint(titleFor(this.user.level), ansi.color.brightWhite) +
          ansi.paint(' \u00b7 ', ansi.color.gray) +
          ansi.paint(`${this.user.credits} credits`, ansi.color.brightCyan) +
          ansi.paint(` \u00b7 node ${String(online).padStart(2, '0')}`, ansi.color.gray)
      );
      const unread = this.unreadMail();
      if (unread) this.line(ansi.paint(`  >> ${unread} unread message${unread === 1 ? '' : 's'} waiting`, ansi.color.brightYellow));
      this.heading('MAIN MENU', `${runtime.count()} online`);
      for (const [key, label, extra] of this.mainMenuItems()) {
        this.line(art.menuRow(key, label, extra, this.width));
      }
      this.line(this.rule());
      this.line(art.menuRow('Q', 'Log Off', '', this.width));
      this.line();
      this.line(art.greetz(this.greetz));
      this.line();

      let choice;
      try {
        choice = await this.key('  \x1b[1;92mCommand\x1b[0m \x1b[90m>\x1b[0m ', 'bmfcogwusaq');
      } catch (err) {
        if (err instanceof Cancelled) continue;
        throw err;
      }

      try {
        switch (choice) {
          case 'b':
            await this.boardMenu();
            break;
          case 'm':
            await this.mailMenu();
            break;
          case 'f':
            await this.fileMenu();
            break;
          case 'c':
            await this.chatRoom();
            break;
          case 'o':
            await this.oneLinerMenu();
            break;
          case 'g':
            await this.gameMenu();
            break;
          case 'w':
            await this.whoMenu();
            break;
          case 'u':
            await this.userList();
            break;
          case 's':
            await this.settingsMenu();
            break;
          case 'a':
            if (this.isSysop) await this.sysopMenu();
            break;
          case 'q':
            await this.logoff();
            return;
          default:
            break;
        }
      } catch (err) {
        if (err instanceof Cancelled) continue;
        throw err;
      } finally {
        this.updateState('Main Menu');
      }
    }
  }

  async logoff() {
    this.clear();
    this.line();
    this.line(ansi.paint(`  later, ${this.user.handle}.`, ansi.color.bold + ansi.color.brightCyan));
    this.line(ansi.paint('  the board will be here when you need it.', ansi.color.gray));
    this.line();
    for (const line of art.carrierLost(this.width)) this.line(line);
    this.line();
    this.line(ansi.paint(`  ${this.bbsName} \u00b7 73`, ansi.color.gray));
    this.line();
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  // ── message boards ────────────────────────────────────────────────────────
  async boardMenu() {
    while (true) {
      this.clear();
      const list = boards.listBoards(this.user.level);
      this.heading('MESSAGE BOARDS', `${list.length} boards`);
      this.line(this.rule());
      if (!list.length) {
        this.line('  No boards are available.');
        await this.pressEnter();
        return;
      }
      list.forEach((board, index) => {
        const palette = art.boardPalette(board.id);
        const suffix = board.read_only ? ansi.paint(' [read-only]', ansi.color.gray) : '';
        this.line(
          `  ${ansi.paint(String(index + 1).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ` +
            ansi.paint(board.name, ansi.color.bold + palette.accent) +
            suffix
        );
        this.line(
          `     ${ansi.paint(`${board.description} \u00b7 ${board.posts} messages`, ansi.color.gray)}`
        );
      });
      this.line(this.rule());
      const choice = await this.key('  \x1b[1;93mBoard\x1b[0m \x1b[90m# (S=search, Q=back)\x1b[0m> ', '0123456789sq');
      if (choice === 'q' || choice === '\r') return;
      if (choice === 's') {
        await this.searchPosts();
        continue;
      }
      const index = Number(choice) - 1;
      if (index < 0 || index >= list.length) continue;
      await this.boardView(list[index]);
    }
  }

  async searchPosts() {
    const query = (await this.ask('  Search for: ', { max: 60 })).trim();
    if (!query) return;
    const rows = boards.search(query);
    this.clear();
    this.heading('SEARCH RESULTS', `"${query}"`);
    this.line(this.rule());
    if (!rows.length) {
      this.line('  Nothing found.');
    } else {
      const lines = rows.map((row) => {
        const palette = art.boardPalette(row.board_id);
        return (
          `  ${ansi.paint(`#${row.id}`, ansi.color.bold + ansi.color.brightYellow)} ` +
          ansi.truncate(row.subject, 44) +
          ansi.paint(`  ${row.board}`, palette.accent) +
          ansi.paint(` \u00b7 ${row.handle} \u00b7 ${ansi.formatDate(row.created_at)}`, ansi.color.gray)
        );
      });
      await this.pause(lines);
    }
    await this.pressEnter();
  }

  async boardView(board) {
    let page = 0;
    while (true) {
      this.clear();
      const { rows, total } = boards.listThreads(board.id, { limit: BOARD_PAGE, offset: page * BOARD_PAGE });
      const pages = Math.max(1, Math.ceil(total / BOARD_PAGE));
      this.heading(board.name, `page ${page + 1}/${pages}`, { upper: false, palette: art.boardPalette(board.id) });
      this.line(this.rule());
      if (!rows.length) {
        this.line('  No messages yet. Be the first to post.');
      } else {
        rows.forEach((thread, index) => {
          const number = page * BOARD_PAGE + index + 1;
          this.line(
            `  ${ansi.paint(String(number).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ` +
              ansi.truncate(thread.subject, 46) +
              (thread.locked ? ansi.paint(' [locked]', ansi.color.yellow) : '')
          );
          const last = thread.last_reply_at || thread.created_at;
          this.line(
            ansi.paint(`     by ${thread.handle} \u00b7 ${thread.replies} repl${thread.replies === 1 ? 'y' : 'ies'} \u00b7 ${ansi.formatDate(last)}`, ansi.color.gray)
          );
        });
      }
      this.line(this.rule());
      this.line(ansi.paint('  [#] Read  [P] Post  [N]ext  [B]ack  [R]efresh  [Q]uit', ansi.color.gray));
      const choice = await this.key('  \x1b[1;93mBoard\x1b[0m \x1b[90m>\x1b[0m ', '0123456789pnbrqs');
      if (choice === 'q') return;
      if (choice === 'n') {
        if (page + 1 < pages) page += 1;
        continue;
      }
      if (choice === 'b') {
        if (page > 0) page -= 1;
        continue;
      }
      if (choice === 'p') {
        await this.composePost(board, null);
        continue;
      }
      if (choice === 'r') continue;
      if (choice === 's') {
        await this.searchPosts();
        continue;
      }
      const threadNumber = Number(choice);
      if (!Number.isInteger(threadNumber) || threadNumber < 1) continue;
      const globalIndex = threadNumber - 1;
      if (globalIndex >= page * BOARD_PAGE && globalIndex < (page + 1) * BOARD_PAGE) {
        const thread = rows[globalIndex - page * BOARD_PAGE];
        if (thread) await this.threadView(board, thread.id);
      }
    }
  }

  async threadView(board, rootId) {
    while (true) {
      const thread = boards.getThread(rootId);
      if (!thread) return;
      this.clear();
      this.heading(thread.root.subject, `by ${thread.root.handle}`, {
        upper: false,
        palette: art.boardPalette(board.id),
      });
      this.line(this.rule());
      const lines = [];
      for (const post of [thread.root, ...thread.replies]) {
        lines.push(
          `  ${ansi.paint(post.handle, ansi.color.bold + ansi.color.brightYellow)}  ` +
            ansi.paint(ansi.formatDate(post.created_at), ansi.color.gray)
        );
        for (const line of ansi.renderBody(post.body, this.width - 4)) lines.push(`  ${line}`);
        lines.push('');
      }
      const completed = await this.pause(lines);
      this.line(this.rule());
      if (!completed) {
        return;
      }
      this.line(ansi.paint('  [R]eply  [N]ew post  [Q]uit', ansi.color.gray));
      const choice = await this.key('  \x1b[1;93mThread\x1b[0m \x1b[90m>\x1b[0m ', 'rnq');
      if (choice === 'q') return;
      if (choice === 'r') {
        if (thread.root.locked && !this.isSysop) {
          this.line(ansi.paint('  This thread is locked.', ansi.color.brightYellow));
          await this.pressEnter();
          continue;
        }
        await this.composePost(board, rootId);
      } else if (choice === 'n') {
        await this.composePost(board, null);
        return;
      }
    }
  }

  async composePost(board, parentId) {
    try {
      this.line();
      const subject = parentId ? '' : (await this.ask('  Subject: ', { max: boards.MAX_SUBJECT, min: 1 })).trim();
      this.line('  Enter your message. End with a single "." on its own line.');
      const body = await this.composeBody();
      if (!body) {
        this.line(ansi.paint('  Empty message discarded.', ansi.color.brightYellow));
        await this.pressEnter();
        return;
      }
      const post = boards.createPost({
        boardId: board.id,
        userId: this.user.id,
        subject,
        body,
        parentId,
      });
      db.audit(this.user.id, 'post', `post=${post.id} board=${board.id}`, this.ip);
      this.line(ansi.paint(`  Message #${post.id} posted.`, ansi.color.bold + ansi.color.brightGreen));
    } catch (err) {
      this.line(ansi.paint(`  ${err.message}`, ansi.color.brightRed));
    }
    await this.pressEnter();
  }

  async composeBody() {
    const lines = [];
    let total = 0;
    const max = Number(this.settings.max_post_length) || 8000;
    while (true) {
      const line = await this.ask('  ', { max: 200 });
      if (line === '.') break;
      if (line === '..') {
        lines.push('.');
      } else {
        lines.push(line);
      }
      total += line.length + 1;
      if (total > max) throw new Error('Message is too long.');
    }
    return lines.join('\n').trim();
  }

  // ── private mail ───────────────────────────────────────────────────────────
  async mailMenu() {
    if (this.isGuest) {
      this.line(ansi.paint('\r\n  Guests cannot use private mail.\r\n', ansi.color.brightYellow));
      await this.pressEnter();
      return;
    }
    while (true) {
      this.clear();
      const { rows, total } = mail.inbox(this.user.id, { limit: MAIL_PAGE });
      const unread = this.unreadMail();
      this.heading('PRIVATE MAIL', `${total} message${total === 1 ? '' : 's'} \u00b7 ${unread} unread`);
      this.line(this.rule());
      if (!rows.length) {
        this.line('  Your inbox is empty.');
      } else {
        rows.forEach((message, index) => {
          const marker = message.read_at ? ' ' : ansi.paint('N', ansi.color.bold + ansi.color.brightYellow);
          this.line(
            `  ${marker} ${ansi.paint(String(index + 1).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ${ansi.truncate(message.subject, 46)}`
          );
          this.line(ansi.paint(`       from ${message.from_handle} \u00b7 ${ansi.formatDate(message.created_at)}`, ansi.color.gray));
        });
      }
      this.line(this.rule());
      this.line(ansi.paint('  [#] Read  [C] Compose  [S] Sent  [D] Delete  [Q]uit', ansi.color.gray));
      const choice = await this.key('  \x1b[1;93mMail\x1b[0m \x1b[90m>\x1b[0m ', '0123456789csdq');
      if (choice === 'q') return;
      if (choice === 'c') {
        await this.composeMail();
        continue;
      }
      if (choice === 's') {
        await this.sentMail();
        continue;
      }
      if (choice === 'd') {
        const raw = await this.ask('  Delete which number? ', { max: 4 });
        const index = Number(raw) - 1;
        if (rows[index]) {
          mail.deleteMail(this.user.id, rows[index].id);
          this.line('  Deleted.');
          await this.pressEnter();
        }
        continue;
      }
      const index = Number(choice) - 1;
      if (rows[index]) await this.readMail(rows[index].id);
    }
  }

  async readMail(mailId) {
    const message = mail.openMail(this.user.id, mailId);
    if (!message) return;
    this.clear();
    this.heading(message.subject, `from ${message.from_handle}`, { upper: false });
    this.line(this.rule());
    this.line(ansi.paint(`  from ${message.from_handle} \u00b7 to ${message.to_handle} \u00b7 ${ansi.formatDate(message.created_at)}`, ansi.color.gray));
    this.line(this.rule());
    for (const line of ansi.renderBody(message.body, this.width - 4)) this.line(`  ${line}`);
    this.line(this.rule());
    this.line(ansi.paint('  [R]eply  [D]elete  [Q]uit', ansi.color.gray));
    const choice = await this.key('  \x1b[1;93mMail\x1b[0m \x1b[90m>\x1b[0m ', 'rdq');
    if (choice === 'd') {
      mail.deleteMail(this.user.id, message.id);
      this.line('  Deleted.');
      await this.pressEnter();
    } else if (choice === 'r') {
      await this.composeMail({ to: message.from_handle, subject: message.subject.startsWith('Re: ') ? message.subject : `Re: ${message.subject}` });
    }
  }

  async composeMail(prefill = {}) {
    try {
      const to = prefill.to || (await this.ask('  To (handle): ', { max: 20, min: 1 })).trim();
      const subject = prefill.subject || (await this.ask('  Subject: ', { max: 60 })).trim();
      this.line('  Enter your message. End with a single "." on its own line.');
      const body = await this.composeBody();
      const message = mail.sendMail({ fromId: this.user.id, toHandle: to, subject, body });
      const recipient = auth.findUserByHandle(to);
      if (recipient) runtime.notifyUser(recipient.id, `New private message from ${this.user.handle}: ${message.subject}`);
      this.line(ansi.paint('  Message sent.', ansi.color.bold + ansi.color.brightGreen));
    } catch (err) {
      this.line(ansi.paint(`  ${err.message}`, ansi.color.brightRed));
    }
    await this.pressEnter();
  }

  async sentMail() {
    const rows = mail.sent(this.user.id);
    this.clear();
    this.heading('SENT MAIL', `${rows.length} sent`);
    this.line(this.rule());
    if (!rows.length) this.line('  Nothing sent yet.');
    rows.forEach((message, index) => {
      this.line(
        `  ${ansi.paint(String(index + 1).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ${ansi.truncate(message.subject, 44)}`
      );
      this.line(ansi.paint(`     to ${message.to_handle} \u00b7 ${ansi.formatDate(message.created_at)} \u00b7 ${message.read_at ? 'read' : 'unread'}`, ansi.color.gray));
    });
    this.line(this.rule());
    const choice = await this.key('  \x1b[1;93mRead\x1b[0m \x1b[90m# (Q=back)\x1b[0m> ', '0123456789q');
    if (choice !== 'q') {
      const index = Number(choice) - 1;
      if (rows[index]) await this.readMail(rows[index].id);
      else await this.pressEnter();
    }
  }

  // ── files ──────────────────────────────────────────────────────────────────
  async fileMenu() {
    while (true) {
      this.clear();
      const areas = files.listAreas(this.user.level);
      this.heading('FILE AREAS', `${areas.length} areas`);
      this.line(this.rule());
      if (!areas.length) {
        this.line('  No file areas are available.');
        await this.pressEnter();
        return;
      }
      areas.forEach((area, index) => {
        this.line(
          `  ${ansi.paint(String(index + 1).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ` +
            ansi.paint(area.name, ansi.color.brightWhite)
        );
        this.line(ansi.paint(`     ${area.description} \u00b7 ${area.files} files \u00b7 ${files.formatBytes(area.bytes)}`, ansi.color.gray));
      });
      this.line(this.rule());
      const choice = await this.key('  \x1b[1;93mArea\x1b[0m \x1b[90m# (Q=back)\x1b[0m> ', '0123456789q');
      if (choice === 'q' || choice === '\r') return;
      const index = Number(choice) - 1;
      if (areas[index]) await this.areaView(areas[index]);
    }
  }

  async areaView(area) {
    let page = 0;
    let query = '';
    while (true) {
      this.clear();
      const { rows, total } = files.listFiles(area.id, { limit: FILE_PAGE, offset: page * FILE_PAGE, query });
      const pages = Math.max(1, Math.ceil(total / FILE_PAGE));
      this.heading(area.name, `page ${page + 1}/${pages}${query ? ` \u00b7 ${query}` : ''}`, { upper: false });
      this.line(this.rule());
      if (!rows.length) this.line('  No files here yet.');
      rows.forEach((file, index) => {
        this.line(
          `  ${ansi.paint(String(index + 1).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ` +
            ansi.paint(ansi.truncate(file.filename, 38), ansi.color.brightWhite) +
            ansi.paint(`  ${files.formatBytes(file.size)}`, ansi.color.gray)
        );
        this.line(ansi.paint(`     ${file.description || 'no description'} \u00b7 by ${file.handle} \u00b7 ${file.downloads} downloads`, ansi.color.gray));
      });
      this.line(this.rule());
      this.line(ansi.paint('  [#] Details  [U]pload  [S]earch  [N]ext  [B]ack  [Q]uit', ansi.color.gray));
      const choice = await this.key('  \x1b[1;93mFiles\x1b[0m \x1b[90m>\x1b[0m ', '0123456789usnbq');
      if (choice === 'q') return;
      if (choice === 'n') {
        if (page + 1 < pages) page += 1;
        continue;
      }
      if (choice === 'b') {
        if (page > 0) page -= 1;
        continue;
      }
      if (choice === 'u') {
        await this.uploadTicket(area);
        continue;
      }
      if (choice === 's') {
        query = (await this.ask('  Filename or description contains: ', { max: 40 })).trim();
        page = 0;
        continue;
      }
      const index = Number(choice) - 1;
      if (rows[index]) await this.fileDetail(rows[index].id);
    }
  }

  async fileDetail(fileId) {
    const file = files.getFile(fileId);
    if (!file) return;
    this.clear();
    this.heading(file.filename, 'file details', { upper: false });
    this.line(this.rule());
    this.line(`  ${ansi.paint('area', ansi.color.gray)}        ${file.area_name}`);
    this.line(`  ${ansi.paint('size', ansi.color.gray)}        ${files.formatBytes(file.size)}`);
    this.line(`  ${ansi.paint('uploaded by', ansi.color.gray)} ${file.handle} on ${ansi.formatDate(file.created_at)}`);
    this.line(`  ${ansi.paint('downloads', ansi.color.gray)}   ${file.downloads}`);
    this.line(`  ${ansi.paint('description', ansi.color.gray)} ${file.description || '(none)'}`);
    this.line(this.rule());
    this.line(ansi.paint('  [D]ownload  [Q]uit', ansi.color.gray));
    const choice = await this.key('  \x1b[1;93mFile\x1b[0m \x1b[90m>\x1b[0m ', 'dq');
    if (choice === 'd') {
      const token = auth.signToken(
        { kind: 'download', uid: this.user.id || 0, fid: file.id },
        this.config.sessionSecret,
        900
      );
      this.line();
      this.line(ansi.paint('  Download link (valid 15 minutes):', ansi.color.brightYellow));
      this.line(`  ${this.config.publicUrl}/dl/${token}`);
      this.line();
      this.line(ansi.color.gray + '  Open the link in a browser to transfer the file.' + ansi.color.reset);
    }
    await this.pressEnter();
  }

  async uploadTicket(area) {
    if (this.isGuest) {
      this.line(ansi.paint('  Guests cannot upload files.', ansi.color.brightYellow));
      await this.pressEnter();
      return;
    }
    const token = auth.signToken(
      { kind: 'upload', uid: this.user.id, aid: area.id },
      this.config.sessionSecret,
      1800
    );
    this.clear();
    this.heading('UPLOAD A FILE', area.name);
    this.line(this.rule());
    this.line(`  ${ansi.paint('area', ansi.color.gray)}    ${area.name}`);
    this.line(`  ${ansi.paint('max', ansi.color.gray)}     ${files.formatBytes(this.config.maxUploadBytes)}`);
    this.line();
    this.line(ansi.paint('  open this link in a browser and choose your file:', ansi.color.brightYellow));
    this.line(`  ${ansi.paint(`${this.config.publicUrl}/upload/${token}`, ansi.color.brightWhite)}`);
    this.line();
    this.line(ansi.paint('  the link is good for 30 minutes. come back here when the transfer finishes.', ansi.color.gray));
    await this.pressEnter();
  }

  // ── chat ───────────────────────────────────────────────────────────────────
  async chatRoom() {
    if (this.settings.chat_enabled !== '1') {
      this.line(ansi.paint('\r\n  The chat room is closed.\r\n', ansi.color.brightYellow));
      await this.pressEnter();
      return;
    }
    runtime.joinChat(this.runtimeSession);
    this.updateState('Chat Room');
    this.clear();
    this.heading('CHAT ROOM', '/leave \u00b7 /who \u00b7 /me <action>');
    this.line(this.rule());
    for (const message of chat.recentChat(15)) {
      this.line(`  ${ansi.paint(message.handle, ansi.color.bold + ansi.color.brightGreen)}${ansi.paint(':', ansi.color.gray)} ${message.body}`);
    }
    this.line(this.rule());

    try {
      while (true) {
        const line = await this.term.readLine({
          prompt: this.prompt('  \x1b[1;92m>\x1b[0m '),
          max: 160,
          onTick: () => {
            const incoming = runtime.drainChat(this.runtimeSession);
            if (!incoming.length) return false;
            for (const entry of incoming) this.line(entry);
            return true;
          },
        });
        const text = line.trim();
        if (!text) continue;
        if (text === '/leave' || text === '/quit' || text === '/exit') return;
        if (text === '/who') {
          const names = runtime.chatSubscribers().map((session) => session.handle);
          this.line(ansi.color.gray + `  In the room: ${names.join(', ') || 'nobody'}` + ansi.color.reset);
          continue;
        }
        if (text === '/help') {
          this.line('  /leave  /who  /me <action>  — anything else is sent to the room.');
          continue;
        }
        if (this.isGuest) {
          this.line(ansi.paint('  Guests may read but not post.', ansi.color.brightYellow));
          continue;
        }
        const action = text.startsWith('/me ');
        const body = action ? `${this.user.handle} ${text.slice(4)}` : text;
        try {
          chat.postChat(this.user.id, body);
          const rendered = action
            ? ansi.paint(`* ${body}`, ansi.color.brightMagenta)
            : `${ansi.paint(this.user.handle, ansi.color.brightGreen)}: ${ansi.paint(body, ansi.color.white)}`;
          this.line(`  ${rendered}`);
          runtime.chatBroadcast(rendered, { excludeSessionId: this.runtimeSession.id });
        } catch (err) {
          this.line(ansi.paint(`  ${err.message}`, ansi.color.brightYellow));
        }
      }
    } finally {
      runtime.leaveChat(this.runtimeSession);
      this.updateState('Main Menu');
    }
  }

  // ── one-liners ─────────────────────────────────────────────────────────────
  async oneLinerMenu() {
    if (this.settings.oneliners_enabled !== '1') {
      this.line(ansi.paint('\r\n  The one-liner wall is closed.\r\n', ansi.color.brightYellow));
      await this.pressEnter();
      return;
    }
    while (true) {
      this.clear();
      const rows = chat.recentOneLiners(15);
      this.heading('ONE-LINER WALL', `${rows.length} on the wall`);
      this.line(this.rule());
      if (!rows.length) this.line('  The wall is blank. Fix that.');
      rows.forEach((row, index) => {
        this.line(
          `  ${ansi.paint(String(index + 1).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ${ansi.paint(row.body, ansi.color.brightWhite)}`
        );
        this.line(
          `     ${ansi.paint(`${row.handle} \u00b7 ${ansi.relativeTime(row.created_at)}`, ansi.color.gray)}`
        );
      });
      this.line(this.rule());
      this.line(ansi.paint('  [P]ost  [D]elete yours  [Q]uit', ansi.color.gray));
      const choice = await this.key('  \x1b[1;93mWall\x1b[0m \x1b[90m>\x1b[0m ', 'pdq');
      if (choice === 'q') return;
      if (choice === 'p') {
        if (this.isGuest) {
          this.line(ansi.paint('  Guests cannot post.', ansi.color.brightYellow));
          await this.pressEnter();
          continue;
        }
        try {
          const body = await this.ask('  One line (max 70): ', { max: 70, min: 1 });
          chat.postOneLiner(this.user.id, body);
          this.line(ansi.paint('  Posted.', ansi.color.brightGreen));
        } catch (err) {
          this.line(ansi.paint(`  ${err.message}`, ansi.color.brightRed));
        }
        await this.pressEnter();
      } else if (choice === 'd') {
        const raw = await this.ask('  Delete which number? ', { max: 4 });
        const index = Number(raw) - 1;
        if (rows[index]) {
          const ok = chat.deleteOneLiner(rows[index].id, { userId: this.user.id, level: this.user.level });
          this.line(ok ? '  Deleted.' : ansi.paint('  You can only delete your own liners.', ansi.color.brightRed));
          await this.pressEnter();
        }
      }
    }
  }

  // ── door games ─────────────────────────────────────────────────────────────
  async gameMenu() {
    const list = doors.listDoors(this.user.level);
    this.clear();
    this.heading('DOOR GAMES', `${list.length} installed`);
    this.line(this.rule());
    list.forEach((door, index) => {
      this.line(
        `  ${ansi.paint(String(index + 1).padStart(2, '0'), ansi.color.bold + ansi.color.brightYellow)} ${ansi.paint(door.name, ansi.color.brightWhite)}`
      );
      this.line(`     ${ansi.paint(door.description, ansi.color.gray)}`);
    });
    if (!list.length) this.line('  No doors are installed.');
    this.line(this.rule());
    const choice = await this.key('  \x1b[1;93mGame\x1b[0m \x1b[90m# (Q=back)\x1b[0m> ', '0123456789q');
    if (choice === 'q' || choice === '\r') return;
    const door = list[Number(choice) - 1];
    if (!door) return;
    if (this.isGuest) {
      this.line(ansi.paint('  Guests cannot play door games. Register an account first.', ansi.color.brightYellow));
      await this.pressEnter();
      return;
    }

    this.updateState(`Playing ${door.name}`);
    try {
      if (door.kind === 'builtin' && door.builtin && doors.BUILTINS[door.builtin]) {
        const play = doors.BUILTINS[door.builtin]();
        await play({ term: this.term, session: this, config: this.config });
      } else if (door.kind === 'external') {
        await doors.runExternal(this, door);
      } else {
        this.line('  This door is not configured correctly.');
        await this.pressEnter();
      }
    } catch (err) {
      if (err instanceof Cancelled) {
        this.line('\r\n  Game cancelled.');
      } else {
        console.error('[doors]', err);
        this.line(`\r\n  Door failed: ${err.message}`);
      }
      await this.pressEnter();
    } finally {
      this.updateState('Main Menu');
      this.refreshUser();
    }
  }

  // ── who / users ────────────────────────────────────────────────────────────
  async whoMenu() {
    this.clear();
    const list = runtime.list();
    this.heading("WHO'S ONLINE", `${list.length} connected`);
    this.line(this.rule());
    this.line(ansi.paint('  Node  Handle               Where                     Idle', ansi.color.gray));
    this.line(`  ${this.rule('\u2500', Math.min(64, this.width - 2))}`);
    for (const session of list) {
      this.line(
        `  ${ansi.paint(String(session.node).padStart(4), ansi.color.bold + ansi.color.brightYellow)}  ` +
          `${ansi.paint(ansi.padRight(ansi.truncate(session.handle, 18), 18), ansi.color.brightWhite)} ` +
          `${ansi.paint(ansi.padRight(ansi.truncate(session.state, 24), 24), ansi.color.gray)} ` +
          `${ansi.paint(`${String(session.idleSeconds).padStart(4)}s`, ansi.color.brightCyan)}`
      );
    }
    if (!list.length) this.line('  Nobody is connected.');
    this.line(this.rule());
    this.line(ansi.color.gray + `  ${list.length} connection${list.length === 1 ? '' : 's'} · ${runtime.chatSubscribers().length} in chat` + ansi.color.reset);
    await this.pressEnter();
  }

  async userList() {
    this.clear();
    const rows = db
      .getDb()
      .prepare(
        `SELECT handle, level, posts, credits, created_at, last_login_at
         FROM users WHERE validated = 1 AND banned = 0
         ORDER BY posts DESC, id ASC LIMIT 20`
      )
      .all();
    this.heading('USER LIST', 'top 20 posters');
    this.line(this.rule());
    this.line(ansi.paint('  Handle               Level      Posts   Last seen', ansi.color.gray));
    this.line(`  ${this.rule('\u2500', Math.min(62, this.width - 2))}`);
    rows.forEach((user) => {
      this.line(
        `  ${ansi.paint(ansi.padRight(ansi.truncate(user.handle, 18), 18), ansi.color.brightWhite)} ` +
          `${ansi.paint(ansi.padRight(titleFor(user.level), 8), ansi.color.brightCyan)} ` +
          `${ansi.paint(String(user.posts).padStart(6), ansi.color.bold + ansi.color.brightYellow)}   ` +
          `${ansi.paint(user.last_login_at ? ansi.relativeTime(user.last_login_at) : 'never', ansi.color.gray)}`
      );
    });
    this.line(this.rule());
    await this.pressEnter();
  }

  // ── settings ───────────────────────────────────────────────────────────────
  async settingsMenu() {
    while (true) {
      this.refreshUser();
      this.clear();
      this.heading('YOUR SETTINGS', this.isGuest ? 'guest session' : titleFor(this.user.level));
      this.line(this.rule());
      if (this.isGuest) {
        this.line('  You are browsing as a guest. Register an account to keep a profile.');
      } else {
        const row = (label, value) =>
          this.line(
            `  ${ansi.paint(ansi.padRight(`${label}:`, 11), ansi.color.gray)} ${ansi.paint(String(value), ansi.color.brightWhite)}`
          );
        row('Handle', this.user.handle);
        row('Real name', this.user.real_name || '(not set)');
        row('Location', this.user.location || '(not set)');
        row('Email', this.user.email || '(not set)');
        row('ANSI', this.user.ansi ? 'on' : 'off');
        row('Credits', this.user.credits);
        row('Posts', this.user.posts);
        row('Member', ansi.formatDate(this.user.created_at, false));
      }
      this.line(this.rule());
      this.line(ansi.paint('  [P]assword  [E]dit profile  [A]NSI toggle  [Q]uit', ansi.color.gray));
      const choice = await this.key('  \x1b[1;93mSettings\x1b[0m \x1b[90m>\x1b[0m ', 'paeq');
      if (choice === 'q') return;
      if (this.isGuest && (choice === 'p' || choice === 'e')) {
        this.line(ansi.paint('  Guests cannot change account settings.', ansi.color.brightYellow));
        await this.pressEnter();
        continue;
      }
      if (choice === 'p') await this.changePassword();
      else if (choice === 'e') await this.editProfile();
      else if (choice === 'a') {
        const next = this.user.ansi ? 0 : 1;
        db.getDb().prepare('UPDATE users SET ansi = ? WHERE id = ?').run(next, this.user.id);
        this.user.ansi = next;
        this.ansi = Boolean(next);
        this.line(`  ANSI colour now ${next ? 'on' : 'off'}.`);
        await this.pressEnter();
      }
    }
  }

  async changePassword() {
    try {
      const current = await this.ask('  Current password: ', { mask: true, max: 128 });
      if (!auth.verifyPassword(current, this.user.password_hash)) {
        this.line(ansi.paint('  Current password is wrong.', ansi.color.brightRed));
        await this.pressEnter();
        return;
      }
      const minLength = Math.max(4, Number(this.settings.min_password_length) || 6);
      const next = await this.ask(`  New password (min ${minLength}): `, { mask: true, max: 128, min: minLength });
      const confirm = await this.ask('  Repeat new password: ', { mask: true, max: 128, min: minLength });
      if (next !== confirm) {
        this.line(ansi.paint('  Passwords do not match.', ansi.color.brightRed));
      } else {
        auth.setPassword(this.user.id, next);
        db.audit(this.user.id, 'password-change', '', this.ip);
        this.line(ansi.paint('  Password changed.', ansi.color.brightGreen));
      }
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
    await this.pressEnter();
  }

  async editProfile() {
    try {
      const realName = (await this.ask(`  Real name [${this.user.real_name}]: `, { max: 60 })).trim();
      const location = (await this.ask(`  Location [${this.user.location}]: `, { max: 60 })).trim();
      const email = (await this.ask(`  Email [${this.user.email}]: `, { max: 120 })).trim();
      db.getDb()
        .prepare('UPDATE users SET real_name = ?, location = ?, email = ? WHERE id = ?')
        .run(
          realName || this.user.real_name,
          location || this.user.location,
          email || this.user.email,
          this.user.id
        );
      this.refreshUser();
      this.line(ansi.paint('  Profile updated.', ansi.color.brightGreen));
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
    await this.pressEnter();
  }

  // ── sysop console ──────────────────────────────────────────────────────────
  async sysopMenu() {
    while (true) {
      this.clear();
      this.heading('SYSOP CONSOLE', `level ${this.user.level}`);
      this.line(this.rule());
      const counts = db
        .getDb()
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM posts WHERE deleted = 0) AS posts,
            (SELECT COUNT(*) FROM files WHERE deleted = 0) AS files,
            (SELECT COUNT(*) FROM mail) AS mail`
        )
        .get();
      const stat = (label, value) =>
        `${ansi.paint(label, ansi.color.gray)} ${ansi.paint(String(value), ansi.color.bold + ansi.color.brightCyan)}`;
      this.line(
        '  ' +
          [
            stat('users', counts.users),
            stat('posts', counts.posts),
            stat('files', counts.files),
            stat('mail', counts.mail),
            stat('online', runtime.count()),
          ].join(ansi.paint('   \u00b7   ', ansi.color.blue))
      );
      this.line(
        `  ${ansi.paint('registration', ansi.color.gray)} ${this.settings.registration_open === '1' ? 'open' : 'closed'}` +
          `${ansi.paint('   \u00b7   guest', ansi.color.gray)} ${this.settings.guest_enabled === '1' ? 'on' : 'off'}` +
          `${ansi.paint('   \u00b7   validation', ansi.color.gray)} ${this.settings.new_user_validation === '1' ? 'required' : 'off'}`
      );
      this.line(this.rule());
      this.line(ansi.paint('  [V]alidate user   [B]an / unban   [P]romote', ansi.color.gray));
      this.line(ansi.paint('  [M]essage all     [T]oggle settings   [A]udit log', ansi.color.gray));
      this.line(ansi.paint('  [W]eb admin: ', ansi.color.gray) + ansi.paint(`${this.config.publicUrl}/admin`, ansi.color.brightBlue));
      this.line(ansi.paint('  [Q]uit', ansi.color.gray));
      const choice = await this.key('  \x1b[1;95mSysop\x1b[0m \x1b[90m>\x1b[0m ', 'vbpmatwq');
      if (choice === 'q') return;
      if (choice === 'v') {
        const handle = (await this.ask('  Validate handle: ', { max: 20 })).trim();
        const target = auth.findUserByHandle(handle);
        if (target) {
          db.getDb().prepare('UPDATE users SET validated = 1 WHERE id = ?').run(target.id);
          db.audit(this.user.id, 'validate', target.handle, this.ip);
          this.line(ansi.paint(`  ${target.handle} validated.`, ansi.color.brightGreen));
          runtime.notifyUser(target.id, 'Your account has been validated by the sysop.');
        } else this.line('  No such user.');
        await this.pressEnter();
      } else if (choice === 'b') {
        const handle = (await this.ask('  Ban / unban handle: ', { max: 20 })).trim();
        const target = auth.findUserByHandle(handle);
        if (target) {
          if (target.id === this.user.id) {
            this.line(ansi.paint('  You cannot ban yourself.', ansi.color.brightRed));
          } else {
            const next = target.banned ? 0 : 1;
            db.getDb().prepare('UPDATE users SET banned = ? WHERE id = ?').run(next, target.id);
            db.audit(this.user.id, next ? 'ban' : 'unban', target.handle, this.ip);
            this.line(`  ${target.handle} ${next ? 'banned' : 'unbanned'}.`);
            if (next) runtime.disconnectUser(target.id, 'Your account has been banned by the sysop.');
          }
        } else this.line('  No such user.');
        await this.pressEnter();
      } else if (choice === 'p') {
        const handle = (await this.ask('  Promote/demote handle: ', { max: 20 })).trim();
        const target = auth.findUserByHandle(handle);
        if (target) {
          const raw = await this.ask(`  New level (0-100, current ${target.level}): `, { max: 3 });
          const level = Math.max(0, Math.min(100, Number(raw) || 0));
          db.getDb().prepare('UPDATE users SET level = ? WHERE id = ?').run(level, target.id);
          db.audit(this.user.id, 'level', `${target.handle}=${level}`, this.ip);
          this.line(`  ${target.handle} is now level ${level} (${titleFor(level)}).`);
        } else this.line('  No such user.');
        await this.pressEnter();
      } else if (choice === 'm') {
        const message = (await this.ask('  Broadcast: ', { max: 200, min: 1 })).trim();
        runtime.broadcast(`[${this.user.handle}] ${message}`);
        db.audit(this.user.id, 'broadcast', message, this.ip);
        this.line('  Broadcast queued for all connected users.');
        await this.pressEnter();
      } else if (choice === 't') {
        const key = await this.key('  [R]egistration  [G]uest  [V]alidation  [Q]uit: ', 'rgvq');
        if (key === 'r') {
          const next = this.settings.registration_open === '1' ? '0' : '1';
          db.setSetting('registration_open', next);
          this.line(`  Registration ${next === '1' ? 'opened' : 'closed'}.`);
        } else if (key === 'g') {
          const next = this.settings.guest_enabled === '1' ? '0' : '1';
          db.setSetting('guest_enabled', next);
          this.line(`  Guest access ${next === '1' ? 'enabled' : 'disabled'}.`);
        } else if (key === 'v') {
          const next = this.settings.new_user_validation === '1' ? '0' : '1';
          db.setSetting('new_user_validation', next);
          this.line(`  New user validation ${next === '1' ? 'required' : 'not required'}.`);
        }
        this.settings = db.getSettings();
        await this.pressEnter();
      } else if (choice === 'a') {
        const rows = db
          .getDb()
          .prepare('SELECT action, detail, created_at FROM audit ORDER BY id DESC LIMIT 12')
          .all();
        this.line();
        if (!rows.length) this.line('  No audit entries.');
        for (const row of rows) {
          this.line(`  ${ansi.formatDate(row.created_at)}  ${ansi.padRight(row.action, 16)} ${ansi.truncate(row.detail, 40)}`);
        }
        await this.pressEnter();
      } else if (choice === 'w') {
        this.line(`  Open ${this.config.publicUrl}/admin in a browser and log in with your sysop handle and password.`);
        await this.pressEnter();
      }
    }
  }
}

async function startSession(term, config, options = {}) {
  const session = new BbsSession(term, config, options);
  await session.run();
  return session;
}

module.exports = { BbsSession, startSession, titleFor };
