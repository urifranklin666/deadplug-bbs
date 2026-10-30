#!/usr/bin/env bash
#
# Deadplug BBS installer for Arch Linux (and Arch-like) systems.
#
#   ./install.sh                       install, create sysop, start service
#   ./install.sh --uninstall           stop and remove the service, keep data
#   ./install.sh --uninstall --purge   also delete code, config and all data
#
set -euo pipefail

SERVICE_NAME="deadplug-bbs"
PREFIX="/opt/deadplug-bbs"
DATA_DIR="/var/lib/deadplug-bbs"
CONFIG_DIR="/etc/deadplug-bbs"
CONFIG_FILE="${CONFIG_DIR}/config.json"
BBS_USER="bbs"
BBS_GROUP="bbs"
BIND_HOST="127.0.0.1"
WEB_PORT="7683"
TELNET_PORT="2323"
SSH_PORT="2222"
PUBLIC_URL=""
TRUST_PROXY="false"
SYSOP_HANDLE="sysop"
SYSOP_PASSWORD=""
NONINTERACTIVE=0
NO_START=0
UNINSTALL=0
PURGE=0
RESET_SYSOP=0
ASSUME_YES=0

SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Deadplug BBS installer

Options:
  --prefix <dir>         Install code here            (default: /opt/deadplug-bbs)
  --data <dir>           Runtime data and database    (default: /var/lib/deadplug-bbs)
  --config <file>        Config file                  (default: /etc/deadplug-bbs/config.json)
  --user <name>          Service account              (default: bbs)
  --bind <address>       Bind address                 (default: 127.0.0.1)
  --web-port <port>      Web terminal / admin port    (default: 7683)
  --telnet-port <port>   Telnet port                  (default: 2323)
  --ssh-port <port>      SSH port                     (default: 2222)
  --public-url <url>     URL users should open        (default: http://<bind>:<web-port>)
  --trust-proxy          Trust X-Forwarded-For (only behind a reverse proxy)
  --sysop-handle <name>  Initial sysop handle         (default: sysop)
  --sysop-password <pw>  Initial sysop password       (default: generated)
  --reset-sysop          Reset an existing sysop password
  --non-interactive      Never prompt
  --no-start             Install but do not start/enable the service
  --yes                  Skip confirmation prompts
  --uninstall            Stop and remove the service (data is kept)
  --purge                With --uninstall: remove code, config and data
  --help                 Show this help

Examples:
  sudo ./install.sh --public-url https://bbs.example.net
  sudo ./install.sh --bind 0.0.0.0 --web-port 8080 --no-start
  sudo ./install.sh --uninstall --purge --yes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="${2:?}"; shift 2 ;;
    --data) DATA_DIR="${2:?}"; shift 2 ;;
    --config) CONFIG_FILE="${2:?}"; CONFIG_DIR="$(dirname -- "$CONFIG_FILE")"; shift 2 ;;
    --user) BBS_USER="${2:?}"; shift 2 ;;
    --bind) BIND_HOST="${2:?}"; shift 2 ;;
    --web-port) WEB_PORT="${2:?}"; shift 2 ;;
    --telnet-port) TELNET_PORT="${2:?}"; shift 2 ;;
    --ssh-port) SSH_PORT="${2:?}"; shift 2 ;;
    --public-url) PUBLIC_URL="${2:?}"; shift 2 ;;
    --trust-proxy) TRUST_PROXY="true"; shift ;;
    --sysop-handle) SYSOP_HANDLE="${2:?}"; shift 2 ;;
    --sysop-password) SYSOP_PASSWORD="${2:?}"; shift 2 ;;
    --reset-sysop) RESET_SYSOP=1; shift ;;
    --non-interactive) NONINTERACTIVE=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Run this installer as root (sudo ./install.sh)."
}

require_systemd() {
  [[ -d /run/systemd/system ]] || die "systemd is not running on this host. This installer needs systemd."
  command -v systemctl >/dev/null 2>&1 || die "systemctl not found."
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' >/dev/null 2>&1
}

ensure_node() {
  if node_ok; then
    say "Node.js $(node --version) found at $(command -v node)"
    return
  fi
  if command -v pacman >/dev/null 2>&1; then
    if [[ "$NONINTERACTIVE" -eq 1 ]]; then
      say "Installing nodejs and npm with pacman"
      pacman -S --needed --noconfirm nodejs npm
    else
      read -r -p "Node.js 22.13+ is required. Install nodejs and npm with pacman now? [Y/n] " reply
      case "${reply:-Y}" in
        [Yy]*|"") pacman -S --needed --noconfirm nodejs npm ;;
        *) die "Install Node.js 22.13 or newer and run the installer again." ;;
      esac
    fi
  else
    die "Node.js 22.13+ is required. Install it with your package manager and run the installer again."
  fi
  node_ok || die "Node.js is still older than 22.13. Upgrade Node.js and retry."
}

ensure_user() {
  if ! getent group "$BBS_GROUP" >/dev/null 2>&1; then
    groupadd --system "$BBS_GROUP"
    say "Created group ${BBS_GROUP}"
  fi
  if ! id -u "$BBS_USER" >/dev/null 2>&1; then
    local shell
    shell="$(command -v nologin || echo /usr/bin/nologin)"
    useradd --system --gid "$BBS_GROUP" --home-dir "$DATA_DIR" --shell "$shell" "$BBS_USER"
    say "Created system user ${BBS_USER}"
  fi
}

copy_files() {
  say "Installing code into ${PREFIX}"
  install -d -m 0755 "$PREFIX"
  tar -C "$SRC_DIR" -cf - \
    --exclude=./node_modules \
    --exclude=./.git \
    --exclude=./data \
    --exclude=./config.json \
    --exclude='*.db' \
    --exclude='*.db-wal' \
    --exclude='*.db-shm' \
    . | tar -C "$PREFIX" -xf -
}

install_dependencies() {
  command -v npm >/dev/null 2>&1 || die "npm not found. Install npm."
  say "Installing production dependencies"
  if [[ -f "${PREFIX}/package-lock.json" ]]; then
    (cd "$PREFIX" && npm ci --omit=dev --no-audit --no-fund)
  else
    (cd "$PREFIX" && npm install --omit=dev --no-audit --no-fund)
  fi
}

generate_config() {
  install -d -m 0750 -o "$BBS_USER" -g "$BBS_GROUP" "$CONFIG_DIR" "$DATA_DIR"
  if [[ -f "$CONFIG_FILE" ]]; then
    say "Keeping existing config ${CONFIG_FILE}"
    return
  fi
  say "Writing ${CONFIG_FILE}"
  local secret
  secret="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  CONFIG_PATH="$CONFIG_FILE" \
  BBS_DATA_DIR="$DATA_DIR" \
  BBS_HOST="$BIND_HOST" \
  BBS_WEB_PORT="$WEB_PORT" \
  BBS_TELNET_PORT="$TELNET_PORT" \
  BBS_SSH_PORT="$SSH_PORT" \
  BBS_PUBLIC_URL="$PUBLIC_URL" \
  BBS_TRUST_PROXY="$TRUST_PROXY" \
  BBS_SECRET="$secret" \
  node -e '
    const fs = require("node:fs");
    const config = {
      bbsName: "DEADPLUG BBS",
      host: process.env.BBS_HOST,
      webPort: Number(process.env.BBS_WEB_PORT),
      telnetPort: Number(process.env.BBS_TELNET_PORT),
      sshPort: Number(process.env.BBS_SSH_PORT),
      dataDir: process.env.BBS_DATA_DIR,
      sessionSecret: process.env.BBS_SECRET,
      publicUrl: process.env.BBS_PUBLIC_URL || "",
      maxUploadBytes: 52428800,
      idleTimeoutMinutes: 15,
      maxSessionsPerIp: 6,
      trustProxy: process.env.BBS_TRUST_PROXY === "true"
    };
    fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  '
  chown root:"$BBS_GROUP" "$CONFIG_FILE"
  chmod 0640 "$CONFIG_FILE"
}

create_sysop() {
  if [[ -f "${DATA_DIR}/bbs.db" && "$RESET_SYSOP" -eq 0 ]]; then
    say "Existing database found; sysop account left untouched"
    return
  fi

  if [[ -z "$SYSOP_PASSWORD" && "$NONINTERACTIVE" -eq 0 ]]; then
    if [[ ! -f "${DATA_DIR}/bbs.db" ]]; then
      read -r -p "Initial sysop handle [${SYSOP_HANDLE}]: " reply
      SYSOP_HANDLE="${reply:-$SYSOP_HANDLE}"
    fi
    while true; do
      read -r -s -p "Initial sysop password (leave blank to generate): " first
      printf '\n'
      if [[ -z "$first" ]]; then break; fi
      read -r -s -p "Repeat password: " second
      printf '\n'
      if [[ "$first" == "$second" ]]; then
        SYSOP_PASSWORD="$first"
        break
      fi
      warn "Passwords do not match. Try again."
    done
  fi

  say "Creating or updating the sysop account"
  local args=(--config "$CONFIG_FILE" --handle "$SYSOP_HANDLE")
  if [[ -n "$SYSOP_PASSWORD" ]]; then
    args+=(--password "$SYSOP_PASSWORD")
  fi
  if [[ "$RESET_SYSOP" -eq 1 ]]; then
    args+=(--reset)
  fi
  runuser -u "$BBS_USER" -- node "${PREFIX}/scripts/create-sysop.js" "${args[@]}"
}

set_permissions() {
  say "Setting ownership and permissions"
  chown -R "$BBS_USER":"$BBS_GROUP" "$PREFIX" "$DATA_DIR"
  chmod 0750 "$DATA_DIR"
  find "$PREFIX" -type d -exec chmod 0755 {} +
  find "$PREFIX" -type f -exec chmod 0644 {} +
  chmod 0755 "$PREFIX/install.sh" 2>/dev/null || true
  install -d -m 0700 -o "$BBS_USER" -g "$BBS_GROUP" "${DATA_DIR}/files" "${DATA_DIR}/doors"
}

write_unit() {
  local node_bin
  node_bin="$(command -v node)"
  local unit="/etc/systemd/system/${SERVICE_NAME}.service"
  say "Writing ${unit}"
  cat > "$unit" <<UNIT
[Unit]
Description=Deadplug BBS (ANSI bulletin board over telnet, SSH and web)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${BBS_USER}
Group=${BBS_GROUP}
WorkingDirectory=${PREFIX}
ExecStart=${node_bin} ${PREFIX}/server.js --config ${CONFIG_FILE}
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
UMask=0077
LimitNOFILE=8192

# Hardening. Doors run inside the data directory; nothing else is writable.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
UNIT
  chmod 0644 "$unit"
}

start_service() {
  systemctl daemon-reload
  if [[ "$NO_START" -eq 1 ]]; then
    warn "Service installed but not started (--no-start)."
    return
  fi
  systemctl enable --now "${SERVICE_NAME}.service"

  say "Waiting for the board to answer"
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS "http://${BIND_HOST}:${WEB_PORT}/health" >/dev/null 2>&1; then
      say "Board is up"
      return
    fi
    if ! systemctl is-active --quiet "${SERVICE_NAME}.service"; then
      break
    fi
    sleep 1
  done
  warn "The service did not answer its health check."
  systemctl --no-pager --full status "${SERVICE_NAME}.service" || true
  journalctl -u "${SERVICE_NAME}.service" -n 40 --no-pager || true
  die "Installation finished but the service failed to start."
}

summary() {
  local shown_url="${PUBLIC_URL:-http://${BIND_HOST}:${WEB_PORT}}"
  if [[ "$BIND_HOST" == "0.0.0.0" && -z "$PUBLIC_URL" ]]; then
    shown_url="http://<server-address>:${WEB_PORT}"
  fi
  cat <<EOF

────────────────────────────────────────────────────────────
 Deadplug BBS is installed.

   Web terminal : ${shown_url}
   Admin panel  : ${shown_url}/admin
   Telnet       : ${BIND_HOST}:${TELNET_PORT}
   SSH          : ssh -p ${SSH_PORT} <handle>@${BIND_HOST}

   Code         : ${PREFIX}
   Data         : ${DATA_DIR}
   Config       : ${CONFIG_FILE}
   Service      : systemctl status ${SERVICE_NAME}

 The board binds to ${BIND_HOST} by default. For remote users,
 forward these ports or put the web port behind a reverse proxy.
 If you use a proxy, update publicUrl in the config and restart,
 and only then enable trustProxy.

 Read README.md for reverse proxy, door game and backup notes.
────────────────────────────────────────────────────────────
EOF
}

do_uninstall() {
  require_root
  if [[ "$PURGE" -eq 1 && "$ASSUME_YES" -eq 0 ]]; then
    warn "This will permanently delete ${PREFIX}, ${DATA_DIR} and ${CONFIG_FILE}, including all users, posts and files."
    read -r -p "Type PURGE to continue: " reply
    [[ "$reply" == "PURGE" ]] || die "Aborted."
  fi
  say "Stopping ${SERVICE_NAME}"
  systemctl disable --now "${SERVICE_NAME}.service" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  if [[ "$PURGE" -eq 1 ]]; then
    say "Removing code, config and data"
    rm -rf "$PREFIX" "$DATA_DIR" "$CONFIG_DIR"
    if id -u "$BBS_USER" >/dev/null 2>&1; then
      userdel "$BBS_USER" 2>/dev/null || true
    fi
    say "Purged."
  else
    say "Service removed. Data kept in ${DATA_DIR} and ${CONFIG_FILE}."
    say "Run with --purge to delete everything."
  fi
}

if [[ "$UNINSTALL" -eq 1 ]]; then
  do_uninstall
  exit 0
fi

require_root
require_systemd
ensure_node
ensure_user
copy_files
install_dependencies
generate_config
create_sysop
set_permissions
write_unit
start_service
summary
