# jsudc example: hosting on examples.stage.jsudc.dev and examples.jsudc.dev

Status: decided by Igor on 2026-10-30 in the Root chat; the tickets below are
proposed, not yet filed. Written from the repository root at `104011b`.

## 1. Decision

The example app (this repository, `digital-cube/jsudc-example`) stops living at
`jsudc.igor.digitalcube.work` and runs in two places:

| host | server | role |
|---|---|---|
| `examples.stage.jsudc.dev` | this VM (edge 65.108.45.136 → 192.168.124.3) | stage, the dev stack with HMR as today |
| `examples.jsudc.dev` | hetzner2 (168.119.212.55) | production, a real build |

DNS is done (Cloudflare, unproxied A records, see the libraries plan §6 for the
site hosts). TLS is terminated at the edge in front of each server, exactly as
for `stage.jsudc.dev`; the vhosts listen on :80. Igor has configured the
hypervisors to forward both names.

The website (`digital-cube/jsudc-website`, deployed as `stage.jsudc.dev` by its
own `deploy/stage.sh`) links to the example through `EXAMPLE_URL`, which still
defaults to `https://jsudc.igor.digitalcube.work`. It has to follow:
`https://examples.stage.jsudc.dev` on stage, `https://examples.jsudc.dev` on
production.

## 2. What is on this VM today (stage)

- `deploy/nginx/jsudc.igor.digitalcube.work.conf`: :80, everything proxied to
  Vite on 127.0.0.1:5101, which proxies `POST /udc/*` and `/healthz` to Fastify
  on 127.0.0.1:5100.
- `deploy/systemd/jsudc-dev.service`: user unit, `npm run dev` from
  `/home/digital/work/jsudc` on `main`, `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`
  hard-coded to the old host name.
- `deploy/deploy.sh` and `deploy/install.sh`: `SITE=jsudc.igor.digitalcube.work`
  in both; the health check sends that `Host:` header through nginx.
- README § "Deploy on igor.digitalcube.work".

Stage keeps this mechanism. Only the name changes.

## 3. Stage: the rename (one ticket, worktree `jsudc`)

1. New vhost `deploy/nginx/examples.stage.jsudc.dev.conf` with the same body;
   a second `server` block for `jsudc.igor.digitalcube.work` that answers
   `301` to `https://examples.stage.jsudc.dev$request_uri` (`absolute_redirect`
   is irrelevant here, the target is absolute and https).
2. `SITE=examples.stage.jsudc.dev` in `deploy.sh` and `install.sh`;
   `install.sh` links the new file and removes the old symlink.
3. `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=examples.stage.jsudc.dev` in the
   unit (Vite refuses an unknown `Host`).
4. README section renamed and the URLs updated; the libraries plan §6 gets the
   two example hosts next to the site hosts.
5. Verify from the root checkout after merge: `deploy/install.sh`, then
   `deploy/deploy.sh --no-merge`; `curl -I https://jsudc.igor.digitalcube.work/`
   is a 301 to the new host, `https://examples.stage.jsudc.dev/healthz` is
   `{"ok":true}`, `/udc/companies` renders, HMR websocket connects.

Out of scope: the website's `EXAMPLE_URL` (other repository, a one-line change
there once this is live).

## 4. Production: examples.jsudc.dev on hetzner2

Built by TCKCT9NQ2P on 2026-10-30; this section describes what is in the
repository, not a plan. The VM is `digitalcube-production-websites`
(hetzner2, 192.168.122.11, SSH alias of that name through `insider2`):
Ubuntu 26.04, user `digital` with passwordless sudo, nginx, Postgres 18.6 on
127.0.0.1, Node 24 via nvm (v24.16.0 and v24.17.0 at the time). The edge
`h2` terminates TLS for `examples.jsudc.dev` and forwards to this VM's :80.

### What production is

Not the dev stack. The README says so on purpose for stage; production is:

```
nginx :80 (TLS at the edge)
  /            -> static files from ~/sites/examples.jsudc.dev/current (SPA: try_files … /index.html)
  /assets/     -> the same, Cache-Control: public, max-age=31536000, immutable
  POST /udc/*  -> Fastify 127.0.0.1:5100     (GET /udc/<collection> is an app route -> /index.html)
  /udc/files/blob, /healthz -> Fastify
Fastify: `npm start -w @jsudc/backend` (tsx src/main.ts) under the systemd user unit jsudc-prod,
         DATABASE_URL from src/backend/.env -> local Postgres 18, database jsudc (C.UTF-8, libc)
```

The frontend build (`vite build`) produces `frontend/dist`; the app calls the
backend on the same origin (`VITE_UDC_URL` unset), so no build-time URL is
needed. The backend has no static serving and does not need any. No code
change was needed to run the production build: `npm start` already existed
and `tsx` is a devDependency that `npm ci` installs (the deploy script unsets
`NODE_ENV` for that reason; the unit sets `NODE_ENV=production` for the
backend only).

### The three files

- `deploy/prod.sh` — runs on the VM as `digital`, the shape of the website's
  `deploy/stage.sh`: `ROOT=/home/digital/sites/examples.jsudc.dev`, clone or
  fetch `digital-cube/jsudc-example` into `src/`, check out `origin/main`
  (`--ref` for another committish; a commit without the vhost or the unit is
  refused, because both are symlinks into the checkout), `npm ci`, `npm run
  build`, `db:migrate`, `seed` (new collections only; `--reset-seed`), copy
  `frontend/dist` to `releases/<short sha>/`, repoint `current` with one
  rename, restart the unit, wait for `/healthz` through nginx with
  `Host: examples.jsudc.dev`, `GET /udc/companies` is the app, `POST
  /udc/collections`, one row of every `postgres_jsonb` collection, and
  `/healthz` through the edge; keep the last three releases. Idempotent: the
  same commit already current with the unit up rebuilds nothing. Refuses
  root, another user, another host. `--install` does the one-time steps:
  role and database `jsudc` with a generated password written to
  `src/backend/.env` (mode 600), `loginctl enable-linger digital`, the unit
  link, the vhost link (the hand-written "coming soon" file stays in
  `sites-available` as `examples.jsudc.dev.coming-soon`), `nginx -t`, reload.
- `deploy/nginx/examples.jsudc.dev.conf` — the vhost above. `location /udc/`
  carries `if ($request_method != POST) { rewrite ^ /index.html last; }`,
  the nginx form of the Vite proxy's `bypass`; `/index.html` is
  `Cache-Control: no-cache`.
- `deploy/systemd/jsudc-prod.service` — user unit, `WorkingDirectory=…/src`,
  `ExecStart=/home/digital/sites/examples.jsudc.dev/node/npm start -w
  @jsudc/backend`, `PORT=5100 HOST=127.0.0.1 NODE_ENV=production
  LOG_LEVEL=info`, `Restart=on-failure`, `WantedBy=default.target`. The Node
  version is not in the unit: `prod.sh` points the symlink `~/sites/
  examples.jsudc.dev/node` at the newest installed nvm v24 on every run (and
  runs `nvm install 24` when there is none).

### Settled

- **Where.** On the existing VM `digitalcube-production-websites`, next to the
  other websites; port 5100 for the backend (free there). The thilo runner of
  another project on that machine is untouched.
- **Access.** The SSH alias works from this VM; the first deploy was run from
  the worktree over SSH as the ticket describes. GitHub `main` was behind
  (`104011b`, before the stage rename) and this project pushes nothing, so the
  first deploy fetched the branch into `src/` from a git bundle and ran
  `prod.sh --install --ref ticket-TCKCT9NQ2P`. Once `main` carries these
  commits a plain `prod.sh` converges on `origin/main` (same commit, nothing
  rebuilt); a NON-AI ticket asks for that push.
- **Seed data.** Production started from `seed.json`; nothing was copied from
  stage.
- **Postgres 18.** The backend tests and the library's `pg-*` tests were run
  against it on the VM before the first deploy (the transcripts are on
  TCKCT9NQ2P). The database collation is `C.UTF-8` with the libc provider
  (`pg_database.datcollate`; the `lc_collate` GUC no longer exists in 18),
  relevant to TCKDHHN3N6.

## 5. Tickets

| # | kind | title |
|---|---|---|
| T1 | AI, worktree `jsudc` | examples.stage.jsudc.dev replaces jsudc.igor.digitalcube.work: vhost, redirect, SITE, allowed host, README |
| T2 | AI, worktree `jsudc`, after T3 | deploy/prod.sh and the production vhost + unit for examples.jsudc.dev; first deploy on hetzner2 |
| T3 | person (Igor) | hetzner2: the VM for examples.jsudc.dev, edge forwarding, and SSH access for this VM's key |
| T4 | website repo | `EXAMPLE_URL` → examples.stage.jsudc.dev / examples.jsudc.dev |

Done 2026-10-30 by Igor, no ticket: all five `digital-cube/jsudc-*` repositories
(core, server, react, example, website) are public.
