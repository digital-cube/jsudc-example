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

### What production should be

Not the dev stack. The README says so on purpose for stage; production is:

```
nginx :80 (TLS at the edge)
  /            -> static files from <release>/frontend/dist (SPA: try_files … /index.html)
  POST /udc/*  -> Fastify 127.0.0.1:5100     (GET /udc/<collection> is an app route -> index.html)
  /udc/files/blob, /healthz -> Fastify
Fastify: `npm start -w @jsudc/backend` (tsx src/main.ts) under a systemd user unit,
         DATABASE_URL -> local Postgres 16, database jsudc
```

The frontend build (`vite build`) already produces `frontend/dist`; the app
calls the backend on the same origin (`VITE_UDC_URL` unset), so no build-time
URL is needed. The backend has no static serving and does not need any.

### Deploy script

`deploy/prod.sh`, the shape of the website's `deploy/stage.sh`: clone or fetch
`digital-cube/jsudc-example` into `~/sites/examples.jsudc.dev/src`, check out
`main`, `npm ci` (libraries from npm, no credential), `npm run build`,
`db:migrate`, `seed` (new collections only), restart the unit, `/healthz`
through nginx, one row of every database collection, keep the last three
releases. `--install` links the vhost and the unit the first time.

### Unknowns, to be settled before the ticket runs

- **Where on hetzner2.** It is a hypervisor (`insider2`, VMs on 192.168.122.x
  reached by `ProxyJump`). Igor decides whether the example gets its own VM or
  goes on an existing one, and which one receives `examples.jsudc.dev` from the
  edge. The VM needs Node 24 (nvm), Postgres 16, nginx, linger for the user.
- **Access.** This VM has only `~/.ssh/id_ed25519`; `hetzner2` and `insider2`
  are configured for `id_rsa`, which does not exist here, and the key is not
  authorised there. Either the public key below is added to the target VM, or
  Igor runs `prod.sh` by hand.

  ```
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJeoYrQi6NMaeXdZZe+traZljn9Fl1cZdkk7XFeopGVS
  ```

- **Seed data.** Production starts from `seed.json` like stage; nothing is
  copied from stage.

## 5. Tickets

| # | kind | title |
|---|---|---|
| T1 | AI, worktree `jsudc` | examples.stage.jsudc.dev replaces jsudc.igor.digitalcube.work: vhost, redirect, SITE, allowed host, README |
| T2 | AI, worktree `jsudc`, after T3 | deploy/prod.sh and the production vhost + unit for examples.jsudc.dev; first deploy on hetzner2 |
| T3 | person (Igor) | hetzner2: the VM for examples.jsudc.dev, edge forwarding, and SSH access for this VM's key |
| T4 | website repo | `EXAMPLE_URL` → examples.stage.jsudc.dev / examples.jsudc.dev |

Done 2026-10-30 by Igor, no ticket: all five `digital-cube/jsudc-*` repositories
(core, server, react, example, website) are public.
