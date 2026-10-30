'use strict';

(function () {
  const API = '/admin/api';
  const CSRF = { 'X-Requested-With': 'deadplug-bbs' };
  const state = { me: null, view: 'dashboard' };

  const loginView = document.getElementById('login');
  const appView = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const brandName = document.getElementById('brand-name');
  const adminHandle = document.getElementById('admin-handle');
  const toast = document.getElementById('toast');
  const viewTitle = document.getElementById('view-title');

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function say(message, bad = false) {
    toast.textContent = message;
    toast.className = `toast${bad ? ' bad' : ''}`;
    clearTimeout(say.timer);
    say.timer = setTimeout(() => {
      toast.textContent = '';
    }, 4000);
  }

  async function api(path, options = {}) {
    const headers = { ...CSRF, ...(options.headers || {}) };
    if (options.body && typeof options.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(`${API}${path}`, { credentials: 'same-origin', ...options, headers });
    let data = {};
    try {
      data = await response.json();
    } catch {
      // empty body
    }
    if (response.status === 401) {
      showLogin();
      throw new Error('Sign in again.');
    }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  function table(headers, rows, emptyText = 'Nothing here.') {
    if (!rows.length) return `<p class="empty">${escapeHtml(emptyText)}</p>`;
    const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
    return `<div style="overflow-x:auto"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function date(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleString('en-US', { hour12: false });
  }

  function view(name) {
    state.view = name;
    document.querySelectorAll('#nav button').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach((section) => {
      section.hidden = section.id !== `view-${name}`;
    });
    const titles = {
      dashboard: 'Dashboard',
      users: 'Users',
      boards: 'Boards',
      files: 'Files',
      oneliners: 'One-liners',
      chat: 'Chat',
      doors: 'Doors',
      settings: 'Settings',
      audit: 'Audit log',
    };
    viewTitle.textContent = titles[name] || name;
    const loader = LOADERS[name];
    if (loader) loader().catch((err) => say(err.message, true));
  }

  function showLogin() {
    appView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = '';
    document.getElementById('login-handle').focus();
  }

  function showApp() {
    loginView.hidden = true;
    appView.hidden = false;
    adminHandle.textContent = `${state.me.handle} · level ${state.me.level}`;
    view('dashboard');
  }

  // ── dashboard ──────────────────────────────────────────────────────────────
  async function loadDashboard() {
    const { counts, online, audit, settings } = await api('/overview');
    brandName.textContent = settings.bbs_name || 'BBS';
    document.title = `${settings.bbs_name || 'BBS'} — Sysop`;
    document.getElementById('stats').innerHTML = [
      ['Users', counts.users, `${counts.pending} pending · ${counts.banned} banned`],
      ['Posts', counts.posts, 'live messages'],
      ['Files', counts.files, 'available'],
      ['Online', online.length, 'connections'],
      ['Mail', counts.mail, 'total letters'],
      ['Chat', counts.chat, 'retained lines'],
    ]
      .map(
        ([label, value, sub]) =>
          `<div class="card"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span><span class="mono">${escapeHtml(sub)}</span></div>`
      )
      .join('');

    document.getElementById('online').innerHTML = table(
      ['Node', 'Handle', 'Where', 'Idle'],
      online.map(
        (session) =>
          `<tr><td>${session.node}</td><td>${escapeHtml(session.handle)}</td><td>${escapeHtml(session.state)}</td><td>${session.idleSeconds}s</td></tr>`
      ),
      'Nobody is connected.'
    );

    document.getElementById('recent-audit').innerHTML = table(
      ['When', 'Who', 'Action', 'Detail'],
      audit.slice(0, 8).map(
        (row) =>
          `<tr><td class="mono">${date(row.created_at)}</td><td>${row.user_id ?? '—'}</td><td>${escapeHtml(row.action)}</td><td class="truncate">${escapeHtml(row.detail)}</td></tr>`
      ),
      'No audit entries.'
    );

    const posts = await api('/posts?limit=8');
    document.getElementById('recent-posts').innerHTML = table(
      ['#', 'Subject', 'Board', 'By'],
      posts.posts.map(
        (post) =>
          `<tr><td>${post.id}</td><td class="truncate">${escapeHtml(post.subject)}</td><td>${escapeHtml(post.board)}</td><td>${escapeHtml(post.handle)}</td></tr>`
      ),
      'No posts.'
    );
  }

  // ── users ───────────────────────────────────────────────────────────────────
  async function loadUsers(query = '') {
    const { users } = await api(`/users${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    document.getElementById('users-table').innerHTML = table(
      ['Handle', 'Level', 'Status', 'Posts', 'Credits', 'Last login', 'Actions'],
      users.map(
        (user) => `<tr>
          <td>${escapeHtml(user.handle)}${user.real_name ? `<div class="mono">${escapeHtml(user.real_name)}</div>` : ''}</td>
          <td>${user.level}</td>
          <td>${user.banned ? '<span class="tag bad">banned</span>' : user.validated ? '<span class="tag ok">active</span>' : '<span class="tag warn">pending</span>'}</td>
          <td>${user.posts}</td>
          <td>${user.credits}</td>
          <td class="mono">${date(user.last_login_at)}</td>
          <td class="actions">
            <button class="small ghost" data-action="validate" data-id="${user.id}" data-value="${user.validated ? '0' : '1'}">${user.validated ? 'Unvalidate' : 'Validate'}</button>
            <button class="small ghost" data-action="ban" data-id="${user.id}" data-value="${user.banned ? '0' : '1'}">${user.banned ? 'Unban' : 'Ban'}</button>
            <button class="small ghost" data-action="level" data-id="${user.id}" data-level="${user.level}">Level</button>
            <button class="small ghost" data-action="password" data-id="${user.id}">Password</button>
            <button class="small danger" data-action="delete-user" data-id="${user.id}" data-handle="${escapeHtml(user.handle)}">Delete</button>
          </td>
        </tr>`
      ),
      'No users found.'
    );
  }

  async function patchUser(id, body) {
    const result = await api(`/users/${id}`, { method: 'PATCH', body });
    say(`Updated ${result.user.handle}.`);
    await loadUsers(document.getElementById('user-query').value.trim());
  }

  // ── boards ──────────────────────────────────────────────────────────────────
  async function loadBoards() {
    const [{ boards }, { posts }] = await Promise.all([api('/boards'), api('/posts?limit=25')]);
    document.getElementById('boards-table').innerHTML = table(
      ['#', 'Board', 'Description', 'Min level', 'Mode', 'Messages', 'Actions'],
      boards.map(
        (board) => `<tr>
          <td>${board.id}</td>
          <td>${escapeHtml(board.name)}</td>
          <td class="truncate">${escapeHtml(board.description)}</td>
          <td>${board.min_level}</td>
          <td>${board.read_only ? '<span class="tag warn">read-only</span>' : '<span class="tag ok">open</span>'}</td>
          <td>${board.posts}</td>
          <td class="actions">
            <button class="small ghost" data-action="board-edit" data-id="${board.id}" data-name="${escapeHtml(board.name)}" data-description="${escapeHtml(board.description)}" data-level="${board.min_level}">Edit</button>
            <button class="small ghost" data-action="board-readonly" data-id="${board.id}" data-value="${board.read_only ? '0' : '1'}">${board.read_only ? 'Open posting' : 'Read-only'}</button>
            <button class="small danger" data-action="board-delete" data-id="${board.id}" data-name="${escapeHtml(board.name)}">Delete</button>
          </td>
        </tr>`
      ),
      'No boards.'
    );

    document.getElementById('posts-table').innerHTML = table(
      ['#', 'Subject', 'Board', 'By', 'When', 'Actions'],
      posts.map(
        (post) => `<tr>
          <td>${post.id}</td>
          <td class="truncate">${escapeHtml(post.subject)}</td>
          <td>${escapeHtml(post.board)}</td>
          <td>${escapeHtml(post.handle)}</td>
          <td class="mono">${date(post.created_at)}</td>
          <td class="actions"><button class="small danger" data-action="post-delete" data-id="${post.id}">Delete</button></td>
        </tr>`
      ),
      'No posts.'
    );
  }

  // ── files ───────────────────────────────────────────────────────────────────
  async function loadFiles() {
    const [{ areas }, { files }] = await Promise.all([api('/areas'), api('/files')]);
    document.getElementById('areas-table').innerHTML = table(
      ['#', 'Area', 'Description', 'Min level', 'Files', 'Size'],
      areas.map(
        (area) => `<tr>
          <td>${area.id}</td>
          <td>${escapeHtml(area.name)}</td>
          <td class="truncate">${escapeHtml(area.description)}</td>
          <td>${area.min_level}</td>
          <td>${area.files}</td>
          <td class="mono">${formatBytes(area.bytes)}</td>
        </tr>`
      ),
      'No file areas.'
    );

    document.getElementById('files-table').innerHTML = table(
      ['#', 'File', 'Area', 'Size', 'Uploader', 'When', 'Actions'],
      files.map(
        (file) => `<tr>
          <td>${file.id}</td>
          <td>${escapeHtml(file.filename)}<div class="mono truncate">${escapeHtml(file.description)}</div></td>
          <td>${escapeHtml(file.area)}</td>
          <td class="mono">${formatBytes(file.size)}</td>
          <td>${escapeHtml(file.handle)}</td>
          <td class="mono">${date(file.created_at)}</td>
          <td class="actions"><button class="small danger" data-action="file-delete" data-id="${file.id}" data-name="${escapeHtml(file.filename)}">Delete</button></td>
        </tr>`
      ),
      'No files uploaded.'
    );
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ── one-liners & chat ───────────────────────────────────────────────────────
  async function loadOneliners() {
    const { oneliners } = await api('/oneliners');
    document.getElementById('oneliners-table').innerHTML = table(
      ['#', 'Line', 'Author', 'When', 'Actions'],
      oneliners.map(
        (row) => `<tr>
          <td>${row.id}</td>
          <td>${escapeHtml(row.body)}</td>
          <td>${escapeHtml(row.handle)}</td>
          <td class="mono">${date(row.created_at)}</td>
          <td class="actions"><button class="small danger" data-action="oneliner-delete" data-id="${row.id}">Delete</button></td>
        </tr>`
      ),
      'The wall is empty.'
    );
  }

  async function loadChat() {
    const { chat } = await api('/chat');
    document.getElementById('chat-list').innerHTML = table(
      ['#', 'Handle', 'Message', 'When'],
      chat.map(
        (row) => `<tr>
          <td>${row.id}</td>
          <td>${escapeHtml(row.handle)}</td>
          <td>${escapeHtml(row.body)}</td>
          <td class="mono">${date(row.created_at)}</td>
        </tr>`
      ),
      'No retained chat lines.'
    );
  }

  // ── doors ───────────────────────────────────────────────────────────────────
  async function loadDoors() {
    const { doors } = await api('/doors');
    document.getElementById('doors-table').innerHTML = table(
      ['#', 'Door', 'Kind', 'Command / key', 'Drop file', 'PTY', 'Timeout', 'Min level', 'Status', 'Actions'],
      doors.map(
        (door) => `<tr>
          <td>${door.id}</td>
          <td>${escapeHtml(door.name)}<div class="mono truncate">${escapeHtml(door.description)}</div></td>
          <td>${escapeHtml(door.kind)}</td>
          <td class="mono truncate">${escapeHtml(door.kind === 'builtin' ? door.builtin : `${door.command || ''} ${door.args || ''}`)}</td>
          <td class="mono">${escapeHtml(door.drop_file)}</td>
          <td>${door.pty ? 'yes' : 'no'}</td>
          <td>${door.timeout_seconds}s</td>
          <td>${door.min_level}</td>
          <td>${door.enabled ? '<span class="tag ok">enabled</span>' : '<span class="tag warn">off</span>'}</td>
          <td class="actions">
            <button class="small ghost" data-action="door-toggle" data-id="${door.id}" data-value="${door.enabled ? '0' : '1'}">${door.enabled ? 'Disable' : 'Enable'}</button>
            <button class="small danger" data-action="door-delete" data-id="${door.id}" data-name="${escapeHtml(door.name)}">Delete</button>
          </td>
        </tr>`
      ),
      'No doors configured.'
    );
  }

  // ── settings ────────────────────────────────────────────────────────────────
  const SETTINGS_FIELDS = [
    ['bbs_name', 'Board name', 'text'],
    ['tagline', 'Tagline', 'text'],
    ['motd', 'Message of the day', 'textarea'],
    ['splash_enabled', 'Splash screen before login', 'checkbox'],
    ['max_users', 'Maximum users', 'number'],
    ['min_password_length', 'Minimum password length', 'number'],
    ['max_post_length', 'Maximum post length', 'number'],
    ['download_cost', 'Download cost (credits)', 'number'],
    ['registration_open', 'Registration open', 'checkbox'],
    ['guest_enabled', 'Guest access', 'checkbox'],
    ['new_user_validation', 'New accounts require validation', 'checkbox'],
    ['chat_enabled', 'Chat room enabled', 'checkbox'],
    ['oneliners_enabled', 'One-liner wall enabled', 'checkbox'],
  ];

  async function loadSettings() {
    const { settings } = await api('/settings');
    const form = document.getElementById('settings-form');
    form.innerHTML =
      SETTINGS_FIELDS.map(([key, label, type]) => {
        if (type === 'checkbox') {
          const checked = settings[key] === '1' ? 'checked' : '';
          return `<label class="check"><input type="checkbox" name="${key}" ${checked}> ${escapeHtml(label)}</label>`;
        }
        if (type === 'textarea') {
          return `<label class="field wide"><span>${escapeHtml(label)}</span><textarea name="${key}" maxlength="2000">${escapeHtml(settings[key] || '')}</textarea></label>`;
        }
        return `<label class="field"><span>${escapeHtml(label)}</span><input type="${type}" name="${key}" value="${escapeHtml(settings[key] || '')}"></label>`;
      }).join('') + '<button type="submit" class="wide">Save settings</button>';
  }

  // ── audit ───────────────────────────────────────────────────────────────────
  async function loadAudit() {
    const { audit } = await api('/audit');
    document.getElementById('audit-table').innerHTML = table(
      ['#', 'When', 'User', 'Action', 'Detail', 'IP'],
      audit.map(
        (row) => `<tr>
          <td>${row.id}</td>
          <td class="mono">${date(row.created_at)}</td>
          <td>${row.user_id ?? '—'}</td>
          <td>${escapeHtml(row.action)}</td>
          <td class="truncate">${escapeHtml(row.detail)}</td>
          <td class="mono">${escapeHtml(row.ip)}</td>
        </tr>`
      ),
      'No audit entries.'
    );
  }

  const LOADERS = {
    dashboard: loadDashboard,
    users: () => loadUsers(document.getElementById('user-query').value.trim()),
    boards: loadBoards,
    files: loadFiles,
    oneliners: loadOneliners,
    chat: loadChat,
    doors: loadDoors,
    settings: loadSettings,
    audit: loadAudit,
  };

  // ── events ──────────────────────────────────────────────────────────────────
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    try {
      const data = await api('/login', {
        method: 'POST',
        body: {
          handle: document.getElementById('login-handle').value.trim(),
          password: document.getElementById('login-password').value,
        },
      });
      state.me = data.user;
      showApp();
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  document.getElementById('logout').addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      // cookie is being dropped either way
    }
    state.me = null;
    showLogin();
  });

  document.getElementById('nav').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (button) view(button.dataset.view);
  });

  document.getElementById('broadcast-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('broadcast-message');
    try {
      const result = await api('/broadcast', { method: 'POST', body: { message: input.value } });
      input.value = '';
      say(`Broadcast queued for ${result.online} session${result.online === 1 ? '' : 's'}.`);
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('user-search').addEventListener('submit', (event) => {
    event.preventDefault();
    loadUsers(document.getElementById('user-query').value.trim()).catch((err) => say(err.message, true));
  });

  document.getElementById('user-create').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await api('/users', {
        method: 'POST',
        body: {
          handle: form.handle.value.trim(),
          password: form.password.value,
          level: Number(form.level.value) || 10,
          validated: form.validated.checked,
        },
      });
      form.reset();
      form.level.value = '10';
      form.validated.checked = true;
      say(`Created ${result.user.handle}.`);
      await loadUsers('');
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('users-table').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    try {
      if (button.dataset.action === 'validate') await patchUser(id, { validated: button.dataset.value === '1' });
      else if (button.dataset.action === 'ban') await patchUser(id, { banned: button.dataset.value === '1' });
      else if (button.dataset.action === 'level') {
        const level = prompt('New level (0-100):', button.dataset.level);
        if (level !== null) await patchUser(id, { level: Number(level) });
      } else if (button.dataset.action === 'password') {
        const password = prompt('New password (min 6 characters):');
        if (password) await patchUser(id, { password });
      } else if (button.dataset.action === 'delete-user') {
        if (confirm(`Delete ${button.dataset.handle} and all of their posts and mail?`)) {
          await api(`/users/${id}`, { method: 'DELETE' });
          say('User deleted.');
          await loadUsers(document.getElementById('user-query').value.trim());
        }
      }
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('board-create').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await api('/boards', {
        method: 'POST',
        body: {
          name: form.name.value.trim(),
          description: form.description.value.trim(),
          minLevel: Number(form.minLevel.value) || 0,
          sortOrder: Number(form.sortOrder.value) || 100,
          readOnly: form.readOnly.checked,
        },
      });
      form.reset();
      form.sortOrder.value = '100';
      say(`Created board ${result.board.name}.`);
      await loadBoards();
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('boards-table').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    try {
      if (button.dataset.action === 'board-readonly') {
        await api(`/boards/${id}`, { method: 'PATCH', body: { readOnly: button.dataset.value === '1' } });
        say('Board updated.');
        await loadBoards();
      } else if (button.dataset.action === 'board-edit') {
        const name = prompt('Board name:', button.dataset.name);
        if (name === null) return;
        const description = prompt('Description:', button.dataset.description);
        if (description === null) return;
        const level = prompt('Minimum level:', button.dataset.level);
        if (level === null) return;
        await api(`/boards/${id}`, { method: 'PATCH', body: { name, description, minLevel: Number(level) || 0 } });
        say('Board updated.');
        await loadBoards();
      } else if (button.dataset.action === 'board-delete') {
        if (confirm(`Delete board ${button.dataset.name} and all of its posts?`)) {
          await api(`/boards/${id}`, { method: 'DELETE' });
          say('Board deleted.');
          await loadBoards();
        }
      } else if (button.dataset.action === 'post-delete') {
        if (confirm('Delete this post?')) {
          await api(`/posts/${id}`, { method: 'DELETE' });
          say('Post deleted.');
          await loadBoards();
        }
      }
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('area-create').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await api('/areas', {
        method: 'POST',
        body: {
          name: form.name.value.trim(),
          description: form.description.value.trim(),
          minLevel: Number(form.minLevel.value) || 0,
          sortOrder: Number(form.sortOrder.value) || 100,
        },
      });
      form.reset();
      form.sortOrder.value = '100';
      say(`Created area ${result.area.name}.`);
      await loadFiles();
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('files-table').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="file-delete"]');
    if (!button) return;
    if (!confirm(`Delete ${button.dataset.name} permanently?`)) return;
    try {
      await api(`/files/${button.dataset.id}`, { method: 'DELETE' });
      say('File deleted.');
      await loadFiles();
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('oneliners-table').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action="oneliner-delete"]');
    if (!button) return;
    if (!confirm('Delete this one-liner?')) return;
    try {
      await api(`/oneliners/${button.dataset.id}`, { method: 'DELETE' });
      say('One-liner deleted.');
      await loadOneliners();
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('clear-chat').addEventListener('click', async () => {
    if (!confirm('Clear all retained chat history?')) return;
    try {
      const result = await api('/chat', { method: 'DELETE' });
      say(`Cleared ${result.cleared} chat lines.`);
      await loadChat();
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('door-create').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    let args;
    try {
      args = JSON.parse(form.args.value || '[]');
      if (!Array.isArray(args)) throw new Error('Arguments must be a JSON array.');
    } catch (err) {
      say(`Arguments: ${err.message}`, true);
      return;
    }
    try {
      const result = await api('/doors', {
        method: 'POST',
        body: {
          name: form.name.value.trim(),
          description: form.description.value.trim(),
          kind: form.kind.value,
          builtin: form.builtin.value,
          command: form.command.value.trim(),
          args,
          dropFile: form.dropFile.value,
          pty: form.pty.checked,
          timeoutSeconds: Number(form.timeoutSeconds.value) || 900,
          minLevel: Number(form.minLevel.value) || 10,
          enabled: form.enabled.checked,
        },
      });
      form.reset();
      form.args.value = '[]';
      form.timeoutSeconds.value = '900';
      form.pty.checked = true;
      form.enabled.checked = true;
      say(`Created door ${result.door.name}.`);
      await loadDoors();
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('doors-table').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    try {
      if (button.dataset.action === 'door-toggle') {
        await api(`/doors/${button.dataset.id}`, { method: 'PATCH', body: { enabled: button.dataset.value === '1' } });
        say('Door updated.');
        await loadDoors();
      } else if (button.dataset.action === 'door-delete') {
        if (confirm(`Delete door ${button.dataset.name}?`)) {
          await api(`/doors/${button.dataset.id}`, { method: 'DELETE' });
          say('Door deleted.');
          await loadDoors();
        }
      }
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {};
    for (const [key, , type] of SETTINGS_FIELDS) {
      const field = form.elements[key];
      if (!field) continue;
      payload[key] = type === 'checkbox' ? (field.checked ? '1' : '0') : field.value;
    }
    try {
      const result = await api('/settings', { method: 'PUT', body: payload });
      brandName.textContent = result.settings.bbs_name || 'BBS';
      say('Settings saved. New sessions pick them up immediately.');
    } catch (err) {
      say(err.message, true);
    }
  });

  async function boot() {
    try {
      const data = await api('/me');
      state.me = data.user;
      showApp();
    } catch {
      showLogin();
    }
  }

  boot();
})();
