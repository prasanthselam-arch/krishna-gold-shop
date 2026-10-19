#!/usr/bin/env bash
# Krishna Gold Shop server control. The server runs in the background; the terminal is not held.
#
#   ./run.sh start          start in production mode  -> http://localhost:8787
#   ./run.sh start dev      start in development mode -> http://localhost:5173 (auto-reload)
#   ./run.sh stop           stop the server
#   ./run.sh restart        restart (same mode as last start, or pass prod/dev)
#   ./run.sh status         show whether it is running
#   ./run.sh logs           show the last 100 log lines (logs -f to follow, Ctrl+C to exit)
#   ./run.sh build          rebuild the web app
#   ./run.sh backup         take a database backup now
set -euo pipefail
cd "$(dirname "$0")"

RUN_DIR=.run
LOG_DIR=logs
PID_FILE=$RUN_DIR/server.pid
MODE_FILE=$RUN_DIR/server.mode
LOG_FILE=$LOG_DIR/server.log
mkdir -p "$RUN_DIR" "$LOG_DIR"

if [ -t 1 ]; then
  G=$'\e[32m' R=$'\e[31m' Y=$'\e[33m' B=$'\e[1m' N=$'\e[0m'
else
  G="" R="" Y="" B="" N=""
fi
ok()   { echo "${G}✔${N} $*"; }
warn() { echo "${Y}!${N} $*"; }
die()  { echo "${R}✖${N} $*" >&2; exit 1; }

env_value() {
  [ -f .env ] && sed -n "s/^$1=//p" .env | tail -1 | tr -d '\r"' || true
}
PORT=${PORT:-$(env_value PORT)}
PORT=${PORT:-8787}
UI_PORT=${UI_PORT:-5173}
export PORT UI_PORT

pid()        { [ -f "$PID_FILE" ] && cat "$PID_FILE" || true; }
is_running() { local p; p=$(pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }
mode()       { [ -f "$MODE_FILE" ] && cat "$MODE_FILE" || echo prod; }
healthy()    { curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; }
port_busy()  { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }
app_url()    { [ "$(mode)" = dev ] && echo "http://localhost:$UI_PORT" || echo "http://localhost:$PORT"; }

prepare() {
  if [ ! -d node_modules ]; then
    echo "Installing packages (first time only)…"
    npm install --no-audit --no-fund
  fi
  if [ ! -f .env ]; then
    cp .env.example .env
    warn "Created .env from .env.example. Review it before going live."
  fi
}

needs_build() {
  [ ! -f dist/index.html ] && return 0
  [ -n "$(find client vite.config.ts package.json -newer dist/index.html -type f -print -quit)" ]
}

build() {
  echo "Building the web app…"
  npm run build >"$LOG_DIR/build.log" 2>&1 || { tail -n 30 "$LOG_DIR/build.log"; die "Build failed (full log: $LOG_DIR/build.log)."; }
  ok "Build complete."
}

rotate_log() {
  if [ -f "$LOG_FILE" ] && [ "$(stat -c %s "$LOG_FILE")" -gt $((10 * 1024 * 1024)) ]; then
    mv -f "$LOG_FILE" "$LOG_FILE.1"
  fi
}

start() {
  local want=${1:-prod}
  [ "$want" = prod ] || [ "$want" = dev ] || die "Unknown mode '$want'. Use: prod or dev."

  if is_running; then
    ok "Already running ($(mode) mode, PID $(pid)) at ${B}$(app_url)${N}"
    return 0
  fi
  rm -f "$PID_FILE"
  if port_busy "$PORT"; then
    die "Port $PORT is already in use by another program (maybe ./run.sh is still running in another terminal — press Ctrl+C there). Check with: ss -ltnp 'sport = :$PORT'"
  fi
  if [ "$want" = dev ] && port_busy "$UI_PORT"; then
    die "Port $UI_PORT is already in use. Stop the other program or set UI_PORT."
  fi

  prepare
  local cmd
  if [ "$want" = prod ]; then
    needs_build && build
    cmd=(node_modules/.bin/tsx server/index.ts)
    export NODE_ENV=production
  else
    cmd=(npm run dev)
  fi

  rotate_log
  echo "===== $(date '+%F %T') start ($want) =====" >>"$LOG_FILE"
  setsid nohup "${cmd[@]}" >>"$LOG_FILE" 2>&1 </dev/null &
  echo $! >"$PID_FILE"
  echo "$want" >"$MODE_FILE"

  printf "Starting Krishna Gold Shop (%s mode)" "$want"
  for _ in $(seq 1 40); do
    if ! is_running; then
      echo
      tail -n 20 "$LOG_FILE"
      rm -f "$PID_FILE"
      die "Server stopped during startup. Full log: $LOG_FILE"
    fi
    if healthy && { [ "$want" = prod ] || port_busy "$UI_PORT"; }; then
      echo
      ok "Running (PID $(pid)). Open ${B}$(app_url)${N}"
      echo "  Logs: ./run.sh logs     Stop: ./run.sh stop"
      return 0
    fi
    printf "."
    sleep 0.5
  done
  echo
  warn "Started (PID $(pid)) but not answering yet. Check: ./run.sh logs"
}

stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    if healthy; then
      warn "Not started by run.sh, but something is serving port $PORT (maybe ./run.sh in another terminal — press Ctrl+C there)."
    else
      ok "Not running."
    fi
    return 0
  fi
  local p; p=$(pid)
  printf "Stopping (PID %s)" "$p"
  kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$p" 2>/dev/null || break
    printf "."
    sleep 0.5
  done
  if kill -0 "$p" 2>/dev/null; then
    kill -KILL -- "-$p" 2>/dev/null || kill -KILL "$p" 2>/dev/null || true
    echo
    warn "Did not stop in time; forced it to stop."
  else
    echo
  fi
  rm -f "$PID_FILE"
  echo "===== $(date '+%F %T') stopped =====" >>"$LOG_FILE"
  ok "Stopped."
}

status() {
  if is_running; then
    local up; up=$(ps -o etime= -p "$(pid)" | tr -d ' ')
    ok "Running in $(mode) mode (PID $(pid), up $up)"
    echo "  URL:    $(app_url)"
    if healthy; then echo "  Health: ${G}OK${N}"; else echo "  Health: ${R}not responding${N} (see ./run.sh logs)"; fi
    echo "  Logs:   $LOG_FILE"
  elif healthy; then
    warn "Not started by run.sh, but a server is answering on port $PORT (maybe in another terminal)."
  else
    echo "${R}●${N} Stopped. Start with: ./run.sh start"
    return 3
  fi
}

logs() {
  [ -f "$LOG_FILE" ] || die "No log yet. Start the server first."
  if [ "${1:-}" = "-f" ]; then
    echo "Following $LOG_FILE (Ctrl+C to exit; the server keeps running)"
    tail -n 50 -f "$LOG_FILE"
  else
    tail -n 100 "$LOG_FILE"
  fi
}

backup() {
  prepare
  local file
  file=$(node_modules/.bin/tsx -e 'import("dotenv/config").then(() => import("./server/backup.ts")).then((m) => m.backupNow("manual")).then((f) => { console.log(f); process.exit(0); })') \
    || die "Backup failed."
  ok "Backup saved: $file"
}

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-help}" in
  start)   start "${2:-prod}" ;;
  stop)    stop ;;
  restart) want=${2:-$(mode)}; stop; start "$want" ;;
  status)  status ;;
  logs)    logs "${2:-}" ;;
  build)   prepare; build; is_running && [ "$(mode)" = prod ] && warn "Run ./run.sh restart to use the new build." || true ;;
  backup)  backup ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
