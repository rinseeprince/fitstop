/**
 * Times Better Auth's database reads against DEV, run before
 * docs/BETTER-AUTH-PLAN.md section 6 commit 10.5 and after it (section 5,
 * proof 10.5), so the two sets of numbers stand side by side. Every number is
 * from wherever it runs: far from DEV, a round trip is most of each one.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/auth-latency-probe.ts
 *
 * In this process, through lib/auth.ts's own pool and Better Auth, with the
 * settings each of the server's bundles gets:
 *   - a query on an open connection;
 *   - a session read as the proxy and the seam make it (readSessionUserId),
 *     warm and after an 11 s pause, just past node-postgres's default idle
 *     limit, with the statements each sent and whether it had to connect;
 *   - a Supabase data read (the proxy's role read) and an Upstash read (the
 *     seam's cache), warm and after the same pauses, for scale;
 *   - last, the pool left idle three minutes: its next query's time, and
 *     whether the pool connected again for it.
 * Against a next dev it starts on a free port (never :3000), signed in as a
 * throwaway coach with the cookie a browser keeps:
 *   - GET /api/auth/me and the Invite box's read
 *     (GET /api/clients/<id>/invitation), warm and after an 11 s pause, with
 *     the statements Better Auth sent and every database call each request
 *     made, as the server printed them ([db] lines, PERF_COUNT=1).
 * It writes nothing but the throwaway coach's login and rows and a pending
 * client of theirs, all removed at the end, and prints no token, cookie or
 * password.
 */
import "./env-bootstrap";

import { createHmac } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { auth, authPool, readSessionUserId } from "@/lib/auth";
import { parseDbCallLine } from "@/lib/perf/db-calls";
import { getRedisClient } from "@/lib/rate-limit";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createThrowawayLogin, deleteThrowawayLogin } from "./auth-fixtures";
import { DEV_REF, projectEnv, refuseUnlessProject } from "./project-ref";
import { ServerLines, startProofServer, stopProofServer, type ProofServer } from "./proof-server";
import { signInOverHttp, type ProofSession } from "./proof-session";

const STAMP = Date.now();
const COACH = `auth-latency-probe-${STAMP}-coach@fixture.local`;
const CLIENT = `auth-latency-probe-${STAMP}-client@fixture.local`;
/** Every throwaway address any run of this probe makes. */
const ADDRESS_PATTERN = "auth-latency-probe-%@fixture.local";
/** Warm samples of a read, back to back. */
const WARM_SAMPLES = 5;
/** Samples of a read after a pause, each after its own. */
const PAUSED_SAMPLES = 3;
/** Just past node-postgres's default idle limit (10 s): a pool on pg's defaults has closed its connection by then. */
const PAUSE_MS = 11_000;
/** How long the pool is left idle before its last query: three minutes, inside the five-minute limit of D46. */
const IDLE_HOLD_MS = 3 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
/** A query on a connection the network dropped without a word would wait on TCP: past this, the probe says so. */
const QUERY_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

/** The throwaway coach's password, derived so that nothing writes it down. */
function coachPassword(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Missing BETTER_AUTH_SECRET in .env.local");
  return createHmac("sha256", secret).update(COACH).digest("base64url").slice(0, 32);
}

// ---------------------------------------------------------------------------
// This process's pool, as lib/auth.ts builds it
// ---------------------------------------------------------------------------

/**
 * What this process's pool did: the connections it opened, the connections
 * handed out (one per statement outside a transaction, which is how Better
 * Auth's reads and the pool's own query take them), and when one last came
 * back.
 */
const pool = { connections: 0, checkouts: 0, lastReturned: Date.now() };
authPool.on("connect", () => {
  pool.connections += 1;
});
authPool.on("acquire", () => {
  pool.checkouts += 1;
});
authPool.on("release", () => {
  pool.lastReturned = Date.now();
});

/** One timed read: its time; a read of this process's pool, the statements it sent and whether it connected; a route's, its calls. */
type Sample = { ms: number; statements?: number; connected?: boolean; calls?: number };

async function timed(read: () => Promise<unknown>): Promise<Sample> {
  const started = performance.now();
  await read();
  return { ms: performance.now() - started };
}

async function poolTimed(read: () => Promise<unknown>): Promise<Sample> {
  const before = { ...pool };
  const { ms } = await timed(read);
  return { ms, statements: pool.checkouts - before.checkouts, connected: pool.connections > before.connections };
}

async function samples(count: number, take: () => Promise<Sample>): Promise<Sample[]> {
  const taken: Sample[] = [];
  for (let i = 0; i < count; i += 1) taken.push(await take());
  return taken;
}

/** The settings in effect, as the pool and Better Auth hold them. */
function settings(): string {
  const { idleTimeoutMillis, keepAlive, keepAliveInitialDelayMillis, allowExitOnIdle } = authPool.options;
  const options: BetterAuthOptions = auth.options;
  const joins = options.advanced?.database?.joins === true;
  const keepAliveText = keepAlive ? `on, first probe after ${keepAliveInitialDelayMillis ? `${keepAliveInitialDelayMillis / 1000} s` : "the system's default"}` : "off";
  return [
    `an idle connection closes after ${idleTimeoutMillis === null ? "never" : `${idleTimeoutMillis / 1000} s`}`,
    `TCP keep-alive ${keepAliveText}`,
    `idle connections ${allowExitOnIdle ? "let" : "keep"} a script ${allowExitOnIdle ? "exit" : "running"}`,
    `a session read ${joins ? "joins its login in one query" : "reads its login in a second query"}`,
  ].join("; ");
}

// ---------------------------------------------------------------------------
// The reads
// ---------------------------------------------------------------------------

/** A session read as the proxy and the seam make it; it must name the coach. */
async function sessionRead(cookie: Headers, userId: string): Promise<void> {
  const read = await readSessionUserId(cookie);
  if (read !== userId) throw new Error(`The session read named ${read === null ? "nobody" : "another login"}`);
}

/** The proxy's role read: one PostgREST call through supabaseAdmin. */
async function supabaseRead(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.from("profiles").select("role").eq("user_id", userId).single();
  if (error || data?.role !== "trainer") throw new Error(`The role read: ${error?.message ?? data?.role}`);
}

/** The seam's cache read: one Upstash GET, of a key nothing writes. */
async function upstashRead(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) throw new Error("Upstash is not configured in .env.local");
  await redis.get(`auth-latency-probe:${STAMP}`);
}

/** A query answered within QUERY_TIMEOUT_MS, else a refusal saying so. */
async function withinTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${QUERY_TIMEOUT_MS / 1000} s`)), QUERY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One GET of the app as the session, after `pauseMs` of quiet: its time, the
 * statements Better Auth sent for it and every database call it made, from
 * the [db] lines the server printed while it ran.
 */
async function routeRead(base: string, session: ProofSession, path: string, lines: ServerLines, pauseMs = 0): Promise<Sample> {
  await lines.settle();
  if (pauseMs > 0) await sleep(pauseMs);
  const from = lines.lines.length;
  const started = performance.now();
  const res = await fetch(`${base}${path}`, {
    headers: { ...session.headers, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await res.arrayBuffer();
  const ms = performance.now() - started;
  if (res.status !== 200) throw new Error(`${path} answered ${res.status}`);
  await lines.settle();
  const printed = lines.lines.slice(from).flatMap((line) => parseDbCallLine(line) ?? []);
  return { ms, statements: printed.filter((call) => call.kind === "pg").length, calls: printed.length };
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

type Row = { label: string; taken: Sample[] };
const rows: Array<Row | string> = [];
let made: { userId: string; clientId: string | null } | null = null;

async function probe(server: ProofServer): Promise<void> {
  console.info(`lib/auth.ts: ${settings()}`);
  console.info("Setup: a throwaway coach, a pending client of theirs, and the coach signed in over HTTP");
  const login = await createThrowawayLogin({ role: "coach", email: COACH, password: coachPassword(), name: "Auth latency probe coach" });
  made = { userId: login.userId, clientId: null };
  if (!login.coachId) throw new Error("No coach row for the throwaway coach");
  const { data: client, error } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: login.coachId, name: "Auth latency probe client", email: CLIENT, active: true, onboarding_status: "setup_in_progress", timezone: "Europe/London", user_id: null })
    .select("id")
    .single();
  if (error || !client) throw new Error(`client insert: ${error?.message}`);
  made.clientId = client.id;
  const session = await signInOverHttp(server.base, COACH, coachPassword(), "coach");
  const cookie = new Headers(session.headers);
  const userId = login.userId;

  console.info("In this process: warm-up (Better Auth's schema check, each client's first connection), then the reads");
  await sessionRead(cookie, userId);
  await supabaseRead(userId);
  await upstashRead();
  rows.push("In this process");
  rows.push({ label: "a query on an open connection", taken: await samples(WARM_SAMPLES, () => poolTimed(() => authPool.query("select 1"))) });
  rows.push({ label: "a session read, warm", taken: await samples(WARM_SAMPLES, () => poolTimed(() => sessionRead(cookie, userId))) });
  rows.push({ label: "a Supabase data read, warm", taken: await samples(WARM_SAMPLES, () => timed(() => supabaseRead(userId))) });
  rows.push({ label: "an Upstash read, warm", taken: await samples(WARM_SAMPLES, () => timed(() => upstashRead())) });
  const paused = { session: [] as Sample[], supabase: [] as Sample[], upstash: [] as Sample[] };
  for (let i = 0; i < PAUSED_SAMPLES; i += 1) {
    console.info(`  pause ${i + 1} of ${PAUSED_SAMPLES}: ${PAUSE_MS / 1000} s`);
    await sleep(PAUSE_MS);
    paused.session.push(await poolTimed(() => sessionRead(cookie, userId)));
    paused.supabase.push(await timed(() => supabaseRead(userId)));
    paused.upstash.push(await timed(() => upstashRead()));
  }
  const after = `after a pause of ${PAUSE_MS / 1000} s`;
  rows.push({ label: `a session read, ${after}`, taken: paused.session });
  rows.push({ label: `a Supabase data read, ${after}`, taken: paused.supabase });
  rows.push({ label: `an Upstash read, ${after}`, taken: paused.upstash });

  console.info(`Against the next dev at ${server.base}: GET /api/auth/me and the Invite box's read`);
  rows.push(`Against the next dev, as the coach's browser`);
  const lines = new ServerLines(server.output);
  for (const [label, path] of [
    ["GET /api/auth/me", "/api/auth/me"],
    ["the Invite box's read", `/api/clients/${client.id}/invitation`],
  ] as const) {
    // The first request compiles the route and fills the seam's cache.
    await routeRead(server.base, session, path, lines);
    rows.push({ label: `${label}, warm`, taken: await samples(WARM_SAMPLES, () => routeRead(server.base, session, path, lines)) });
    console.info(`  ${label}: ${PAUSED_SAMPLES} pauses of ${PAUSE_MS / 1000} s`);
    rows.push({ label: `${label}, ${after}`, taken: await samples(PAUSED_SAMPLES, () => routeRead(server.base, session, path, lines, PAUSE_MS)) });
  }

  const idleSoFar = Date.now() - pool.lastReturned;
  console.info(`The pool left idle ${IDLE_HOLD_MS / 60_000} min: ${Math.round(Math.max(0, IDLE_HOLD_MS - idleSoFar) / 1000)} s to go`);
  if (idleSoFar < IDLE_HOLD_MS) await sleep(IDLE_HOLD_MS - idleSoFar);
  const idleFor = Date.now() - pool.lastReturned;
  const openBefore = authPool.totalCount;
  // An idle limit longer than the wait (or none) promises the connection is still open.
  const { idleTimeoutMillis } = authPool.options;
  const keptOpen = !idleTimeoutMillis || idleTimeoutMillis > idleFor;
  try {
    const held = await poolTimed(() => withinTimeout(authPool.query("select 1")));
    rows.push(
      `The pool left idle ${Math.round(idleFor / 1000)} s, with ${openBefore} connection(s) still open: its next query answered in ` +
        `${Math.round(held.ms)} ms, ${held.connected ? "on a new connection" : "on the open one, with no reconnect"}`
    );
    if (keptOpen && held.connected) {
      fail(`the pool keeps an idle connection ${idleTimeoutMillis ? `${idleTimeoutMillis / 1000} s` : "for good"}, yet after ${Math.round(idleFor / 1000)} s its next query had to connect again: the pooler or the network dropped it`);
    }
  } catch (refusal) {
    fail(`the pool left idle ${Math.round(idleFor / 1000)} s: its next query failed: ${refusal instanceof Error ? refusal.message : String(refusal)}`);
  }
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A count over the samples: the one value when they agree, else the fewest and the most. */
function countOf(values: Array<number | undefined>): string {
  const known = values.filter((value): value is number => value !== undefined);
  if (known.length === 0) return "";
  const [least, most] = [Math.min(...known), Math.max(...known)];
  return least === most ? String(least) : `${least}–${most}`;
}

function printTable(): void {
  const width = Math.max(...rows.map((row) => (typeof row === "string" ? 0 : row.label.length)));
  const cell = (text: string, size: number) => text.padStart(size);
  const ms = (value: number) => `${Math.round(value)} ms`;
  const head = `  ${"".padEnd(width)}${cell("median", 9)}${cell("fastest", 9)}${cell("slowest", 9)}${cell("statements", 12)}${cell("db calls", 10)}${cell("connected", 11)}`;
  console.info(`\n${head}\n${"-".repeat(head.length)}`);
  for (const row of rows) {
    if (typeof row === "string") {
      console.info(row);
      continue;
    }
    const times = row.taken.map((sample) => sample.ms);
    const connected = row.taken.some((sample) => sample.connected !== undefined)
      ? `${row.taken.filter((sample) => sample.connected).length} of ${row.taken.length}`
      : "";
    console.info(
      `  ${row.label.padEnd(width)}${cell(ms(median(times)), 9)}${cell(ms(Math.min(...times)), 9)}${cell(ms(Math.max(...times)), 9)}` +
        `${cell(countOf(row.taken.map((sample) => sample.statements)), 12)}${cell(countOf(row.taken.map((sample) => sample.calls)), 10)}${cell(connected, 11)}`
    );
  }
  console.info("\nstatements: what Better Auth sent through its pool; db calls: every database call the request made, Better Auth's among them;");
  console.info("connected: the reads that had to open a connection first.");
}

// ---------------------------------------------------------------------------
// Cleanup and the run
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  console.info("Cleanup");
  try {
    if (made?.clientId) {
      const { error } = await supabaseAdmin.from("clients").delete().eq("id", made.clientId);
      if (error) throw new Error(`client row: ${error.message}`);
    }
    // The login, its profile and its coach row; its sessions and password go with the login.
    await deleteThrowawayLogin(COACH);
    const { rows: left } = await authPool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1)
             + (SELECT count(*) FROM public.clients WHERE email LIKE $1))::int AS n`,
      [ADDRESS_PATTERN]
    );
    if (left[0]?.n !== 0) fail(`cleanup: ${left[0]?.n} throwaway row(s) left`);
    else console.info("  ✓ no throwaway login, coach row or client row is left");
  } catch (error) {
    fail(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  refuseUnlessProject(DEV_REF, projectEnv());
  let server: ProofServer | null = null;
  try {
    server = await startProofServer();
    await probe(server);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    try {
      await cleanup();
    } finally {
      await stopProofServer();
      await authPool.end();
    }
  }
  printTable();
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    if (server) console.error(server.output.join("").slice(-2000));
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
