#!/usr/bin/env node
/**
 *   npm run e2e [-- --resume] [-- <extra cypress run args>]
 *   E2E_WORKERS=4 npm run e2e
 *
 * The Cypress run, end to end: migrate and reseed the TEST database (every
 * collection; the appointments around SEED_TODAY, default 2026-10-27, and the metrics ending at
 * its noon in Belgrade), start the backend on it, start Vite proxying to that backend,
 * run Cypress headless, and stop every server whatever happens.
 *
 * Workers: E2E_WORKERS=N (default 4) splits the spec files into N groups, balanced by
 * the durations the last runs recorded. Each worker has a database of its own
 * (`<test db>_1` … `_N`, created and migrated when missing), its own backend and Vite
 * ports (the first free ones from E2E_BACKEND_PORT / E2E_WEB_PORT up) and its own
 * reseed command, so the `reseed` task of one worker never resets another's rows.
 * E2E_WORKERS=1 is the old single run: TEST_DATABASE_URL itself, the two ports as
 * given, Cypress printing straight to the terminal. With more than one worker each
 * worker's output goes to .thilo/e2e-w<i>.log and the terminal gets the progress.
 *
 * Progress: after every spec file the state of the run is written to
 * .thilo/e2e-progress.json (the per-file results, the totals, the elapsed time) and
 * one line is printed. `--resume` runs only the files that did not pass in the run
 * recorded there; a plain run starts fresh (and only keeps the durations).
 *
 * The http_api collections (quakes, repos, flights) read the responses recorded
 * under backend/test/fixtures/http (UDC_HTTP_FIXTURES), so a run never touches
 * the internet.
 *
 * Ports are not the dev ones, so `npm run dev` may keep running alongside:
 * E2E_BACKEND_PORT (5110) and E2E_WEB_PORT (5310). TEST_DATABASE_URL comes
 * from the environment, else backend/.env, else the backend's default.
 */
import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(ROOT, "frontend");
const envFile = join(ROOT, "backend", ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const testDb = process.env.TEST_DATABASE_URL || "postgresql://jsudc:123@localhost/jsudc_test";
const backendPortBase = Number(process.env.E2E_BACKEND_PORT || 5110);
const webPortBase = Number(process.env.E2E_WEB_PORT || 5310);
// The appointments are generated around the seed day: pinned, so every run sees the same week.
const SEED_TODAY = process.env.SEED_TODAY || "2026-10-27";
const HTTP_FIXTURES = join(ROOT, "backend", "test", "fixtures", "http");
const OUT_DIR = join(ROOT, ".thilo");
const PROGRESS_FILE = join(OUT_DIR, "e2e-progress.json");
const SPEC_PATTERN = "cypress/e2e/**/*.cy.ts";
// Cypress starts the browser with --disable-dev-shm-usage, so Chromium keeps its shared
// memory in TMPDIR, /tmp by default. A /tmp that is full or over its quota makes that memory
// fail to allocate: requests end in ERR_INSUFFICIENT_RESOURCES and the renderer crashes
// ("We detected that the Electron Renderer process just crashed"). The run gets a temporary
// directory on the disk of the checkout instead (E2E_TMPDIR overrides it).
const E2E_TMPDIR = resolve(process.env.E2E_TMPDIR || join(OUT_DIR, "e2e-tmp"));
// How much the run must be able to write into E2E_TMPDIR before Cypress starts.
const TMPDIR_PROBE_MB = 64;

// --- arguments ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const resume = argv.includes("--resume");
const cypressArgs = [];
let specArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--resume") continue;
  // --spec picks the files; each worker then gets its own --spec.
  if (a === "--spec" || a === "-s") specArg = argv[++i];
  else if (a.startsWith("--spec=")) specArg = a.slice("--spec=".length);
  else cypressArgs.push(a);
}

const workersWanted = Number(process.env.E2E_WORKERS || 4);
if (!Number.isInteger(workersWanted) || workersWanted < 1) {
  console.error(`[e2e] E2E_WORKERS must be a positive integer, got ${process.env.E2E_WORKERS}`);
  process.exit(2);
}

// --- small helpers -----------------------------------------------------------------------

// A full or over-quota TMPDIR doesn't make Cypress fail cleanly: the browser either
// won't start (exit 133) or its renderer crashes a few tests into a spec. So write a
// probe file before any server starts, and stop with the reason if that fails.
function checkTmpdir() {
  const probe = join(E2E_TMPDIR, `.space-probe-${process.pid}`);
  try {
    writeFileSync(probe, Buffer.alloc(TMPDIR_PROBE_MB * 1024 * 1024));
  } catch (err) {
    // Node has no name for EDQUOT and reports it as UNKNOWN, errno -122.
    const reason = err.errno === -122 ? "disk quota exceeded" : (err.code ?? err.message);
    throw new Error(
      `cannot write ${TMPDIR_PROBE_MB} MB into TMPDIR ${E2E_TMPDIR} (${reason}); ` +
        "the browser keeps its shared memory there and crashes without it. " +
        "Free space or quota there, or point E2E_TMPDIR at another disk",
    );
  } finally {
    rmSync(probe, { force: true });
  }
}

function log(msg) {
  console.log(`\n[e2e] ${msg}`);
}

function redact(url) {
  return url.replace(/:[^:@/]+@/, ":***@");
}

function fmtMs(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** The test database of worker `i`: the configured one for a single worker, else `<name>_<i>`. */
function workerDbUrl(i, workers) {
  if (workers === 1) return testDb;
  const url = new URL(testDb);
  url.pathname = `/${decodeURIComponent(url.pathname.slice(1))}_${i}`;
  return url.toString();
}

function databaseName(url) {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`refusing to create database with name ${JSON.stringify(name)}`);
  }
  return name;
}

/** `CREATE DATABASE` when it is missing, through a connection to `postgres`. */
async function ensureDatabase(url) {
  const name = databaseName(url);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const found = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (found.rowCount === 0) {
      await client.query(`create database "${name}"`);
      return true;
    }
    return false;
  } finally {
    await client.end();
  }
}

function portFree(port) {
  return new Promise((done) => {
    const srv = createServer();
    srv.once("error", () => done(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => done(true)));
  });
}

/** The first free port from `from` up that is not in `taken`. */
async function freePort(from, taken) {
  for (let p = from; p < from + 200; p++) {
    if (taken.has(p)) continue;
    if (await portFree(p)) {
      taken.add(p);
      return p;
    }
  }
  throw new Error(`no free port in ${from}..${from + 199}`);
}

// --- processes -----------------------------------------------------------------------------

const children = [];
let stopping = false;

function start(name, cmd, args, opts, out) {
  // Own process group, so stopping it also stops whatever npx/tsx forked.
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", out ? "pipe" : "inherit", out ? "pipe" : "inherit"],
    detached: true,
    ...opts,
    env: { ...(opts?.env ?? process.env), TMPDIR: E2E_TMPDIR },
  });
  if (out) {
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
  }
  child.on("exit", (code, signal) => {
    if (!stopping && !child.quietExit) say(out, `${name} exited early (${signal ?? code})`);
  });
  children.push(child);
  return child;
}

/** Run to completion; rejects on a non-zero exit. */
function run(cmd, args, opts, out) {
  return new Promise((done, fail) => {
    const child = start(cmd, cmd, args, opts, out);
    child.quietExit = true;
    child.on("exit", (code, signal) => {
      if (code === 0) done();
      else fail(new Error(`${cmd} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

function exitCode(child) {
  return new Promise((done) => {
    child.quietExit = true;
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

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

/** A line for the terminal, or for the worker's log when it has one. */
function say(out, msg) {
  if (out) out.write(`\n[e2e] ${msg}\n`);
  else log(msg);
}

async function waitFor(url, label, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !stopping) {
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

// --- the spec files and the progress file --------------------------------------------------

/** Spec keys are relative to frontend/, as Cypress names them (`cypress/e2e/edit.cy.ts`). */
function listSpecs() {
  if (!specArg) return globSync(SPEC_PATTERN, { cwd: FRONTEND }).sort();
  const keys = new Set();
  for (const part of specArg.split(",").filter(Boolean)) {
    const abs = resolve(ROOT, part.trim());
    const matches = globSync(relative(ROOT, abs), { cwd: ROOT });
    if (matches.length === 0) throw new Error(`--spec ${part}: no such file`);
    for (const m of matches) keys.add(relative(FRONTEND, join(ROOT, m)));
  }
  return [...keys].sort();
}

/** The tests a spec file declares (`it(` / `specify(`), before Cypress has run it. */
function countTests(key) {
  const src = readFileSync(join(FRONTEND, key), "utf8");
  return (src.match(/^\s*(it|specify)(\.only|\.skip)?\(/gm) ?? []).length;
}

function readProgress() {
  try {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  } catch {
    return null;
  }
}

const startedAt = Date.now();
const progress = {
  version: 1,
  run: {
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: null,
    finishedAt: null,
    status: "running",
    resume,
    workers: 0,
    pid: process.pid,
  },
  summary: null,
  specs: {},
  // The last measured duration of every spec file, kept across runs to balance the workers.
  durations: {},
};
let recording = false;

function summarize() {
  const s = {
    files: 0,
    filesDone: 0,
    filesPassed: 0,
    filesFailed: 0,
    tests: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    elapsedMs: Date.now() - startedAt,
  };
  for (const spec of Object.values(progress.specs)) {
    s.files++;
    const done = spec.status === "passed" || spec.status === "failed";
    s.tests += done ? spec.tests : spec.declaredTests;
    if (!done) continue;
    s.filesDone++;
    if (spec.status === "passed") s.filesPassed++;
    else s.filesFailed++;
    s.passed += spec.passed;
    s.failed += spec.failed;
    s.pending += spec.pending;
    s.skipped += spec.skipped;
  }
  return s;
}

function writeProgress() {
  if (!recording) return;
  progress.run.updatedAt = new Date().toISOString();
  progress.summary = summarize();
  // Through a temporary file, so a reader never sees half of it.
  const tmp = `${PROGRESS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(progress, null, 2)}\n`);
  renameSync(tmp, PROGRESS_FILE);
}

function progressLine(note) {
  const s = summarize();
  return (
    `${s.filesDone}/${s.files} files · ${s.passed} passed, ${s.failed} failed of ${s.tests} tests` +
    ` · ${fmtMs(s.elapsedMs)}${note ? ` — ${note}` : ""}`
  );
}

/** Split the spec keys into `n` groups of about equal duration (longest first, onto the lightest). */
function balance(keys, n, durations) {
  const known = keys.filter((k) => durations[k] > 0);
  const perTest =
    known.length > 0
      ? known.reduce((a, k) => a + durations[k], 0) /
        known.reduce((a, k) => a + Math.max(1, progress.specs[k].declaredTests), 0)
      : 5000;
  const cost = (k) => durations[k] || perTest * Math.max(1, progress.specs[k].declaredTests);
  const groups = Array.from({ length: n }, () => ({ keys: [], ms: 0 }));
  for (const k of [...keys].sort((a, b) => cost(b) - cost(a))) {
    const lightest = groups.reduce((a, g) => (g.ms < a.ms ? g : a));
    lightest.keys.push(k);
    lightest.ms += cost(k);
  }
  return groups.filter((g) => g.keys.length > 0);
}

// --- one worker ------------------------------------------------------------------------------

const workerState = [];

/** Read the events the worker's Cypress appended (cypress.config.ts, E2E_EVENTS_FILE), one read at a time. */
function drainEvents(w) {
  w.draining = (w.draining ?? Promise.resolve()).then(() => readEvents(w)).catch(() => {});
  return w.draining;
}

async function readEvents(w) {
  if (!existsSync(w.eventsFile)) return;
  const size = statSync(w.eventsFile).size;
  if (size <= w.eventsOffset) return;
  const fh = await open(w.eventsFile, "r");
  try {
    const buf = Buffer.alloc(size - w.eventsOffset);
    await fh.read(buf, 0, buf.length, w.eventsOffset);
    const text = buf.toString("utf8");
    const end = text.lastIndexOf("\n");
    if (end < 0) return;
    w.eventsOffset += Buffer.byteLength(text.slice(0, end + 1));
    for (const line of text.slice(0, end).split("\n")) {
      if (line.trim()) onEvent(w, JSON.parse(line));
    }
  } finally {
    await fh.close();
  }
}

function onEvent(w, ev) {
  const spec = progress.specs[ev.spec];
  if (!spec) return;
  if (ev.event === "start") {
    spec.status = "running";
    spec.worker = w.index;
    spec.startedAt = ev.at;
    writeProgress();
    return;
  }
  if (ev.event !== "end") return;
  const st = ev.stats ?? {};
  spec.worker = w.index;
  spec.tests = st.tests ?? 0;
  spec.passed = st.passes ?? 0;
  spec.failed = st.failures ?? 0;
  spec.pending = st.pending ?? 0;
  spec.skipped = st.skipped ?? 0;
  spec.retried = ev.retried ?? 0;
  spec.durationMs = st.duration ?? st.wallClockDuration ?? null;
  // Cypress's error is a paragraph; its first line says what happened.
  spec.error = ev.error ? String(ev.error).split("\n")[0] : null;
  spec.finishedAt = ev.at;
  spec.carried = false;
  spec.status = spec.failed === 0 && !spec.error ? "passed" : "failed";
  // Only a full pass measures a spec file: a crash or a failure ends it early.
  if (spec.status === "passed" && spec.durationMs > 0)
    progress.durations[ev.spec] = spec.durationMs;
  writeProgress();
  const mark = spec.status === "passed" ? "passed" : `FAILED (${spec.failed} failed)`;
  log(
    progressLine(
      `${w.workers > 1 ? `w${w.index} ` : ""}${basename(ev.spec)} ${mark} in ${fmtMs(spec.durationMs ?? 0)}`,
    ),
  );
}

async function runWorker(w) {
  const out = w.workers > 1 ? createWriteStream(w.logFile) : null;
  const seedCmd = `SEED_TODAY=${SEED_TODAY} npm run seed --silent -w @jsudc/backend -- --reset --db ${w.db}`;
  try {
    say(out, `worker ${w.index}: ${w.keys.length} spec files, database ${redact(w.db)}`);
    if (await ensureDatabase(w.db)) say(out, `created ${databaseName(w.db)}`);
    await run(
      "npm",
      ["run", "db:migrate:test", "--silent", "-w", "@jsudc/backend"],
      { env: { ...process.env, TEST_DATABASE_URL: w.db } },
      out,
    );
    say(
      out,
      `seeding every collection (200 companies, 3 boards, 15 buckets, 60 tickets, ~640 appointments around ${SEED_TODAY}, 80 comments, 134 org nodes, 8,640 metrics ending at its noon)`,
    );
    await run("sh", ["-c", seedCmd], {}, out);

    const backendUrl = `http://127.0.0.1:${w.backendPort}`;
    const webUrl = `http://127.0.0.1:${w.webPort}`;
    say(out, `backend on ${backendUrl}`);
    start(
      `w${w.index} backend`,
      "npx",
      ["tsx", "backend/src/main.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: w.db,
          PORT: String(w.backendPort),
          LOG_LEVEL: "warn",
          UDC_HTTP_FIXTURES: HTTP_FIXTURES,
          UDC_HTTP_SOURCES: "on",
          // flights steps through two recordings, one per upstream call: a 1 s cache lets the
          // spec reach the second without waiting out the real 4 minutes.
          UDC_FLIGHTS_CACHE_TTL_MS: "1000",
        },
      },
      out,
    );
    await waitFor(`${backendUrl}/healthz`, `w${w.index} backend`);

    say(out, `vite on ${webUrl}`);
    start(
      `w${w.index} vite`,
      "npx",
      ["vite", "--host", "127.0.0.1", "--port", String(w.webPort), "--strictPort"],
      {
        cwd: FRONTEND,
        env: {
          ...process.env,
          UDC_PROXY_TARGET: backendUrl,
          // Each worker's Vite optimizes its deps in a cache of its own: no two of them
          // rewriting node_modules/.vite under each other.
          ...(w.workers > 1 ? { VITE_CACHE_DIR: `node_modules/.vite-e2e-${w.index}` } : {}),
        },
      },
      out,
    );
    await waitFor(`${webUrl}/healthz`, `w${w.index} vite proxy`);

    const cypress = (keys) => {
      say(out, `cypress: ${keys.map((k) => basename(k)).join(", ")}`);
      return start(
        `w${w.index} cypress`,
        "npx",
        [
          "cypress",
          "run",
          "--project",
          "frontend",
          "--config",
          // The screenshots folder is shared: emptied once before the workers start, not by each.
          `baseUrl=${webUrl}${w.workers > 1 ? ",trashAssetsBeforeRuns=false" : ""}`,
          "--spec",
          keys.map((k) => join(FRONTEND, k)).join(","),
          ...cypressArgs,
        ],
        {
          env: {
            ...process.env,
            // Specs that edit rows reseed first, so each spec file starts from the same 200 rows.
            E2E_SEED_CMD: `cd ${JSON.stringify(ROOT)} && ${seedCmd}`,
            E2E_EVENTS_FILE: w.eventsFile,
          },
        },
        out,
      );
    };
    w.code = await exitCode(cypress(w.keys));
    // Cypress killed by a signal (exit 128 + n: 132 SIGILL, 133 SIGTRAP, 139 SIGSEGV) is the
    // browser process dying, not a test failing. The files it never finished get one more
    // Cypress; a file that ended, passed or failed, is never run again.
    if (w.code >= 128 && !stopping) {
      await drainEvents(w);
      const unfinished = w.keys.filter(
        (k) => !["passed", "failed"].includes(progress.specs[k].status),
      );
      if (unfinished.length > 0) {
        const msg = `worker ${w.index}: cypress died (exit ${w.code}) with ${unfinished.length} file(s) unfinished; running them once more`;
        say(out, msg);
        if (out) log(msg);
        w.relaunched = unfinished.length;
        w.code = await exitCode(cypress(unfinished));
      }
    }
  } catch (err) {
    w.code = 1;
    w.error = err instanceof Error ? err.message : String(err);
    say(out, `worker ${w.index}: ${w.error}`);
    if (out) log(`worker ${w.index}: ${w.error} (see ${relative(ROOT, w.logFile)})`);
  } finally {
    await drainEvents(w);
    w.done = true;
    w.endedAt = Date.now();
    if (out) await new Promise((r) => out.end(r));
  }
}

// --- the run -------------------------------------------------------------------------------

function finish(status) {
  progress.run.status = status;
  progress.run.finishedAt = new Date().toISOString();
  for (const spec of Object.values(progress.specs)) {
    if (spec.status === "running") spec.status = "interrupted";
  }
  writeProgress();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopAll();
    try {
      finish("interrupted");
      log(`interrupted (${signal}); \`npm run e2e -- --resume\` runs the files that did not pass`);
    } catch {
      // The progress file is best effort here.
    }
    process.exit(130);
  });
}

let code = 1;
try {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(E2E_TMPDIR, { recursive: true });
  checkTmpdir();
  const previous = readProgress();
  const keys = listSpecs();
  if (keys.length === 0) throw new Error("no spec files");

  const durations = { ...(previous?.durations ?? {}) };
  for (const [k, s] of Object.entries(previous?.specs ?? {})) {
    if (s.durationMs > 0) durations[k] = s.durationMs;
  }
  progress.durations = durations;

  let toRun = keys;
  for (const k of keys) {
    const declaredTests = countTests(k);
    const before = previous?.specs?.[k];
    if (resume && before?.status === "passed") {
      // Passed in the run being resumed: carried over as it was.
      progress.specs[k] = { ...before, declaredTests, carried: true };
    } else {
      progress.specs[k] = {
        status: "pending",
        worker: null,
        declaredTests,
        tests: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        skipped: 0,
        retried: 0,
        durationMs: durations[k] ?? null,
        error: null,
        startedAt: null,
        finishedAt: null,
        carried: false,
      };
    }
  }
  if (resume) {
    if (!previous) log(`--resume: no ${relative(ROOT, PROGRESS_FILE)} yet, running everything`);
    toRun = keys.filter((k) => progress.specs[k].status !== "passed");
    progress.run.resumedFrom = previous?.run?.startedAt ?? null;
    log(
      `--resume: ${keys.length - toRun.length} of ${keys.length} files passed in the run of ${previous?.run?.startedAt ?? "—"}, running the other ${toRun.length}`,
    );
    if (toRun.length === 0) {
      recording = true;
      finish("passed");
      log("nothing left to run");
      process.exit(0);
    }
  }

  const groups = balance(toRun, Math.min(workersWanted, toRun.length), durations);
  const workers = groups.length;
  progress.run.workers = workers;
  const taken = new Set();
  for (const [n, g] of groups.entries()) {
    const index = n + 1;
    workerState.push({
      index,
      workers,
      keys: g.keys,
      estimateMs: g.ms,
      db: workerDbUrl(index, workers),
      backendPort: workers === 1 ? backendPortBase : await freePort(backendPortBase, taken),
      webPort: workers === 1 ? webPortBase : await freePort(webPortBase, taken),
      eventsFile: join(OUT_DIR, `e2e-events-w${index}.jsonl`),
      eventsOffset: 0,
      logFile: join(OUT_DIR, `e2e-w${index}.log`),
      code: null,
      error: null,
      done: false,
    });
  }
  if (workers > 1)
    rmSync(join(FRONTEND, "cypress", "screenshots"), { recursive: true, force: true });
  for (const w of workerState) {
    rmSync(w.eventsFile, { force: true });
    for (const k of w.keys) progress.specs[k].worker = w.index;
  }

  const tests = keys.reduce((a, k) => a + progress.specs[k].declaredTests, 0);
  log(
    `${keys.length} spec files, ${tests} tests; ${toRun.length} files to run on ${workers} worker${workers > 1 ? "s" : ""}; progress in ${relative(ROOT, PROGRESS_FILE)}; TMPDIR ${relative(ROOT, E2E_TMPDIR) || E2E_TMPDIR}`,
  );
  for (const w of workerState) {
    log(
      `worker ${w.index}: ${w.keys.length} files (~${fmtMs(w.estimateMs)}), ${redact(w.db)}, backend :${w.backendPort}, vite :${w.webPort}` +
        (workers > 1 ? `, output in ${relative(ROOT, w.logFile)}` : ""),
    );
  }
  recording = true;
  writeProgress();

  const poll = setInterval(() => {
    for (const w of workerState) drainEvents(w);
  }, 1000);
  await Promise.all(workerState.map(runWorker));
  clearInterval(poll);

  // Specs a worker never reported (it failed to start, or Cypress died) did not pass.
  const missed = toRun.filter((k) => !["passed", "failed"].includes(progress.specs[k].status));
  for (const k of missed) progress.specs[k].status = "not run";
  const ok = workerState.every((w) => w.code === 0 && !w.error) && missed.length === 0;
  const s = summarize();
  finish(ok && s.filesFailed === 0 ? "passed" : "failed");

  log("summary");
  for (const w of workerState) {
    const mine = w.keys.map((k) => progress.specs[k]);
    const passed = mine.reduce((a, x) => a + x.passed, 0);
    const failed = mine.reduce((a, x) => a + x.failed, 0);
    console.log(
      `  worker ${w.index}: ${mine.filter((x) => x.status === "passed").length}/${mine.length} files passed, ` +
        `${passed} tests passed, ${failed} failed, ${fmtMs(w.endedAt - startedAt)}, exit ${w.code}` +
        (w.error ? ` — ${w.error}` : "") +
        (w.relaunched
          ? `, cypress relaunched once for ${w.relaunched} file(s) after it died`
          : "") +
        (workers > 1 ? ` (${relative(ROOT, w.logFile)})` : ""),
    );
  }
  for (const [k, x] of Object.entries(progress.specs)) {
    if (x.status !== "passed")
      console.log(`  ${x.status.toUpperCase()}: ${k}${x.error ? ` — ${x.error}` : ""}`);
  }
  const carried = Object.values(progress.specs).filter((x) => x.carried).length;
  console.log(
    `  total: ${s.filesPassed}/${s.files} files passed${carried ? ` (${carried} carried from the resumed run)` : ""}, ` +
      `${s.passed} tests passed, ${s.failed} failed, ${s.pending} pending, ${s.skipped} skipped; wall clock ${fmtMs(Date.now() - startedAt)}`,
  );
  code = ok && s.filesFailed === 0 ? 0 : 1;
} catch (err) {
  console.error(`[e2e] ${err instanceof Error ? err.message : err}`);
  try {
    finish("failed");
  } catch {
    // Nothing more to record.
  }
} finally {
  stopAll();
}
process.exit(code);
