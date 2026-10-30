# DEADPLUG BBS

A classic ANSI bulletin board system for the modern internet. One board, three
doors in: **telnet**, **SSH**, and a **web terminal** in the browser. Message
boards, private mail, a live chat room, one-liners, a files area, door games and
a full sysop admin panel — backed by a single SQLite file, no external services.

The interface is built for the 1990s warez scene: a splash screen with the board
ad greets callers before the login prompt, the name is a block-letter logo
painted with a cyan-to-magenta gradient, menus use dotted leaders, greetz lines
run under them, and hanging up shows a `CARRIER LOST` plate. Every board carries
its own heading palette, and scene art posted in a message is rendered verbatim
instead of being re-wrapped. It degrades cleanly — ANSI-off accounts get the same
layout with plain text, and the splash can be switched off in the admin panel.

```
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
█  ████  █████  ███  ████  ████  █     █   █  ████       ████  ████   ████   █
█  █   █ █▓▓▓▓▓█   █ █   █ █   █ █▓    █▓  █▓█ ▓▓▓▓      █   █ █   █ █ ▓▓▓▓  █
█  █   █▓████  █████▓█   █▓████ ▓█▓    █▓  █▓█▓ ██       ████ ▓████ ▓ ███    █
█  █   █▓█▓▓▓▓ █▓▓▓█▓█   █▓█▓▓▓▓ █▓    █▓  █▓█▓  █▓      █   █ █   █   ▓▓█   █
█  ████ ▓█████ █▓  █▓████ ▓█▓    █████  ███ ▓ ███ ▓      ████ ▓████ ▓████ ▓  █
█   ▓▓▓▓  ▓▓▓▓▓ ▓   ▓ ▓▓▓▓  ▓     ▓▓▓▓▓  ▓▓▓   ▓▓▓        ▓▓▓▓  ▓▓▓▓  ▓▓▓▓   █
█                                                                            █
█                    ·=[ Where the signal never dies ]=·                     █
█                                                                            █
█                     telnet 2323 · ssh 2222 · web 7683                      █
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

▄▄[ MAIN MENU ]▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ 1 online
  [B] Message Boards      ········································· 0 messages
  [M] Private Mail        ···························· guests cannot send mail
  [F] Files               ·································· upload / download
  [C] Chat Room           ·································· live conversation
  [O] One-liners          ··········································· the wall
  [G] Door Games          ························· blackjack, trivia, dungeon
  [W] Who's Online        ········································ 1 connected
  [U] User List           ····················································
  [S] Settings            ······························· profile and password
──────────────────────────────────────────────────────────────────────────────
  [Q] Log Off             ····················································
```

## Features

| Area | What you get |
| --- | --- |
| Message boards | Threads and replies, per-board read-only and minimum level, search, soft delete |
| Private mail | Inbox/sent, unread counts, live "new mail" notification, per-side delete |
| Chat | Live room with `/who`, `/me`, `/leave`, persisted scrollback, per-user cooldown |
| One-liners | Classic wall, 70 characters, rate limited, owner/sysop delete |
| Files | Areas, descriptions, download counts, credits cost, signed upload/download URLs |
| Doors | Built in blackjack, trivia and dungeon crawler, plus external DOS/Unix doors with drop files |
| Accounts | scrypt passwords, validation queue, bans, levels, credits, ANSI preference |
| Sysop | Web admin panel at `/admin`, plus an in-terminal sysop console |
| Transports | Telnet with IAC/NAWS negotiation, SSH with password or keyboard-interactive auth, WebSocket + xterm.js |

## Requirements

- **Node.js 22.13 or newer** (uses the built-in `node:sqlite` module; no native
  compile step, no `better-sqlite3`).
- Linux. The installer targets **Arch Linux** and other pacman systems; the
  server itself is distro-agnostic.
- `util-linux` for `/usr/bin/script` if you want external doors on a pty
  (present on essentially every Linux install).

## Quick start (from source)

```bash
npm install
node scripts/create-sysop.js --config ./config.json --handle sysop
npm start
```

With no `config.json` present the server starts on the defaults below and
creates `./data`. To keep a config file, write one first:

```json
{
  "bbsName": "DEADPLUG BBS",
  "host": "127.0.0.1",
  "webPort": 7683,
  "telnetPort": 2323,
  "sshPort": 2222,
  "dataDir": "./data",
  "sessionSecret": "replace-me-with-64-hex-characters",
  "publicUrl": "",
  "maxUploadBytes": 52428800,
  "idleTimeoutMinutes": 15,
  "maxSessionsPerIp": 6,
  "trustProxy": false
}
```

If `sessionSecret` is empty the server generates one and writes it back to the
config file, so admin cookies and file tokens survive restarts.

Then connect:

```bash
telnet localhost 2323
ssh -p 2222 sysop@localhost
xdg-open http://localhost:7683
```

The admin panel lives at <http://localhost:7683/admin> and uses the same
level-100 BBS account.

## Installing on Arch Linux

```bash
sudo ./install.sh
```

The installer is idempotent and non-interactive when asked. It will:

1. install `nodejs` and `npm` with pacman if Node is missing or older than 22.13,
2. create the system user and group `bbs`,
3. copy the code to `/opt/deadplug-bbs`,
4. run `npm ci --omit=dev`,
5. write `/etc/deadplug-bbs/config.json` (mode `0640`, random `sessionSecret`),
6. create the sysop account and print the generated password,
7. install and start a hardened `deadplug-bbs.service`,
8. poll `/health` until the board answers.

### Installer options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--prefix <dir>` | `/opt/deadplug-bbs` | Where the code is installed |
| `--data <dir>` | `/var/lib/deadplug-bbs` | Database, uploaded files, SSH host key |
| `--config <file>` | `/etc/deadplug-bbs/config.json` | Config file path |
| `--user <name>` | `bbs` | Service account |
| `--bind <addr>` | `127.0.0.1` | Listen address for all three transports |
| `--web-port <port>` | `7683` | Web terminal + admin panel |
| `--telnet-port <port>` | `2323` | Telnet |
| `--ssh-port <port>` | `2222` | SSH |
| `--public-url <url>` | `http://<bind>:<web-port>` | URL printed to users and embedded in upload/download links |
| `--trust-proxy` | off | Honour `X-Forwarded-For`; only behind your own proxy |
| `--sysop-handle <name>` | `sysop` | Initial sysop handle |
| `--sysop-password <pw>` | generated | Initial sysop password |
| `--reset-sysop` | off | Reset an existing sysop's password |
| `--non-interactive` | off | Never prompt |
| `--no-start` | off | Install the unit but do not enable/start it |
| `--yes` | off | Skip purge confirmation |
| `--uninstall` | — | Stop and remove the unit, keep data |
| `--uninstall --purge` | — | Also delete code, config, data and the `bbs` user |

Examples:

```bash
# public host behind nginx, no prompts
sudo ./install.sh --public-url https://bbs.example.net --trust-proxy --non-interactive

# bind everything directly, custom ports, don't start yet
sudo ./install.sh --bind 0.0.0.0 --web-port 8080 --telnet-port 23 --ssh-port 22 --no-start
```

### Installed layout

```
/opt/deadplug-bbs            code (root-owned, read-only to the service)
/etc/deadplug-bbs/config.json
/var/lib/deadplug-bbs/
  bbs.db                    SQLite database (WAL)
  files/                    uploaded files
  doors/                    drop-file scratch space
  ssh_host_rsa_key          generated on first SSH connection
```

## Using the board

First login offers three choices at the handle prompt:

- a handle you already registered,
- `NEW` to register (subject to the `registration_open` setting),
- `GUEST` to browse (subject to `guest_enabled`).

Main menu:

```
[B] Message Boards   [M] Private Mail   [F] Files      [C] Chat Room
[O] One-liners       [G] Door Games     [W] Who's Online [U] User List
[S] Settings         [A] Sysop Console (level 100 only)  [Q] Log Off
```

In line editors `Ctrl-C` cancels back to the previous menu, `Ctrl-U` clears the
line, backspace works, and long posts are terminated with a single `.` on its
own line. Arrow keys and other escape sequences are ignored rather than
inserted as garbage.

Posts and private mail may contain scene art — lines built from block and
box-drawing characters (`█ ░ ▒ ▓ ▄ ▀ ─ │ ┌ ┐` and friends) are printed exactly
as typed, at their original indentation, and truncated to the terminal width
rather than wrapped. Ordinary prose in the same message still wraps normally.

## Configuration

`config.json` holds infrastructure only — ports, paths, secrets, limits.
Anything a sysop might want to change at runtime lives in the `settings` table
and is edited from the admin panel without a restart.

| Key | Default | Notes |
| --- | --- | --- |
| `bbsName` | `DEADPLUG BBS` | Fallback only; the `bbs_name` setting wins once the database exists |
| `host` | `127.0.0.1` | Applies to web, telnet and SSH |
| `webPort` / `telnetPort` / `sshPort` | `7683` / `2323` / `2222` | Set a port to `0` to disable that transport (web is always on) |
| `dataDir` | `./data` | Relative paths resolve against the config file's directory |
| `sessionSecret` | generated | HMAC key for admin cookies and file tokens |
| `publicUrl` | derived | Public base URL used in links shown to users |
| `maxUploadBytes` | `52428800` | Upload ceiling in bytes |
| `idleTimeoutMinutes` | `15` | Idle sessions are disconnected |
| `maxSessionsPerIp` | `6` | Telnet and WebSocket connection cap per address |
| `trustProxy` | `false` | Trust `X-Forwarded-For`; enable only behind a proxy you control |
| `sshHostKey` | `dataDir/ssh_host_rsa_key` | Optional explicit path; a 3072-bit RSA key is generated if absent |

Runtime settings (admin panel → Settings, or the sysop console): `bbs_name`,
`tagline`, `motd`, `splash_enabled`, `registration_open`, `guest_enabled`,
`new_user_validation`, `max_users`, `min_password_length`, `download_cost`,
`max_post_length`, `chat_enabled`, `oneliners_enabled`.

Because `bbs_name` overrides `bbsName`, renaming the board is done in the admin
panel, not by editing the config file.

## Sysop administration

`/admin` is a small SPA that authenticates against BBS accounts with level 100.
The session cookie is `HttpOnly`, `SameSite=Strict`, signed with
`sessionSecret`, and lasts 12 hours. Every state-changing request must carry
`X-Requested-With: deadplug-bbs` (the panel does this for you), which blocks
cross-site form posts.

What you can do there:

- dashboard counts, online sessions, recent audit entries
- users: create, edit level/credits/profile, validate, ban, reset password, delete
- boards: create and delete; posts: browse and delete
- file areas: create and delete; files: browse and delete (removes the blob)
- one-liners and chat: moderate and clear
- doors: create, enable/disable, delete
- settings and broadcast to every connected session

The in-terminal `[A]` console covers the common cases (stats, validate, ban,
level, broadcast, toggles, audit) when you are already logged in over telnet.

## Files area

Uploads and downloads are plain HTTP, not ZMODEM. When a caller picks a file the
board prints a one-time signed URL valid for 15 minutes:

- `GET /upload/<token>` — drag-and-drop upload page
- `POST /api/upload/<token>` — the upload endpoint used by that page
- `GET /dl/<token>` — download

The token names the destination area (and, for downloads, the file), so users
never type a path and cannot traverse out of `dataDir/files`. Stored names are
random; the original filename is kept in the database for display. Uploads are
written to a temporary file and renamed into place only when complete, and
`maxUploadBytes` is enforced per request.

Set `download_cost` above zero to charge credits per download.

## Door games

Three doors are seeded and ready to play:

- **Blackjack** — wager credits against the dealer
- **Trivia** — multiple-choice questions for credits
- **Dungeon** — a small procedural crawl

High scores are kept in the `scores` table.

### External doors

Add a door in the admin panel with `kind = external`:

| Field | Example | Meaning |
| --- | --- | --- |
| `command` | `/opt/doors/lord/lord` | Executable, or a template with placeholders |
| `args` | `["/N%NODE%", "/D%DROPDIR%"]` | Array of arguments; placeholders are substituted |
| `dropFile` | `DOOR.SYS` | `DOOR.SYS`, `DORINFO1.DEF`, `CHAIN.TXT` or `none` |
| `pty` | on | Run under `/usr/bin/script -qefc` so the door sees a tty |
| `timeoutSeconds` | `900` | Wall-clock limit; the process is killed after it |
| `minLevel` | `10` | Minimum account level to see the door |

Placeholders available in `command` and `args`: `%DROPDIR%`, `%DROPFILE%`,
`%HANDLE%`, `%NODE%`, `%BBSNAME%`, `%LEVEL%`. The same values are exported as
`BBS_HANDLE`, `BBS_LEVEL`, `BBS_NODE`, `BBS_DROPDIR` and `BBS_DROPFILE`, with
`TERM=ansi` and the door's working directory set to the drop directory.

Each launch gets a fresh temporary directory under `dataDir/doors/tmp` which is
deleted when the door exits. Because the service unit runs with
`ProtectSystem=strict`, only `dataDir` is writable — install doors read-only
under `/opt/doors` and let them write inside their drop directory.

Notes for DOS doors: run them under DOSBox or a similar wrapper and point
`command` at that wrapper. `PrivateDevices` is deliberately **not** enabled in
the unit so pty allocation keeps working.

## Reverse proxy

The default bind is `127.0.0.1`, which is the right choice when a proxy sits in
front. Web and telnet/SSH need different nginx blocks: HTTP and WebSocket use
`server`, raw TCP uses `stream`.

```nginx
# /etc/nginx/conf.d/deadplug.conf
server {
    listen 443 ssl http2;
    server_name bbs.example.net;

    ssl_certificate     /etc/letsencrypt/live/bbs.example.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bbs.example.net/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7683;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:7683;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```

```nginx
# /etc/nginx/nginx.conf — top level, next to http {}
stream {
    server {
        listen 2323;
        proxy_pass 127.0.0.1:2323;
    }
    server {
        listen 2222;
        proxy_pass 127.0.0.1:2222;
    }
}
```

Then set `publicUrl` to `https://bbs.example.net` and `trustProxy` to `true`
in the config (the installer's `--public-url` and `--trust-proxy` flags do
this), and restart the service. Without `trustProxy` every web session appears
to come from `127.0.0.1`, which breaks the per-IP session cap.

Caddy equivalent for the web side:

```
bbs.example.net {
    reverse_proxy 127.0.0.1:7683
}
```

Caddy handles the WebSocket upgrade automatically. Telnet and SSH still need a
TCP-level proxy (`stream` block, HAProxy, or a firewall DNAT).

## Backup and restore

Everything that matters is in two places:

```
/var/lib/deadplug-bbs/     database, uploads, SSH host key
/etc/deadplug-bbs/config.json
```

For a consistent copy, stop the service first — the database runs in WAL mode:

```bash
sudo systemctl stop deadplug-bbs
sudo tar -C / -czf bbs-backup-$(date +%F).tar.gz \
    var/lib/deadplug-bbs etc/deadplug-bbs/config.json
sudo systemctl start deadplug-bbs
```

If you cannot stop it, use SQLite's own backup instead of copying the file:

```bash
sudo -u bbs sqlite3 /var/lib/deadplug-bbs/bbs.db ".backup '/tmp/bbs.db'"
```

To restore: stop the service, unpack over the same paths, then
`chown -R bbs:bbs /var/lib/deadplug-bbs` and start it again. Keeping
`ssh_host_rsa_key` avoids SSH host-key warnings for returning users; keeping
`sessionSecret` keeps existing admin cookies and unexpired file links valid.

## Security notes

- Passwords are hashed with scrypt (`N=16384, r=8, p=1`, 16-byte salt, 64-byte
  key) and compared in constant time. There is no plaintext anywhere.
- Handles `new`, `guest`, `admin`, `root`, `system` and `bbs` are reserved.
- Login attempts are limited per session; repeated failures drop the
  connection.
- Sessions idle out after `idleTimeoutMinutes`, and bans disconnect the user
  immediately from every transport.
- The admin cookie is HMAC-signed, `HttpOnly`, `SameSite=Strict`; CSRF is
  blocked by requiring a custom header on mutations.
- Upload and download URLs are HMAC-signed, scoped to one file or area, and
  expire after 15 minutes.
- The systemd unit runs unprivileged with `ProtectSystem=strict`,
  `ProtectHome=true`, `NoNewPrivileges=true`, `UMask=0077` and a single
  `ReadWritePaths` entry.
- **There is no built-in TLS.** Put the web port behind a TLS-terminating proxy
  and treat telnet as plaintext; SSH is already encrypted. Never expose the
  admin panel over plain HTTP on an untrusted network.

## Development

```bash
npm test          # node --test, 80 tests across db/auth/boards/mail/files/doors/chat/ansi/art/terminal
npm run dev       # node --watch server.js
```

Layout:

```
server.js              bootstrap: config, db, three transports, shutdown
lib/config.js          config file + CLI parsing, defaults, path resolution
lib/db.js              schema, seeds, settings, audit
lib/ansi.js            colour, measuring, wrapping, boxes — escape-sequence aware
lib/art.js             scene art: block logo, gradient banner, headings, menu rows, greetz
lib/auth.js            scrypt hashing, users, tokens
lib/terminal.js        transport-agnostic terminal: line editor, readKey, pager, door attach
lib/bbs.js             the board itself: login, menus, boards, mail, files, chat, sysop console
lib/boards.js          board/thread/post queries
lib/mail.js            private mail
lib/files.js           areas, uploads, downloads
lib/chat.js            chat and one-liners
lib/doors.js           door registry, drop files, external launcher
lib/games/*.js         blackjack, trivia, dungeon
lib/web.js             express app, xterm assets, upload/download routes, WebSocket
lib/admin.js           sysop JSON API
transports/telnet.js   IAC negotiation, NAWS, CR-NUL handling
transports/ssh.js      ssh2 server, host key generation, pty handling
transports/websocket.js
public/                xterm.js front end, upload page, admin panel
scripts/create-sysop.js
install.sh             Arch installer / uninstaller
```

To reset a forgotten sysop password on an installed board:

```bash
sudo -u bbs node /opt/deadplug-bbs/scripts/create-sysop.js \
    --config /etc/deadplug-bbs/config.json --handle sysop --reset
```

It prints the new password. Pass `--password` to choose one instead.

## Uninstall

```bash
sudo ./install.sh --uninstall            # stop and remove the unit, keep data
sudo ./install.sh --uninstall --purge    # also remove code, config, data and the bbs user
```

## Troubleshooting

**`node:sqlite` is not available** — Node is older than 22.13. Check with
`node --version`; the installer upgrades it via pacman.

**Service exits immediately** — `journalctl -u deadplug-bbs -n 50`. The usual
cause is a port already in use or an unreadable config file.

**Ports unreachable but `/health` is fine locally** — the default bind is
`127.0.0.1`. Either proxy the ports or reinstall with `--bind 0.0.0.0` and
firewall them deliberately.

**Web terminal connects but the admin panel logs out constantly** — the
`sessionSecret` changed, typically because the config was regenerated. Keep
the config file across reinstalls.

**An external door fails to start** — check that `command` is an absolute path
and executable by the `bbs` user, that `/usr/bin/script` exists, and that the
door writes only inside its drop directory. Errors are printed into the
caller's terminal as `*** Door error: ... ***`.

**SSH host key warnings after a reinstall** — `dataDir/ssh_host_rsa_key` was not
preserved. Delete the client's old key with `ssh-keygen -R "[host]:2222"` or
restore the key file from backup.
