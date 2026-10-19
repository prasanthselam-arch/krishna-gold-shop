# Requirement check and auto-install, driven by requirements.txt. Sourced by run.sh.
# Expects ok/warn/die and colour variables from run.sh, and the project folder as the cwd.

REQ_FILE=${REQ_FILE:-requirements.txt}
NVM_VERSION=v0.40.3
DEPS_STAMP=node_modules/.kgs-deps
DRY_RUN=${DRY_RUN:-0}

load_nvm() {
  export NVM_DIR=${NVM_DIR:-$HOME/.nvm}
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" --no-use
    nvm use --silent default >/dev/null 2>&1 || true
  fi
}

run_cmd() {
  echo "  \$ $*"
  [ "$DRY_RUN" = 1 ] && return 0
  "$@"
}

version_of() {
  "$1" --version 2>&1 | grep -oE '[0-9]+(\.[0-9]+)+' | head -1
}

# true when $1 >= $2
version_ge() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

pkg_manager() {
  local m
  for m in apt-get dnf yum pacman zypper brew; do
    command -v "$m" >/dev/null 2>&1 && { echo "${m%-get}"; return; }
  done
}

as_root() {
  if [ "$(id -u)" = 0 ] || [ "$1" = brew ]; then
    shift
    run_cmd "$@"
  elif command -v sudo >/dev/null 2>&1; then
    shift
    if [ "$DRY_RUN" != 1 ] && ! sudo -n true 2>/dev/null; then
      [ -t 0 ] || die "Administrator rights needed. Run: sudo $*"
      echo "  (your password is needed to install system packages)"
    fi
    run_cmd sudo "$@"
  else
    shift
    die "Cannot install system packages without sudo. Ask an administrator to run: $*"
  fi
}

install_system_packages() {
  local pm=$1; shift
  [ $# -eq 0 ] && return 0
  echo "Installing system packages with $pm: $*"
  case $pm in
    apt)    as_root apt env DEBIAN_FRONTEND=noninteractive apt-get update -qq &&
            as_root apt env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" ;;
    dnf)    as_root dnf dnf install -y "$@" ;;
    yum)    as_root yum yum install -y "$@" ;;
    pacman) as_root pacman pacman -S --needed --noconfirm "$@" ;;
    zypper) as_root zypper zypper --non-interactive install "$@" ;;
    brew)   as_root brew brew install "$@" ;;
  esac
}

install_node() {
  local major=$1
  load_nvm
  echo "Installing Node.js $major with nvm (into $NVM_DIR, no sudo needed)…"
  if ! command -v nvm >/dev/null 2>&1; then
    command -v curl >/dev/null 2>&1 || die "curl is needed to download nvm."
    if [ "$DRY_RUN" = 1 ]; then
      echo "  \$ curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh | bash"
    else
      curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | PROFILE=/dev/null bash >/dev/null ||
        die "Could not download nvm. Check the internet connection (or proxy certificate)."
      load_nvm
    fi
  fi
  run_cmd nvm install "$major" || die "Node.js install failed."
  run_cmd nvm alias default "$major"
  if [ "$DRY_RUN" != 1 ] && ! grep -qs 'NVM_DIR' "$HOME/.bashrc"; then
    printf '\nexport NVM_DIR="$HOME/.nvm"\n[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"\n' >>"$HOME/.bashrc"
  fi
}

# Fills REQ_* arrays from requirements.txt.
read_requirements() {
  REQ_CMD=(); REQ_MIN=(); REQ_OPT=(); REQ_INST=(); REQ_NOTE=()
  [ -f "$REQ_FILE" ] || die "$REQ_FILE not found."
  local line body note cmd min rest
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    body=${line%%#*}
    note=""
    [[ $line == *"#"* ]] && note=$(echo "${line#*#}" | sed 's/^ *//')
    read -r cmd min rest <<<"$body"
    REQ_OPT+=("$([ "${cmd:0:1}" = "?" ] && echo 1 || echo 0)")
    REQ_CMD+=("${cmd#\?}")
    REQ_MIN+=("${min:--}")
    REQ_INST+=("$rest")
    REQ_NOTE+=("$note")
  done <"$REQ_FILE"
}

installer_for() {
  local spec=$1 pm=$2 tok
  for tok in $spec; do
    [ "${tok%%:*}" = nvm ] && { echo "$tok"; return; }
  done
  for tok in $spec; do
    [ "${tok%%:*}" = "$pm" ] && { echo "$tok"; return; }
  done
}

# Prints a status table. Sets MISSING_REQ / MISSING_OPT to indexes of unmet requirements.
check_tools() {
  local quiet=${1:-0} i cmd min have status
  MISSING_REQ=(); MISSING_OPT=()
  load_nvm
  for i in "${!REQ_CMD[@]}"; do
    cmd=${REQ_CMD[$i]}; min=${REQ_MIN[$i]}
    if ! command -v "$cmd" >/dev/null 2>&1; then
      have="missing"; status=bad
    else
      have=$(version_of "$cmd"); have=${have:-found}
      if [ "$min" != "-" ] && [ "$have" != found ] && ! version_ge "$have" "$min"; then
        status=old
      else
        status=ok
      fi
    fi
    if [ "$status" != ok ]; then
      if [ "${REQ_OPT[$i]}" = 1 ]; then MISSING_OPT+=("$i"); else MISSING_REQ+=("$i"); fi
    fi
    [ "$quiet" = 1 ] && continue
    local need; need=$([ "$min" = "-" ] && echo "any" || echo ">= $min")
    local mark
    case $status in
      ok)  mark="${G}✔${N}" ;;
      old) mark="${R}✖${N}"; have="$have (too old)" ;;
      bad) mark=$([ "${REQ_OPT[$i]}" = 1 ] && echo "${Y}–${N}" || echo "${R}✖${N}") ;;
    esac
    [ "${REQ_OPT[$i]}" = 1 ] && [ "$status" != ok ] && have="$have (optional)"
    printf "  %s %-9s %-10s %-22s %s\n" "$mark" "$cmd" "$need" "$have" "${REQ_NOTE[$i]}"
  done
}

install_tools() {
  local pm; pm=$(pkg_manager)
  local pkgs=() node_major="" i inst
  for i in "$@"; do
    inst=$(installer_for "${REQ_INST[$i]}" "$pm")
    case $inst in
      nvm:*) node_major=${inst#nvm:} ;;
      "")    die "Don't know how to install '${REQ_CMD[$i]}' with ${pm:-this system}. Please install it manually." ;;
      *)     pkgs+=("${inst#*:}") ;;
    esac
  done
  if [ ${#pkgs[@]} -gt 0 ]; then
    [ -n "$pm" ] || die "No supported package manager found. Install manually: ${pkgs[*]}"
    install_system_packages "$pm" $(printf '%s\n' "${pkgs[@]}" | sort -u) || die "System package install failed."
  fi
  [ -n "$node_major" ] && install_node "$node_major"
  hash -r
}

deps_fingerprint() {
  local sum
  local lock=package-lock.json
  [ -f "$lock" ] || lock=package.json
  sum=$( (cat "$lock"; node -p 'process.versions.modules + process.arch') |
    { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null || cksum; } | cut -d' ' -f1)
  echo "$sum"
}

deps_current() {
  [ -d node_modules ] || return 1
  if [ -f "$DEPS_STAMP" ]; then
    [ "$(cat "$DEPS_STAMP")" = "$(deps_fingerprint)" ]
    return
  fi
  # Installed before this check existed: accept it if npm sees a complete, valid tree.
  npm ls --depth=0 >/dev/null 2>&1 || return 1
  deps_fingerprint >"$DEPS_STAMP"
}

native_ok() {
  node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1
}

install_deps() {
  local log=logs/npm-install.log cmd=(npm ci --no-audit --no-fund)
  [ -f package-lock.json ] || cmd=(npm install --no-audit --no-fund)
  echo "Installing JavaScript packages (this can take a few minutes)…"
  echo "  \$ ${cmd[*]}"
  [ "$DRY_RUN" = 1 ] && return 0
  if ! "${cmd[@]}" >"$log" 2>&1; then
    tail -n 15 "$log"
    if grep -qE 'UNABLE_TO_GET_ISSUER_CERT|SELF_SIGNED_CERT|CERT_' "$log"; then
      warn "Your network replaces HTTPS certificates (company proxy such as Zscaler)."
      echo "  Save the proxy's root certificate as a .pem file and run:"
      echo "  export NODE_EXTRA_CA_CERTS=/path/to/root-ca.pem; ./run.sh setup"
    fi
    die "Package install failed. Full log: $log"
  fi
  deps_fingerprint >"$DEPS_STAMP"
}

# check: report only.  install: install anything missing.  auto: install, but stay quiet when all is fine.
ensure_requirements() {
  local mode=$1 failed=0
  read_requirements

  if [ "$mode" != auto ]; then echo "${B}System tools${N} ($REQ_FILE)"; fi
  check_tools "$([ "$mode" = auto ] && echo 1 || echo 0)"

  if [ ${#MISSING_REQ[@]} -gt 0 ]; then
    if [ "$mode" = check ]; then
      failed=1
    else
      [ "$mode" = auto ] && { echo "${B}Missing system tools:${N}"; check_tools 0 | grep -v "✔"; }
      install_tools "${MISSING_REQ[@]}"
      [ "$DRY_RUN" = 1 ] || { check_tools 1; [ ${#MISSING_REQ[@]} -eq 0 ] || die "Some requirements are still missing. Run ./run.sh check"; }
    fi
  fi
  if ! command -v node >/dev/null 2>&1; then
    [ "$DRY_RUN" = 1 ] && return 0
    if [ "$mode" = check ]; then
      echo
      warn "Node.js is missing. Run ${B}./run.sh setup${N} to install it."
      return 1
    fi
    die "Node.js is not available."
  fi

  [ "$mode" != auto ] && echo "${B}JavaScript packages${N} (package-lock.json)"
  if deps_current; then
    [ "$mode" != auto ] && echo "  ${G}✔${N} installed and up to date"
  elif [ "$mode" = check ]; then
    echo "  ${R}✖${N} $([ -d node_modules ] && echo "out of date (package-lock.json or Node.js version changed)" || echo "not installed")"
    failed=1
  else
    install_deps
  fi

  if [ "$DRY_RUN" != 1 ] && [ -d node_modules ]; then
    [ "$mode" != auto ] && echo "${B}Database module${N} (better-sqlite3)"
    if native_ok; then
      [ "$mode" != auto ] && echo "  ${G}✔${N} loads correctly"
    elif [ "$mode" = check ]; then
      echo "  ${R}✖${N} does not load on this machine (needs rebuild)"
      failed=1
    else
      warn "Database module needs to be compiled for this machine."
      [ ${#MISSING_OPT[@]} -gt 0 ] && install_tools "${MISSING_OPT[@]}"
      npm rebuild better-sqlite3 >logs/npm-rebuild.log 2>&1 || true
      native_ok || { tail -n 15 logs/npm-rebuild.log; die "Could not build better-sqlite3. Log: logs/npm-rebuild.log"; }
      ok "Database module built."
    fi
  fi

  if [ "$mode" = check ]; then
    echo
    if [ $failed = 1 ]; then warn "Something is missing. Run ${B}./run.sh setup${N} to install it."; return 1; fi
    ok "All requirements are met."
  elif [ "$mode" = install ]; then
    echo
    ok "Setup complete. Start with: ./run.sh start"
  fi
}
