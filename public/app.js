'use strict';

(function () {
  const THEMES = {
    scene: {
      background: '#04050a',
      foreground: '#a8e2ff',
      cursor: '#00e5ff',
      cursorAccent: '#04050a',
      selectionBackground: 'rgba(0, 229, 255, 0.24)',
      black: '#0a0d18',
      red: '#ff4d6d',
      green: '#39ff9e',
      yellow: '#ffe66d',
      blue: '#3a7bff',
      magenta: '#ff3ec8',
      cyan: '#00e5ff',
      white: '#d5e6f5',
      brightBlack: '#4a5a75',
      brightRed: '#ff7a94',
      brightGreen: '#7dffc4',
      brightYellow: '#fff2a8',
      brightBlue: '#7aa8ff',
      brightMagenta: '#ff86e0',
      brightCyan: '#8df6ff',
      brightWhite: '#ffffff',
    },
    green: {
      background: '#050806',
      foreground: '#8dffae',
      cursor: '#37ff7f',
      cursorAccent: '#050806',
      selectionBackground: 'rgba(55, 255, 127, 0.22)',
      black: '#0b110d',
      red: '#ff5f6d',
      green: '#37ff7f',
      yellow: '#ffd166',
      blue: '#5aa9ff',
      magenta: '#ff6bd6',
      cyan: '#5ff0e0',
      white: '#d8e6dd',
      brightBlack: '#4d6a57',
      brightRed: '#ff8a95',
      brightGreen: '#7dffb0',
      brightYellow: '#ffe39b',
      brightBlue: '#8cc7ff',
      brightMagenta: '#ff9be4',
      brightCyan: '#9bfff2',
      brightWhite: '#ffffff',
    },
    amber: {
      background: '#0a0703',
      foreground: '#ffc45e',
      cursor: '#ffb000',
      cursorAccent: '#0a0703',
      selectionBackground: 'rgba(255, 176, 0, 0.25)',
      black: '#120c04',
      red: '#ff7b4f',
      green: '#ffd166',
      yellow: '#ffb000',
      blue: '#d79b45',
      magenta: '#ff8f5e',
      cyan: '#ffe0a3',
      white: '#ffe6bd',
      brightBlack: '#7a5a22',
      brightRed: '#ffab84',
      brightGreen: '#ffe39b',
      brightYellow: '#ffd166',
      brightBlue: '#f0bc74',
      brightMagenta: '#ffb894',
      brightCyan: '#fff2d6',
      brightWhite: '#fffaf0',
    },
    mono: {
      background: '#07090a',
      foreground: '#d8e6dd',
      cursor: '#ffffff',
      cursorAccent: '#07090a',
      selectionBackground: 'rgba(216, 230, 221, 0.22)',
      black: '#0c1012',
      red: '#ff7a85',
      green: '#c8f5d6',
      yellow: '#f5e6b8',
      blue: '#b8d8f5',
      magenta: '#e8c8f5',
      cyan: '#c8f5f0',
      white: '#d8e6dd',
      brightBlack: '#5c6b63',
      brightRed: '#ffa5ad',
      brightGreen: '#e2ffe9',
      brightYellow: '#fff3cf',
      brightBlue: '#d6ecff',
      brightMagenta: '#f4e0ff',
      brightCyan: '#e0fffb',
      brightWhite: '#ffffff',
    },
  };

  const term = new Terminal({
    cursorBlink: true,
    convertEol: false,
    scrollback: 4000,
    screenReaderMode: true,
    fontFamily: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: Number(localStorage.getItem('bbs.fontSize')) || 15,
    lineHeight: 1.15,
    theme: THEMES[localStorage.getItem('bbs.theme')] ? THEMES[localStorage.getItem('bbs.theme')] : THEMES.scene,
  });

  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  if (window.WebLinksAddon && window.WebLinksAddon.WebLinksAddon) {
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
  }
  term.open(document.getElementById('terminal'));

  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const reconnectButton = document.getElementById('reconnect');
  const status = document.getElementById('status');
  const brand = document.getElementById('brand');

  let socket = null;
  let connected = false;
  let intentionalClose = false;
  let fitTimer = null;

  function setStatus(state, label) {
    status.className = `pill ${state}`;
    status.textContent = label;
  }

  function send(payload) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function pushResize() {
    if (!connected) return;
    send({ t: 'r', c: term.cols, r: term.rows });
  }

  function refit() {
    try {
      fit.fit();
      pushResize();
    } catch {
      // terminal is not visible yet
    }
  }

  function scheduleFit() {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(refit, 60);
  }

  function showOverlay(title, text) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function connect() {
    if (socket) {
      intentionalClose = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      socket = null;
    }
    intentionalClose = false;
    setStatus('connecting', 'connecting');
    showOverlay('Dialing the board', 'Opening a connection to the BBS…');
    term.focus();

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws`);

    socket.addEventListener('open', () => {
      connected = true;
      setStatus('online', 'online');
      hideOverlay();
      scheduleFit();
      term.focus();
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.t === 'o') {
        term.write(message.d);
      } else if (message.t === 'c') {
        intentionalClose = true;
        setStatus('offline', 'closed');
        showOverlay('Session ended', 'The board closed the connection. Call back any time.');
      }
    });

    socket.addEventListener('close', () => {
      connected = false;
      if (intentionalClose) {
        setStatus('offline', 'closed');
      } else {
        setStatus('offline', 'disconnected');
        showOverlay('Connection lost', 'The board is unreachable. Check the server, then reconnect.');
      }
    });

    socket.addEventListener('error', () => {
      setStatus('offline', 'error');
    });
  }

  term.onData((data) => {
    if (connected) send({ t: 'i', d: data });
  });

  term.onResize(() => pushResize());

  reconnectButton.addEventListener('click', () => {
    hideOverlay();
    connect();
  });

  document.getElementById('screen').addEventListener('click', (event) => {
    if (event.target === overlay || overlay.hidden) term.focus();
  });

  document.getElementById('font-inc').addEventListener('click', () => {
    const size = Math.min(28, (term.options.fontSize || 15) + 1);
    term.options.fontSize = size;
    localStorage.setItem('bbs.fontSize', String(size));
    scheduleFit();
  });

  document.getElementById('font-dec').addEventListener('click', () => {
    const size = Math.max(9, (term.options.fontSize || 15) - 1);
    term.options.fontSize = size;
    localStorage.setItem('bbs.fontSize', String(size));
    scheduleFit();
  });

  document.querySelectorAll('[data-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.theme;
      if (!THEMES[name]) return;
      term.options.theme = THEMES[name];
      localStorage.setItem('bbs.theme', name);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', THEMES[name].background);
    });
  });

  const KEY_SEQUENCES = {
    esc: '\x1b',
    tab: '\t',
    enter: '\r',
    up: '\x1b[A',
    down: '\x1b[B',
    right: '\x1b[C',
    left: '\x1b[D',
    'ctrl-c': '\x03',
    'ctrl-u': '\x15',
  };

  document.querySelectorAll('#keys [data-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const sequence = KEY_SEQUENCES[button.dataset.key];
      if (sequence && connected) send({ t: 'i', d: sequence });
      term.focus();
    });
  });

  new ResizeObserver(scheduleFit).observe(document.getElementById('screen'));
  window.addEventListener('orientationchange', scheduleFit);

  fetch('/api/status')
    .then((response) => response.json())
    .then((data) => {
      if (data && data.name) {
        brand.textContent = data.name;
        document.title = data.name;
      }
    })
    .catch(() => {});

  refit();
  connect();
})();
