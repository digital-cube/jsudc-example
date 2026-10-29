#!/usr/bin/env bash
# Deploy jsudc.igor.digitalcube.work end to end from the root checkout on main:
#   merge --ff-only <branch> -> stop jsudc-dev -> npm ci -> build -> migrate -> seed
#   -> start jsudc-dev -> /healthz through nginx -> every collection answers.
# The unit is stopped BEFORE npm ci: Vite serves "Failed to resolve import"
# while node_modules is replaced under a running dev server.
# The script runs from a temporary copy of itself, and when the merge changed
# deploy/deploy.sh it re-executes the merged version with --no-merge, so a deploy
# always runs the script it has just merged.
#
# Usage: deploy/deploy.sh [--branch jsudc] [--reset-seed] [--no-merge]
set -euo pipefail

# Run from a copy, never from the checkout: the merge below rewrites deploy/deploy.sh,
# and bash reads a script in chunks, so it would carry on at the same byte offset of
# the new file. The copy records where the checkout is; it deletes itself on exit.
if [[ -z "${DEPLOY_SH_COPY:-}" ]]; then
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  copy="$(mktemp "${TMPDIR:-/tmp}/deploy.sh.XXXXXX")"
  cp "${BASH_SOURCE[0]}" "$copy"
  DEPLOY_SH_COPY="$copy" DEPLOY_SH_REPO="$repo" exec bash "$copy" "$@"
fi
COPY="$DEPLOY_SH_COPY"
REPO="$DEPLOY_SH_REPO"
unset DEPLOY_SH_COPY DEPLOY_SH_REPO
trap 'rm -f "$COPY"' EXIT

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
  It runs from a temporary copy of itself; when the merge changed deploy/deploy.sh it
  re-executes the merged one with --no-merge (--reset-seed is passed on).

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
KEEP_ARGS=() # what a re-exec after the merge passes on (--branch is done by then)
while (($#)); do
  case "$1" in
    --branch)
      [[ $# -ge 2 && -n "$2" ]] || { echo "deploy.sh: --branch needs a name" >&2; exit 2; }
      BRANCH="$2"
      shift
      ;;
    --reset-seed) RESET_SEED=1; KEEP_ARGS+=("$1") ;;
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

[[ "$REPO" == "$EXPECTED_ROOT" ]] ||
  die 3 "refusing to deploy from $REPO — the live site runs from $EXPECTED_ROOT"
cd "$REPO"
export PATH="$NODE_BIN:$PATH"
command -v jq >/dev/null || die 3 "jq is required (sudo apt install jq)"
command -v gh >/dev/null || die 3 "gh is required: npm ci clones digital-cube/jsudc-* over HTTPS with its token"

# @jsudc/core, server and react are git dependencies on private repositories:
# npm ci clones them over HTTPS and git takes the token from the gh CLI (logged
# in as digital-cube, which reads them). Set for this process so the script needs
# no credential.helper in ~/.gitconfig; the unit never runs npm ci, so it needs none.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0='!gh auth git-credential'

current="$(git symbolic-ref --short -q HEAD || true)"
[[ "$current" == "main" ]] || die 3 "not on main (on '${current:-detached HEAD}'): git switch main"
[[ -z "$(git status --porcelain)" ]] ||
  die 3 "the working tree is dirty — commit or clean it first:
$(git status --short)"

# A re-exec after the merge (below) hands over where main was before it, so the
# deploy/nginx check further down still sees what that merge brought.
BEFORE="${DEPLOY_SH_BEFORE:-$(git rev-parse HEAD)}"
unset DEPLOY_SH_BEFORE
if ((MERGE)); then
  step "git merge --ff-only $BRANCH"
  git rev-parse --verify -q "refs/heads/$BRANCH" >/dev/null || die 3 "no local branch '$BRANCH'"
  timeout 60 git merge --ff-only "$BRANCH" ||
    die 4 "main cannot fast-forward to $BRANCH — rebase $BRANCH on main first; nothing was changed"
  if ! git diff --quiet "$BEFORE" HEAD -- deploy/deploy.sh; then
    echo "the merge brought a new deploy/deploy.sh — re-executing it with --no-merge"
    rm -f "$COPY"
    DEPLOY_SH_BEFORE="$BEFORE" exec "$REPO/deploy/deploy.sh" --no-merge "${KEEP_ARGS[@]}"
  fi
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

# @jsudc/* come from GitHub tags (npm ci clones them over HTTPS and builds their dist); this builds the frontend.
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
