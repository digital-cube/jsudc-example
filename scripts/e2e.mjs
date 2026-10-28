#!/usr/bin/env node
/**
 *   npm run e2e [-- <extra cypress run args>]
 *
 * The Cypress run, end to end: migrate and reseed the TEST database (every
 * collection; the appointments around SEED_TODAY, default 2026-10-27, and the metrics ending at
 * its noon in Belgrade), start the backend on it, start Vite proxying to that backend,
 * run Cypress headless, and stop both servers whatever happens.
 *
 * The http_api collections (quakes, repos) read the responses recorded under
 * backend/test/fixtures/http (UDC_HTTP_FIXTURES), so a run never touches the
 * internet.
 *
 * Ports are not the dev ones, so `npm run dev` may keep running alongside:
 * E2E_BACKEND_PORT (5110) and E2E_WEB_PORT (5310). TEST_DATABASE_URL comes
 * from the environment, else backend/.env, else the backend's default.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(ROOT, "backend", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const testDb = process.env.TEST_DATABASE_URL || "postgresql://jsudc:123@localhost/jsudc_test";
const backendPort = Number(process.env.E2E_BACKEND_PORT || 5110);
const webPort = Number(process.env.E2E_WEB_PORT || 5310);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;
// The appointments are generated around the seed day: pinned, so every run sees the same week.
const SEED_TODAY = process.env.SEED_TODAY || "2026-10-27";
const HTTP_FIXTURES = join(ROOT, "backend", "test", "fixtures", "http");
const seedCmd = `SEED_TODAY=${SEED_TODAY} npm run seed --silent -- --reset --db ${testDb}`;

const children = [];

function log(msg) {
  console.log(`\n[e2e] ${msg}`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${res.status}`);
}

function start(name, cmd, args, opts) {
  // Own process group, so stopping it also stops whatever npx/tsx forked.
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
    ...opts,
  });
  child.on("exit", (code, signal) => {
    if (!stopping) log(`${name} exited early (${signal ?? code})`);
  });
  children.push(child);
  return child;
}

let stopping = false;
function stopAll() {
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${label} did not come up at ${url} within ${timeoutMs / 1000}s`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    process.exit(130);
  });
}

let code = 1;
try {
  log(`test database: ${testDb.replace(/:[^:@/]+@/, ":***@")}`);
  run("npm", ["run", "db:migrate:test", "--silent", "-w", "@jsudc/backend"], {
    env: { ...process.env, TEST_DATABASE_URL: testDb },
  });
  log(
    `seeding every collection (200 companies, 3 boards, 15 buckets, 60 tickets, ~640 appointments around ${SEED_TODAY}, 80 comments, 134 org nodes, 8,640 metrics ending at its noon)`,
  );
  run("sh", ["-c", seedCmd]);

  log(`backend on ${backendUrl}`);
  start("backend", "npx", ["tsx", "backend/src/main.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: testDb,
      PORT: String(backendPort),
      LOG_LEVEL: "warn",
      UDC_HTTP_FIXTURES: HTTP_FIXTURES,
      UDC_HTTP_SOURCES: "on",
    },
  });
  await waitFor(`${backendUrl}/healthz`, "backend");

  log(`vite on ${webUrl}`);
  start("vite", "npx", ["vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], {
    cwd: join(ROOT, "frontend"),
    env: { ...process.env, UDC_PROXY_TARGET: backendUrl },
  });
  await waitFor(`${webUrl}/healthz`, "vite proxy");

  log("cypress");
  const res = spawnSync(
    "npx",
    [
      "cypress",
      "run",
      "--project",
      "frontend",
      "--config",
      `baseUrl=${webUrl}`,
      ...process.argv.slice(2),
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      // Specs that edit rows reseed first, so each spec file starts from the same 200 rows.
      env: { ...process.env, E2E_SEED_CMD: `cd ${JSON.stringify(ROOT)} && ${seedCmd}` },
    },
  );
  code = res.status ?? 1;
} catch (err) {
  console.error(`[e2e] ${err instanceof Error ? err.message : err}`);
} finally {
  stopAll();
}
process.exit(code);
