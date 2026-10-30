#!/usr/bin/env bash
# Deploy https://examples.jsudc.dev on digitalcube-production-websites, build-and-swap:
#   clone or fetch digital-cube/jsudc-example into $ROOT/src -> check out origin/main
#   -> npm ci -> npm run build -> db:migrate -> seed (new collections only)
#   -> frontend/dist to releases/<short sha> -> atomically repoint `current`
#   -> restart the jsudc-prod user unit -> /healthz through nginx -> every
#   postgres collection answers -> keep the last three releases.
# Idempotent: when releases/<short sha> already holds that commit and `current`
# points at it and the unit is up, nothing is rebuilt, migrated or restarted; the
# script only checks the site again.
# The unit (deploy/systemd/jsudc-prod.service) and the vhost
# (deploy/nginx/examples.jsudc.dev.conf) are symlinks into $ROOT/src, so a deploy
# that changes the vhost reloads nginx; --install links them the first time and
# creates the Postgres role and database.
# Works from any copy of the script (scp it to /tmp for the first run): it deploys
# what origin/main has, not the checkout it was started from. After the first run
# it lives in $ROOT/src/deploy/prod.sh.
#
# Usage: deploy/prod.sh [--install] [--ref <committish>] [--reset-seed] [--force]
set -euo pipefail

ROOT=/home/digital/sites/examples.jsudc.dev
SRC="$ROOT/src"
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
NODE_LINK="$ROOT/node" # -> the nvm bin dir; the unit's PATH and ExecStart go through it
REPO_URL=https://github.com/digital-cube/jsudc-example.git
SITE=examples.jsudc.dev
EXPECTED_HOST=digitalcube-production-websites
EXPECTED_USER=digital
UNIT=jsudc-prod
PORT=5100
DB_NAME=jsudc
DB_USER=jsudc
ENV_FILE="$SRC/backend/.env"
VHOST_SRC="$SRC/deploy/nginx/$SITE.conf"
VHOST_AVAILABLE="/etc/nginx/sites-available/$SITE"
VHOST_ENABLED="/etc/nginx/sites-enabled/$SITE"
UNIT_SRC="$SRC/deploy/systemd/$UNIT.service"
UNIT_DST="$HOME/.config/systemd/user/$UNIT.service"
KEEP=3

usage() {
  cat <<USAGE
Usage: deploy/prod.sh [--install] [--ref <committish>] [--reset-seed] [--force]

Runs ON $EXPECTED_HOST as $EXPECTED_USER. Builds https://$SITE from
$REPO_URL into $ROOT:
  src/                   the checkout (detached at origin/main), backend/.env lives here
  releases/<short sha>/  one built frontend/dist per commit, the last $KEEP kept
  current -> releases/…  what nginx serves, swapped atomically
  node -> ~/.nvm/…/bin   the Node the unit runs (newest installed v24)
then restarts the user unit $UNIT (Fastify on 127.0.0.1:$PORT), waits for
/healthz through nginx, POSTs /udc/collections and lists one row of every
postgres_jsonb collection, and checks https://$SITE/healthz through the edge.

  --install        the one-time steps, harmless to repeat: Postgres role and
                   database $DB_NAME with a generated password written to
                   src/backend/.env (mode 600), loginctl enable-linger, link the
                   unit and the vhost (the hand-written "coming soon" vhost is
                   kept as $VHOST_AVAILABLE.coming-soon), nginx -t, reload
  --ref <c>        deploy this committish instead of origin/main (a tag, a sha,
                   a branch fetched into src/); for a rollback or a pinned build
  --reset-seed     seed with --reset: every database collection goes back to its
                   schema.json (v1) and seed.json — edits made on the site are LOST
  --force          rebuild even when the release for this commit is already current
  -h, --help       this text

Exit codes: 0 deployed, 1 a step failed, 2 usage, 3 refused (root, another
host or user, missing tool, no backend/.env without --install), 5 the site
does not answer through nginx on this VM, 6 this VM answers but
https://$SITE does not (the edge).
USAGE
}

INSTALL=0
REF=origin/main
RESET_SEED=0
FORCE=0
while (($#)); do
  case "$1" in
    --install) INSTALL=1 ;;
    --ref)
      [[ $# -ge 2 && -n "$2" ]] || { echo "prod.sh: --ref needs a committish" >&2; exit 2; }
      REF="$2"
      shift
      ;;
    --reset-seed) RESET_SEED=1 ;;
    --force) FORCE=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "prod.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

die() { # die <exit code> <message...>
  local code="$1"
  shift
  echo "prod.sh: $*" >&2
  exit "$code"
}
step() { printf '\n==> %s\n' "$*"; }
sql() { sudo -n -u postgres psql -v ON_ERROR_STOP=1 -X -Atq "$@"; }

# Everything below is in functions, read whole before they run: when this script
# is $SRC/deploy/prod.sh, the checkout step rewrites it under a running bash.
main() {
  [[ $EUID -ne 0 ]] || die 3 "refusing to run as root — run it as $EXPECTED_USER"
  [[ "$(hostname)" == "$EXPECTED_HOST" ]] ||
    die 3 "refusing to run on $(hostname) — this script deploys production on $EXPECTED_HOST"
  [[ "$(id -un)" == "$EXPECTED_USER" ]] || die 3 "refusing to run as $(id -un) — the site belongs to $EXPECTED_USER"
  local tool
  for tool in git jq curl flock openssl sudo; do
    command -v "$tool" >/dev/null || die 3 "$tool is required (sudo apt install $tool)"
  done
  sudo -n true 2>/dev/null || die 3 "passwordless sudo is required (nginx, loginctl, psql as postgres)"
  # systemctl --user needs the user manager's runtime dir, also under a bare `ssh host cmd`.
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  # NODE_ENV=production would make npm ci skip the devDependencies the build (vite,
  # tsc) and the start script (tsx) need; the unit sets it for the backend itself.
  unset NODE_ENV

  mkdir -p "$ROOT" "$RELEASES"
  exec 9>"$ROOT/.deploy.lock"
  flock -n 9 || die 1 "another deploy of $SITE is running"

  step "node"
  pick_node
  export PATH="$NODE_LINK:$PATH"
  echo "    $NODE_LINK -> $(readlink "$NODE_LINK") ($(node --version), npm $(npm --version))"

  step "source ($SRC)"
  if [[ ! -d "$SRC/.git" ]]; then
    timeout 300 git clone --quiet "$REPO_URL" "$SRC"
  fi
  timeout 120 git -C "$SRC" fetch --quiet --prune origin
  git -C "$SRC" rev-parse --verify --quiet "$REF^{commit}" >/dev/null ||
    die 1 "no such commit: $REF (origin was fetched)"
  # sites-enabled and the unit link into this checkout: a commit without those files
  # would leave nginx a dangling include, and the next reload of any site would fail.
  local f
  for f in "deploy/nginx/$SITE.conf" "deploy/systemd/$UNIT.service"; do
    git -C "$SRC" cat-file -e "$REF:$f" 2>/dev/null ||
      die 1 "$REF has no $f, refusing to check it out"
  done
  local vhost_before="" vhost_after=""
  [[ -f "$VHOST_SRC" ]] && vhost_before="$(sha256sum <"$VHOST_SRC")"
  git -C "$SRC" checkout --quiet --force --detach "$REF"
  # -x also removes ignored files: keep the installed deps and the credentials.
  git -C "$SRC" clean --quiet -ffdx -e node_modules -e backend/.env
  [[ -f "$VHOST_SRC" ]] && vhost_after="$(sha256sum <"$VHOST_SRC")"
  local sha
  sha="$(git -C "$SRC" rev-parse --short=7 HEAD)"
  echo "    $REF at $sha: $(git -C "$SRC" log -1 --format=%s)"

  if ((INSTALL)); then
    step "install: postgres role and database $DB_NAME"
    install_db
    step "install: linger (the unit starts at boot)"
    if [[ "$(loginctl show-user "$EXPECTED_USER" -p Linger --value 2>/dev/null)" == "yes" ]]; then
      echo "    Linger=yes"
    else
      sudo -n loginctl enable-linger "$EXPECTED_USER"
      echo "    enabled"
    fi
  fi
  [[ -f "$ENV_FILE" ]] || die 3 "no $ENV_FILE — run deploy/prod.sh --install first"

  # A release is reused only when it was built from this very commit.
  local stamp release="$RELEASES/$sha" fresh=1
  stamp="commit=$(git -C "$SRC" rev-parse HEAD)"
  if ((!FORCE)) && [[ -f "$release/.release" && "$(cat "$release/.release")" == "$stamp" ]] &&
    [[ "$(readlink "$CURRENT" 2>/dev/null)" == "releases/$sha" ]] &&
    systemctl --user is-active --quiet "$UNIT"; then
    fresh=0
    step "build: releases/$sha is current and $UNIT is up — nothing to rebuild"
  fi

  if ((fresh)); then
    step "npm ci"
    (cd "$SRC" && timeout 600 npm ci --no-audit --no-fund --loglevel=error)
    # @jsudc/* come from npmjs.org already built; this builds the frontend.
    step "npm run build"
    (cd "$SRC" && timeout 600 npm run build)
    [[ -f "$SRC/frontend/dist/index.html" ]] || die 1 "the build left no frontend/dist/index.html"
    step "npm run db:migrate -w @jsudc/backend"
    (cd "$SRC" && timeout 120 npm run db:migrate -w @jsudc/backend)
  fi

  if ((RESET_SEED)); then
    step "npm run seed -- --reset"
    echo "WARNING: --reset-seed — every database collection is reseeded; edits made on the site are lost." >&2
    (cd "$SRC" && timeout 300 npm run seed -- --reset)
  elif ((fresh)); then
    step "npm run seed (new collections only)"
    (cd "$SRC" && timeout 300 npm run seed)
  fi

  if ((fresh)); then
    step "release releases/$sha"
    local next="$release.new"
    rm -rf "$next"
    cp -a "$SRC/frontend/dist" "$next"
    printf '%s\n' "$stamp" >"$next/.release"
    if [[ -e "$release" ]]; then
      # A rebuild of the same commit: serve .new while the old copy is replaced.
      swap "$sha.new"
      rm -rf "$release"
      cp -a "$next" "$release"
      swap "$sha"
      rm -rf "$next"
    else
      mv "$next" "$release"
    fi
    if [[ "$(readlink "$CURRENT" 2>/dev/null)" != "releases/$sha" ]]; then
      touch "$release"
      swap "$sha"
    fi
    echo "    current -> releases/$sha"

    step "systemd user unit $UNIT"
    install_unit
    timeout 60 systemctl --user restart "$UNIT"
    echo "    restarted"
  fi

  step "nginx vhost"
  if ((INSTALL)); then
    install_vhost
  elif [[ "$(readlink -f "$VHOST_ENABLED" 2>/dev/null)" != "$VHOST_SRC" ]]; then
    die 1 "$VHOST_ENABLED is not linked to $VHOST_SRC; run deploy/prod.sh --install"
  elif [[ "$vhost_before" != "$vhost_after" ]]; then
    sudo -n nginx -t
    sudo -n systemctl reload nginx
    echo "    the vhost changed, nginx reloaded"
  else
    echo "    unchanged"
  fi

  step "prune releases (keep $KEEP)"
  local old
  # newest first by the time each release became current; never the current one
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2- |
    tail -n +$((KEEP + 1)) | while read -r old; do
    [[ "$old" == "$RELEASES/$sha" ]] && continue
    echo "    removing releases/${old##*/}"
    rm -rf "$old"
  done

  check

  echo
  git -C "$SRC" log -1 --format='HEAD %h %s (%ci)'
  echo "prod.sh: https://$SITE serves $REF at $sha  (TLS at the edge; this VM answers on :80)"
}

# The bin dir of the newest nvm v24, or nothing.
newest_node24() {
  find "$HOME/.nvm/versions/node" -mindepth 1 -maxdepth 1 -type d -name 'v24.*' 2>/dev/null |
    sort -V | tail -n 1 | sed 's:$:/bin:'
}

# $NODE_LINK -> the newest installed nvm v24 (installs one when there is none).
pick_node() {
  local bin
  bin="$(newest_node24)"
  if [[ -z "$bin" || ! -x "$bin/node" ]]; then
    [[ -s "$HOME/.nvm/nvm.sh" ]] || die 1 "no Node 24 under ~/.nvm and no nvm to install one"
    echo "    no Node 24 under ~/.nvm — nvm install 24"
    # shellcheck source=/dev/null
    (. "$HOME/.nvm/nvm.sh" && timeout 600 nvm install 24 >/dev/null)
    bin="$(newest_node24)"
    [[ -n "$bin" && -x "$bin/node" ]] || die 1 "nvm install 24 left no node"
  fi
  if [[ "$(readlink "$NODE_LINK" 2>/dev/null)" != "$bin" ]]; then
    ln -sfn "$bin" "$ROOT/.node.tmp"
    mv -T "$ROOT/.node.tmp" "$NODE_LINK"
  fi
}

# Role $DB_USER and database $DB_NAME on the local server, the password in $ENV_FILE.
# An existing .env is kept; a missing one gets a fresh password set on the role.
install_db() {
  local have_role have_db pw
  have_role="$(sql -c "select 1 from pg_roles where rolname = '$DB_USER'")"
  have_db="$(sql -c "select 1 from pg_database where datname = '$DB_NAME'")"
  if [[ -f "$ENV_FILE" && "$have_role" == 1 ]]; then
    echo "    $ENV_FILE exists and role $DB_USER exists — kept"
  else
    pw="$(openssl rand -hex 24)"
    if [[ "$have_role" == 1 ]]; then
      echo "    role $DB_USER exists but $ENV_FILE is missing — new password"
      sql -c "alter role $DB_USER with login password '$pw'"
    else
      echo "    create role $DB_USER"
      sql -c "create role $DB_USER with login password '$pw'"
    fi
    (
      umask 077
      printf '# written by deploy/prod.sh --install on %s; read by the backend and drizzle-kit (backend/src/config.ts)\nDATABASE_URL=postgresql://%s:%s@127.0.0.1/%s\n' \
        "$(date -Is)" "$DB_USER" "$pw" "$DB_NAME" >"$ENV_FILE"
    )
    chmod 600 "$ENV_FILE"
    echo "    wrote $ENV_FILE (mode 600)"
  fi
  if [[ "$have_db" == 1 ]]; then
    echo "    database $DB_NAME exists"
  else
    echo "    create database $DB_NAME owner $DB_USER"
    sql -c "create database $DB_NAME owner $DB_USER"
  fi
  # datlocprovider is a "char": c = libc, i = ICU, b = builtin.
  local collation
  collation="$(sql -c "select datcollate || ' (provider ' || datlocprovider::text || ')' from pg_database where datname = '$DB_NAME'")" ||
    die 1 "cannot read the collation of $DB_NAME"
  echo "    collation: $collation"
}

# ~/.config/systemd/user/jsudc-prod.service -> $UNIT_SRC, enabled (started by the caller).
install_unit() {
  mkdir -p "$(dirname "$UNIT_DST")"
  if [[ -f "$UNIT_DST" && ! -L "$UNIT_DST" ]]; then
    echo "    $UNIT_DST is a regular file, keeping it as $UNIT_DST.bak"
    mv -f "$UNIT_DST" "$UNIT_DST.bak"
  fi
  ln -sfn "$UNIT_SRC" "$UNIT_DST"
  timeout 30 systemctl --user daemon-reload
  timeout 30 systemctl --user enable --quiet "$UNIT"
  echo "    $UNIT_DST -> $UNIT_SRC (enabled)"
}

# sites-available/examples.jsudc.dev -> $VHOST_SRC, sites-enabled -> sites-available.
# The hand-written "coming soon" vhost that was there stays beside it as
# $VHOST_AVAILABLE.coming-soon (nginx includes only sites-enabled/*); its page in
# /var/www/examples.jsudc.dev is not touched.
install_vhost() {
  [[ -f "$VHOST_SRC" ]] || die 1 "no $VHOST_SRC in the checkout"
  if [[ -f "$VHOST_AVAILABLE" && ! -L "$VHOST_AVAILABLE" ]]; then
    echo "    keeping the previous regular file as $VHOST_AVAILABLE.coming-soon"
    sudo -n mv -f "$VHOST_AVAILABLE" "$VHOST_AVAILABLE.coming-soon"
  fi
  sudo -n ln -sfn "$VHOST_SRC" "$VHOST_AVAILABLE"
  sudo -n ln -sfn "$VHOST_AVAILABLE" "$VHOST_ENABLED"
  sudo -n nginx -t
  sudo -n systemctl reload nginx
  echo "    $VHOST_ENABLED -> $VHOST_AVAILABLE -> $VHOST_SRC, nginx reloaded"
}

# Point `current` at releases/<name> with one rename(2): no moment without it.
swap() {
  ln -sfn "releases/$1" "$ROOT/.current.tmp"
  mv -T "$ROOT/.current.tmp" "$CURRENT"
}

udc() { # udc <action> <json body> — POST through nginx, prints the answer
  curl -sS -m 15 -X POST "http://127.0.0.1/udc/$1" \
    -H "Host: $SITE" -H 'content-type: application/json' -d "$2"
}

check() {
  step "waiting for /healthz through nginx (Host: $SITE, up to 120 s)"
  local deadline=$((SECONDS + 120))
  # The body is checked, not only the status: for a moment after a reload nginx's
  # old workers still answer, and the "coming soon" vhost gave every path a 200.
  until curl -fsS -m 5 -H "Host: $SITE" http://127.0.0.1/healthz 2>/dev/null |
    jq -e '.ok == true' >/dev/null 2>&1; do
    ((SECONDS < deadline)) ||
      die 5 "/healthz did not answer within 120 s — journalctl --user -u $UNIT -n 100; tail /var/log/nginx/$SITE.error.log"
    sleep 2
  done
  echo "    ok after $((120 - (deadline - SECONDS))) s"

  step "GET /udc/companies through nginx is the built app"
  local page
  page="$(curl -fsS -m 15 -H "Host: $SITE" http://127.0.0.1/udc/companies 2>/dev/null || true)"
  grep -q 'src="/assets/' <<<"$page" ||
    die 5 "GET /udc/companies is not the built index.html (no /assets/ bundle in it): $(head -c 300 <<<"$page")"
  echo "    200, the SPA fallback with the hashed bundles"

  step "POST /udc/collections"
  local answer
  answer="$(udc collections '{}')" || die 5 "POST /udc/collections failed"
  [[ "$(jq -r '.kind' <<<"$answer")" == "udc.collections.ok" ]] ||
    die 5 "POST /udc/collections answered: $(head -c 500 <<<"$answer")"
  jq -r '.payload.collections[] | "  \(.name)  (\(.source_kind))"' <<<"$answer"

  step "POST /udc/list limit 1 on every postgres_jsonb collection"
  local failed=0 name body reply kind
  while read -r name; do
    body="$(jq -nc --arg c "$name" '{collection: $c, page: {limit: 1}}')"
    reply="$(udc list "$body" || echo '{"kind":"curl failed"}')"
    kind="$(jq -r '.kind // "no kind"' <<<"$reply" 2>/dev/null || echo "not json")"
    if [[ "$kind" == "udc.list.ok" ]]; then
      echo "  ok    $name"
    else
      echo "  FAIL  $name: $(head -c 300 <<<"$reply")" >&2
      failed=$((failed + 1))
    fi
  done < <(jq -r '.payload.collections[] | select(.source_kind == "postgres_jsonb") | .name' <<<"$answer")
  ((failed == 0)) || die 5 "$failed collection(s) answered an error to list"

  step "https://$SITE/healthz through the edge"
  curl -fsS -m 30 "https://$SITE/healthz" 2>/dev/null | jq -e '.ok == true' >/dev/null 2>&1 ||
    die 6 "this VM answers but https://$SITE/healthz does not: the edge does not route $SITE here"
  echo "    ok"
}

main
exit
