#!/usr/bin/env bash
# Deploy jsudc.igor.digitalcube.work end to end from the root checkout on main:
#   merge --ff-only <branch> -> stop jsudc-dev -> npm ci -> build -> migrate -> seed
#   -> start jsudc-dev -> /healthz through nginx -> every collection answers.
# The unit is stopped BEFORE npm ci: Vite serves "Failed to resolve import"
# while node_modules is replaced under a running dev server.
#
# Usage: deploy/deploy.sh [--branch jsudc] [--reset-seed] [--no-merge]
set -euo pipefail

EXPECTED_ROOT=/home/digital/work/jsudc
SITE=jsudc.igor.digitalcube.work
UNIT=jsudc-dev
NODE_BIN=/home/digital/.nvm/versions/node/v24.19.0/bin

usage() {
  cat <<EOF
Usage: deploy/deploy.sh [--branch jsudc] [--reset-seed] [--no-merge]

Deploys $SITE from $EXPECTED_ROOT (must be on main, clean):
  git merge --ff-only <branch>, systemctl --user stop $UNIT, npm ci, npm run build,
  npm run db:migrate -w @jsudc/backend, npm run seed, systemctl --user start $UNIT,
  then waits for /healthz through nginx and lists one row of every postgres collection.

  --branch <name>  branch to fast-forward main to (default: jsudc)
  --no-merge       skip the merge, redeploy what main has now
  --reset-seed     seed with --reset: every database collection goes back to its
                   schema.json (v1) and seed.json — edits made on the site are LOST
  -h, --help       this text

Exit codes: 0 deployed, 1 a step failed, 2 usage, 3 refused (wrong checkout,
not on main, dirty tree), 4 merge is not a fast-forward, 5 the site did not come up.
Use deploy/install.sh (not this) when only the unit or the vhost changed and nothing else.
EOF
}

BRANCH=jsudc
RESET_SEED=0
MERGE=1
while (($#)); do
  case "$1" in
    --branch)
      [[ $# -ge 2 && -n "$2" ]] || { echo "deploy.sh: --branch needs a name" >&2; exit 2; }
      BRANCH="$2"
      shift
      ;;
    --reset-seed) RESET_SEED=1 ;;
    --no-merge) MERGE=0 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "deploy.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

die() { # die <exit code> <message...>
  local code="$1"
  shift
  echo "deploy.sh: $*" >&2
  exit "$code"
}
step() { printf '\n==> %s\n' "$*"; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ "$REPO" == "$EXPECTED_ROOT" ]] ||
  die 3 "refusing to deploy from $REPO — the live site runs from $EXPECTED_ROOT"
cd "$REPO"
export PATH="$NODE_BIN:$PATH"
command -v jq >/dev/null || die 3 "jq is required (sudo apt install jq)"

current="$(git symbolic-ref --short -q HEAD || true)"
[[ "$current" == "main" ]] || die 3 "not on main (on '${current:-detached HEAD}'): git switch main"
[[ -z "$(git status --porcelain)" ]] ||
  die 3 "the working tree is dirty — commit or clean it first:
$(git status --short)"

BEFORE="$(git rev-parse HEAD)"
if ((MERGE)); then
  step "git merge --ff-only $BRANCH"
  git rev-parse --verify -q "refs/heads/$BRANCH" >/dev/null || die 3 "no local branch '$BRANCH'"
  timeout 60 git merge --ff-only "$BRANCH" ||
    die 4 "main cannot fast-forward to $BRANCH — rebase $BRANCH on main first; nothing was changed"
else
  step "skipping the merge (--no-merge)"
fi

# From here on the service may be down: say so when a step fails.
STOPPED=0
on_err() {
  local code=$?
  if ((STOPPED)); then
    echo >&2
    echo "deploy.sh: FAILED (exit $code) with $UNIT stopped — the site is down." >&2
    echo "  fix the step above, then: deploy/deploy.sh --no-merge" >&2
    echo "  or bring the old state back up: systemctl --user start $UNIT" >&2
  else
    echo "deploy.sh: FAILED (exit $code)" >&2
  fi
}
trap on_err ERR

step "systemctl --user stop $UNIT"
STOPPED=1
timeout 60 systemctl --user stop "$UNIT"

step "npm ci"
timeout 600 npm ci --no-audit --no-fund

# The packages' dist (the example imports it, no source aliases), then the frontend.
step "npm run build"
timeout 300 npm run build

step "npm run db:migrate -w @jsudc/backend"
timeout 120 npm run db:migrate -w @jsudc/backend

if ((RESET_SEED)); then
  step "npm run seed -- --reset"
  echo "WARNING: --reset-seed — every database collection is reseeded; edits made on the site (companies, …) are lost." >&2
  timeout 300 npm run seed -- --reset
else
  step "npm run seed (new collections only)"
  timeout 300 npm run seed
fi

# The unit and the vhost are symlinks into this checkout: pick up a change the merge brought.
step "systemctl --user start $UNIT"
timeout 30 systemctl --user daemon-reload
if ! git diff --quiet "$BEFORE" HEAD -- deploy/nginx; then
  echo "deploy/nginx changed in this merge: nginx -t && reload"
  timeout 30 sudo nginx -t
  timeout 30 sudo systemctl reload nginx
fi
timeout 60 systemctl --user start "$UNIT"
STOPPED=0
trap - ERR

udc() { # udc <action> <json body> — POST through nginx, prints the answer
  curl -sS -m 15 -X POST "http://127.0.0.1/udc/$1" \
    -H "Host: $SITE" -H 'content-type: application/json' -d "$2"
}

step "waiting for /healthz through nginx (up to 120 s)"
deadline=$((SECONDS + 120))
until curl -fsS -m 5 -o /dev/null -H "Host: $SITE" http://127.0.0.1/healthz 2>/dev/null; do
  ((SECONDS < deadline)) ||
    die 5 "/healthz did not answer within 120 s — journalctl --user -u $UNIT -n 100"
  sleep 2
done
echo "healthz ok after $((120 - (deadline - SECONDS))) s"

step "POST /udc/collections"
answer="$(udc collections '{}')" || die 5 "POST /udc/collections failed"
[[ "$(jq -r '.kind' <<<"$answer")" == "udc.collections.ok" ]] ||
  die 5 "POST /udc/collections answered: $(head -c 500 <<<"$answer")"
jq -r '.payload.collections[] | "  \(.name)  (\(.source_kind))"' <<<"$answer"

step "POST /udc/list limit 1 on every postgres_jsonb collection"
failed=0
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

echo
git log -1 --format='HEAD %h %s (%ci)'
echo "deployed -> http://$SITE"
