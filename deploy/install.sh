#!/usr/bin/env bash
# Install the deployment of examples.stage.jsudc.dev from this checkout:
#   ~/.config/systemd/user/jsudc-dev.service       -> <repo>/deploy/systemd/jsudc-dev.service
#   /etc/nginx/sites-enabled/examples.stage.jsudc.dev -> <repo>/deploy/nginx/examples.stage.jsudc.dev.conf
# and removes the link of the old name, /etc/nginx/sites-enabled/jsudc.igor.digitalcube.work
# (the 301 for that name lives in the new vhost), then daemon-reload + enable the
# unit (it is NOT started or restarted here), nginx -t + reload, and a check that
# linger is on (the unit starts at boot).
#
# Idempotent: running it again changes nothing. Run it from the root checkout
# /home/digital/work/jsudc after a merge to main that touched deploy/.
#
# Usage: deploy/install.sh [--dry-run] [--allow-root <path>]
set -euo pipefail

EXPECTED_ROOT=/home/digital/work/jsudc
SITE=examples.stage.jsudc.dev
OLD_SITE=jsudc.igor.digitalcube.work # redirected by the vhost of $SITE; its own link goes away
UNIT=jsudc-dev.service
UNIT_DIR="$HOME/.config/systemd/user"
LINGER_USER=digital

usage() {
  cat <<EOF
Usage: deploy/install.sh [--dry-run] [--allow-root <path>]

Links the systemd user unit and the nginx vhost of $SITE into this
checkout, removes the old link of $OLD_SITE, enables the unit, reloads nginx
and checks linger.

  --dry-run            print every command that changes something instead of running it
  --allow-root <path>  accept a repo root other than $EXPECTED_ROOT
                       (only when it is exactly <path>; e.g. a dry run from a worktree)
  -h, --help           this text

Exit codes: 0 installed, 1 a step failed or linger is off, 2 usage, 3 refused (wrong checkout).
EOF
}

DRY_RUN=0
ALLOW_ROOT=""
while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --allow-root)
      [[ $# -ge 2 ]] || { echo "install.sh: --allow-root needs a path" >&2; exit 2; }
      ALLOW_ROOT="$2"
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "install.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

# The guard that keeps a worktree from installing itself over the live site.
if [[ "$REPO" != "$EXPECTED_ROOT" ]]; then
  if [[ -z "$ALLOW_ROOT" || "$REPO" != "$(cd "$ALLOW_ROOT" 2>/dev/null && pwd -P)" ]]; then
    echo "install.sh: refusing to install from $REPO" >&2
    echo "  the live site runs from $EXPECTED_ROOT; pass --allow-root $REPO to override." >&2
    exit 3
  fi
fi

UNIT_SRC="$REPO/deploy/systemd/$UNIT"
UNIT_DST="$UNIT_DIR/$UNIT"
VHOST_SRC="$REPO/deploy/nginx/$SITE.conf"
VHOST_ENABLED="/etc/nginx/sites-enabled/$SITE"
VHOST_AVAILABLE="/etc/nginx/sites-available/$SITE"
OLD_VHOST_ENABLED="/etc/nginx/sites-enabled/$OLD_SITE"

for f in "$UNIT_SRC" "$VHOST_SRC"; do
  [[ -f "$f" ]] || { echo "install.sh: missing $f" >&2; exit 1; }
done

run() {
  if ((DRY_RUN)); then
    printf '+'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

((DRY_RUN)) && echo "install.sh: dry run from $REPO — nothing is changed"

echo "==> systemd user unit"
run mkdir -p "$UNIT_DIR"
if [[ -f "$UNIT_DST" && ! -L "$UNIT_DST" ]]; then
  echo "    $UNIT_DST is a regular file, keeping it as $UNIT_DST.bak"
  run mv -f "$UNIT_DST" "$UNIT_DST.bak"
fi
run ln -sfn "$UNIT_SRC" "$UNIT_DST"
run systemctl --user daemon-reload
run systemctl --user enable "$UNIT"

echo "==> nginx vhost"
run sudo ln -sfn "$VHOST_SRC" "$VHOST_ENABLED"
# The old name is a 301 inside the new vhost; its own link would make nginx
# see two servers for it (a missing link is fine: nothing to do).
if [[ -L "$OLD_VHOST_ENABLED" || -e "$OLD_VHOST_ENABLED" ]]; then
  echo "    removing the old link $OLD_VHOST_ENABLED ($OLD_SITE is a 301 in $SITE.conf)"
  run sudo rm -f "$OLD_VHOST_ENABLED"
fi
run sudo nginx -t
# The old hand-written copy is redundant once sites-enabled points into the repo.
if [[ -f "$VHOST_AVAILABLE" && ! -L "$VHOST_AVAILABLE" ]]; then
  echo "    removing the now-redundant regular file $VHOST_AVAILABLE"
  run sudo rm -f "$VHOST_AVAILABLE"
fi
run sudo systemctl reload nginx

echo "==> linger (unit starts at boot)"
linger="$(loginctl show-user "$LINGER_USER" -p Linger --value 2>/dev/null || true)"
if [[ "$linger" != "yes" ]]; then
  echo "install.sh: linger is off for $LINGER_USER — the site will not come back after a reboot." >&2
  echo "  fix: sudo loginctl enable-linger $LINGER_USER" >&2
  exit 1
fi
echo "    Linger=yes"

if ((DRY_RUN)); then
  echo "install.sh: dry run done"
else
  echo "install.sh: installed. The unit was not restarted: systemctl --user restart jsudc-dev"
fi
