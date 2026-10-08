/**
 * Request-level proof of docs/BETTER-AUTH-PLAN.md section 6 commit 1: Better
 * Auth stands up beside Supabase Auth on DEV, holding a copy of the logins,
 * and answers under /api/auth while every sign-in runs on Supabase.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/better-auth-standup-proof.ts prepare
 *   npx tsx --tsconfig ./tsconfig.json scripts/better-auth-standup-proof.ts check
 *
 * prepare makes a throwaway Supabase login with a known password through
 * auth.admin.createUser (Supabase's sign-up trigger makes its profile and
 * coach row). Run before migration 208 is pushed, the push's copy brings it
 * across. Run once 208 is on the database, prepare copies it with 208's own
 * copy statements and closing check, read from the migration file, and
 * refuses when any other login, or any other login's password, is uncopied
 * (bringing those across is migration 209's). The password is derived from the address and
 * BETTER_AUTH_SECRET, so check knows it and nothing writes it down.
 *
 * check starts its own next dev on a free port (never :3000), with Better
 * Auth's base URL and the app URL set to that port's origin, and drives it:
 *   1  the copy: every auth.users row with an address has a Better Auth login
 *      on its id, and every one with a password a credential row; the
 *      throwaway's carries its coach name, its address and its bcrypt hash
 *   2  the throwaway signs in through POST /api/auth/sign-in/email with its
 *      Supabase password: 200, set-auth-token and the session cookie, the
 *      user its Supabase id
 *   3  GET /api/auth/get-session answers that user, from the cookie and from
 *      the bearer token alone
 *   4  a wrong password: 401 INVALID_EMAIL_OR_PASSWORD
 *   5  POST /api/auth/sign-up/email is refused and makes no login
 *   6  a sign-in posted from an untrusted origin is refused
 *   7  Supabase still signs everyone in: the throwaway's Supabase session
 *      opens /dashboard and GET /api/auth/me (its trainer profile); with no
 *      session /api/auth/me answers its own 401, the middleware leaving
 *      /api/auth/ to its routes
 * Cleanup runs whatever failed: every throwaway's Better Auth login (its
 * sessions and credential go with it) and its Supabase login (its profile and
 * coach row go with it), any Better Auth login on a throwaway address, then
 * the dev server this run started. An interrupted run (SIGINT, SIGTERM,
 * SIGHUP), or any exit that skips the cleanup, stops that server; an
 * interrupt leaves the throwaway for the next check. No token or password is
 * printed.
 */
import "./env-bootstrap";

import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Client } from "pg";
import { supabaseAdmin } from "@/services/supabase-admin";
import { parseDatabaseUrl, supabaseConnection } from "@/lib/supabase-connection";
import { mintSession } from "./proof-session";

const DEV_REF = "aeaphsslctwcmebldrzx";
const ROOT = join(__dirname, "..");
const MIGRATION_208 = join(ROOT, "supabase/migrations/208_better_auth_schema.sql");
const ADDRESS_PREFIX = "better-auth-standup-proof-";
const ADDRESS_DOMAIN = "@fixture.local";
const ADDRESS_PATTERN = `${ADDRESS_PREFIX}%${ADDRESS_DOMAIN}`;
const NAME = "Better Auth stand-up proof";
const READY_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;

let failures = 0;
/** One check. Its detail is the evidence printed on failure: never a token, a cookie or a password. */
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local`);
  return value;
}

/** DEV only: the linked project, the pooler string and the Supabase URL must all name DEV's ref. */
function assertDev(): void {
  const linked = readFileSync(join(ROOT, "supabase/.temp/project-ref"), "utf8").trim();
  const database = parseDatabaseUrl(need("DATABASE_URL"));
  const supabase = new URL(need("NEXT_PUBLIC_SUPABASE_URL"));
  if (linked !== DEV_REF || database.username !== `postgres.${DEV_REF}` || supabase.hostname !== `${DEV_REF}.supabase.co`) {
    throw new Error(`Refused: this proof runs on DEV (${DEV_REF}) alone; the linked ref, DATABASE_URL and NEXT_PUBLIC_SUPABASE_URL must all name it.`);
  }
}

/** One client through the pooler as postgres, TLS verified as lib/auth.ts verifies it; its notices are printed. */
async function withDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(supabaseConnection(need("DATABASE_URL")));
  client.on("notice", (notice) => console.info(`  (database) ${notice.message}`));
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return withDatabase(async (client) => (await client.query(text, values)).rows as T[]);
}

/** The throwaway's password, derived so that check knows it and nothing writes it down. */
function passwordFor(address: string): string {
  return createHmac("sha256", need("BETTER_AUTH_SECRET")).update(address).digest("base64url").slice(0, 32);
}

type Throwaway = { id: string; email: string };

async function throwaways(): Promise<Throwaway[]> {
  return sql<Throwaway>("SELECT id::text AS id, email FROM auth.users WHERE email LIKE $1 ORDER BY created_at", [ADDRESS_PATTERN]);
}

async function migration208Applied(): Promise<boolean> {
  const [row] = await sql<{ found: string | null }>(`SELECT to_regclass('better_auth."user"')::text AS found`);
  return row?.found !== null && row?.found !== undefined;
}

/**
 * Migration 208's copy (its two INSERTs) and its closing check, as the file
 * holds them. Each anchor must occur once: the header's list names the
 * sections too, and a slice from there would rerun the tables' statements.
 */
function migration208Copy(): { copy: string; closingCheck: string } {
  const text = readFileSync(MIGRATION_208, "utf8");
  const at = (anchor: string) => {
    const first = text.indexOf(anchor);
    if (first < 0 || first !== text.lastIndexOf(anchor)) throw new Error(`Migration 208's "${anchor}" is not in the file exactly once.`);
    return first;
  };
  const copyAt = at('INSERT INTO better_auth."user"');
  const checkAt = at("-- 3. The closing check.");
  if (checkAt < copyAt) throw new Error("Migration 208's closing check comes before its copy.");
  return { copy: text.slice(copyAt, checkAt), closingCheck: text.slice(checkAt) };
}

/**
 * Once 208 is on the database, the throwaway is copied by 208's own
 * statements, and nothing else is: refused while any other login lacks its
 * copy, or has a password and no copied credential (a password Supabase set
 * after 208 ran), since either INSERT would bring those across too.
 */
async function copyWithMigration208(id: string): Promise<void> {
  const [others] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM auth.users u
      WHERE u.email IS NOT NULL AND u.id <> $1
        AND (NOT EXISTS (SELECT 1 FROM better_auth."user" b WHERE b.id = u.id)
             OR (coalesce(u.encrypted_password, '') <> ''
                 AND NOT EXISTS (SELECT 1 FROM better_auth.account a
                                  WHERE a."userId" = u.id AND a."providerId" = 'credential')))`,
    [id]
  );
  if ((others?.n ?? 0) > 0) {
    throw new Error(
      `Refused: ${others?.n} other login(s) have no Better Auth copy, or a password with no copied credential, and 208's copy would bring them across too (that is migration 209's).`
    );
  }
  const { copy, closingCheck } = migration208Copy();
  await withDatabase(async (client) => {
    await client.query(copy);
    await client.query(closingCheck);
  });
}

async function prepare(): Promise<void> {
  assertDev();
  const left = await throwaways();
  if (left.length > 0) {
    throw new Error(`Refused: an earlier throwaway is still there (${left.map((t) => t.email).join(", ")}). Run check to remove it.`);
  }

  const email = `${ADDRESS_PREFIX}${Date.now()}${ADDRESS_DOMAIN}`;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: passwordFor(email),
    email_confirm: true,
    user_metadata: { name: NAME },
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const id = data.user.id;

  try {
    const [profile] = await sql<{ role: string }>("SELECT role FROM public.profiles WHERE user_id = $1", [id]);
    const [coach] = await sql<{ name: string }>("SELECT name FROM public.coaches WHERE user_id = $1", [id]);
    if (profile?.role !== "trainer" || coach?.name !== NAME) {
      throw new Error(`Supabase's sign-up trigger did not make the trainer profile and coach row (${profile?.role ?? "no profile"}, ${coach?.name ?? "no coach row"}).`);
    }
    console.info(`Prepared ${email} (${id}): a Supabase login with a password, its trainer profile and its coach row "${coach.name}".`);
    if (await migration208Applied()) {
      await copyWithMigration208(id);
      console.info("Migration 208 is on the database: its own copy statements and closing check copied the login. Run check.");
    } else {
      console.info("Push migration 208, then run check.");
    }
  } catch (failure) {
    await cleanup();
    throw failure;
  }
}

/** A free port that is not :3000, which belongs to whoever runs a dev server there. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 && port !== 3000 ? resolve(port) : reject(new Error(`No usable port (${port})`))));
    });
  });
}

type DevServer = { base: string; child: ChildProcess; output: string[] };

/** The dev server this run started, from the moment it is spawned: stopped by check's cleanup and by an interrupt. */
let devServer: DevServer | null = null;

/** next dev on its own port, in its own process group, so this run stops it and nothing else. */
async function startDevServer(): Promise<DevServer> {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const output: string[] = [];
  const child = spawn(join(ROOT, "node_modules/.bin/next"), ["dev", "--port", String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), BETTER_AUTH_URL: base, NEXT_PUBLIC_APP_URL: base },
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  const server: DevServer = { base, child, output };
  devServer = server;

  const started = Date.now();
  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`next dev exited before it was ready (another next dev may hold this folder):\n${output.join("").slice(-1500)}`);
    }
    try {
      const res = await fetch(`${base}/login`, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (res.status === 200) {
        console.info(`Started next dev at ${base} (pid ${child.pid})`);
        return server;
      }
    } catch {
      // Not listening yet: keep waiting until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`next dev did not answer /login within ${READY_TIMEOUT_MS / 1000} s:\n${output.join("").slice(-1500)}`);
}

/**
 * SIGTERM to the dev server's process group while it still runs. Synchronous,
 * so the exit handler can call it; stopDevServer, below, waits for the exit.
 */
function terminateDevServer(): void {
  const child = devServer?.child;
  if (child?.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    // ESRCH: the group ended before its exit was seen, so nothing is left to stop.
    console.error(`next dev (pid ${child.pid}) had already stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function stopDevServer({ child }: DevServer): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  process.kill(-child.pid, "SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS)),
  ]);
  if (!stopped && child.exitCode === null) process.kill(-child.pid, "SIGKILL");
  console.info(`Stopped next dev (pid ${child.pid})`);
}

type Answer = { status: number; json: unknown; headers: Headers };

async function request(
  base: string,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; headers?: Record<string, string> } = {}
): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = text.slice(0, 200);
  }
  return { status: res.status, json, headers: res.headers };
}

/** The session cookie a response set, as the name=value a browser would send back. */
function sessionCookie(headers: Headers): string | null {
  const set = headers.getSetCookie().find((cookie) => cookie.startsWith("better-auth.session_token="));
  return set ? set.split(";")[0] : null;
}

/** What a failed check may print of an answer: its status, its code and whose session it is, never its tokens. */
function evidence(answer: Answer): { status: number; code?: string; userId?: string | null } {
  const json = answer.json as { code?: string; user?: { id?: string } } | string | null;
  if (typeof json !== "object" || json === null) return { status: answer.status };
  return { status: answer.status, code: json.code, userId: json.user?.id ?? null };
}

async function proveCopy(email: string, id: string): Promise<void> {
  console.info("1. The copy");
  const [counts] = await sql<{ logins: number; passwords: number; missing_logins: number; missing_passwords: number }>(`
    SELECT count(*) FILTER (WHERE u.email IS NOT NULL)::int AS logins,
           count(*) FILTER (WHERE u.email IS NOT NULL AND coalesce(u.encrypted_password, '') <> '')::int AS passwords,
           count(*) FILTER (WHERE u.email IS NOT NULL
                              AND NOT EXISTS (SELECT 1 FROM better_auth."user" b WHERE b.id = u.id))::int AS missing_logins,
           count(*) FILTER (WHERE u.email IS NOT NULL AND coalesce(u.encrypted_password, '') <> ''
                              AND NOT EXISTS (SELECT 1 FROM better_auth.account a
                                               WHERE a."userId" = u.id AND a."providerId" = 'credential'))::int AS missing_passwords
      FROM auth.users u`);
  check(
    `every one of the ${counts.logins} logins has a Better Auth login on its id, and every one of the ${counts.passwords} with a password a credential row`,
    counts.missing_logins === 0 && counts.missing_passwords === 0,
    counts
  );
  const [copied] = await sql<{ name: string; email: string; verified: boolean; same_hash: boolean; bcrypt: boolean; account_id: string }>(
    `SELECT b.name, b.email, b."emailVerified" AS verified, a.password = u.encrypted_password AS same_hash,
            a.password LIKE '$2a$%' AS bcrypt, a."accountId" AS account_id
       FROM better_auth."user" b
       JOIN better_auth.account a ON a."userId" = b.id AND a."providerId" = 'credential'
       JOIN auth.users u ON u.id = b.id
      WHERE b.id = $1`,
    [id]
  );
  check(
    "the throwaway's copy: its coach name, its address, verified, its Supabase bcrypt hash, keyed on its id",
    copied?.name === NAME && copied.email === email && copied.verified && copied.same_hash && copied.bcrypt && copied.account_id === id,
    copied
  );
}

async function proveBetterAuth(base: string, email: string, id: string): Promise<void> {
  const origin = { Origin: base };

  console.info("2. Sign-in with the Supabase password");
  const signIn = await request(base, "POST", "/api/auth/sign-in/email", { body: { email, password: passwordFor(email) }, headers: origin });
  const token = signIn.headers.get("set-auth-token");
  const cookie = sessionCookie(signIn.headers);
  const signedIn = signIn.json as { user?: { id?: string; emailVerified?: boolean } } | null;
  check("200, the user its Supabase id", signIn.status === 200 && signedIn?.user?.id === id && signedIn.user.emailVerified === true, evidence(signIn));
  check("the response carries set-auth-token and the session cookie", !!token && !!cookie, { token: !!token, cookie: !!cookie });
  const [sessions] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM better_auth.session WHERE "userId" = $1`, [id]);
  check("a session row for the login", sessions?.n === 1, sessions);

  console.info("3. The session");
  const fromCookie = await request(base, "GET", "/api/auth/get-session", { headers: cookie ? { Cookie: cookie } : {} });
  check("GET /api/auth/get-session with the cookie → the Supabase user id", fromCookie.status === 200 && evidence(fromCookie).userId === id, evidence(fromCookie));
  const fromBearer = await request(base, "GET", "/api/auth/get-session", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  check("with the bearer token alone, no cookie → the same user", fromBearer.status === 200 && evidence(fromBearer).userId === id, evidence(fromBearer));
  const signedOut = await request(base, "GET", "/api/auth/get-session");
  check("with neither → no session (null)", signedOut.status === 200 && signedOut.json === null, evidence(signedOut));

  console.info("4. A wrong password");
  const wrong = await request(base, "POST", "/api/auth/sign-in/email", { body: { email, password: `${passwordFor(email)}x` }, headers: origin });
  check("401 INVALID_EMAIL_OR_PASSWORD, no cookie", wrong.status === 401 && evidence(wrong).code === "INVALID_EMAIL_OR_PASSWORD" && sessionCookie(wrong.headers) === null, evidence(wrong));

  console.info("5. Sign-up");
  const newAddress = `${ADDRESS_PREFIX}signup-${Date.now()}${ADDRESS_DOMAIN}`;
  const signUp = await request(base, "POST", "/api/auth/sign-up/email", { body: { email: newAddress, password: passwordFor(newAddress), name: "Nobody" }, headers: origin });
  const [made] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM better_auth."user" WHERE email = $1`, [newAddress]);
  check("refused (EMAIL_PASSWORD_SIGN_UP_DISABLED), and no login made", signUp.status === 400 && evidence(signUp).code === "EMAIL_PASSWORD_SIGN_UP_DISABLED" && made?.n === 0, { answer: evidence(signUp), made });

  console.info("6. An untrusted origin");
  const foreign = await request(base, "POST", "/api/auth/sign-in/email", { body: { email, password: passwordFor(email) }, headers: { Origin: "https://evil.example" } });
  check("a sign-in posted from https://evil.example is refused (403), no cookie", foreign.status === 403 && sessionCookie(foreign.headers) === null, evidence(foreign));
}

async function proveSupabaseStillSignsIn(base: string, email: string): Promise<void> {
  console.info("7. Supabase still signs everyone in");
  const supabaseSession = await mintSession(email, "throwaway");
  const dashboard = await fetch(`${base}/dashboard`, { redirect: "manual", headers: { Cookie: supabaseSession.cookie }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  check("the Supabase session opens /dashboard (200)", dashboard.status === 200, dashboard.status);
  const me = await request(base, "GET", "/api/auth/me", { headers: { Cookie: supabaseSession.cookie } });
  const profile = (me.json as { data?: { profile?: { role?: string }; coach?: { name?: string } } } | null)?.data;
  check(
    "and GET /api/auth/me answers its trainer profile and coach",
    me.status === 200 && profile?.profile?.role === "trainer" && profile.coach?.name === NAME,
    { status: me.status, role: profile?.profile?.role, coach: profile?.coach?.name }
  );
  const meSignedOut = await request(base, "GET", "/api/auth/me");
  check(
    "with no session /api/auth/me answers its own 401 (not the middleware's 307 to /login)",
    meSignedOut.status === 401 && JSON.stringify(meSignedOut.json) === JSON.stringify({ success: false, error: "Unauthorized" }),
    { status: meSignedOut.status, body: meSignedOut.json }
  );
}

/** One throwaway, both sides; a failure is printed and counted, and the next throwaway is still tried. */
async function removeThrowaway({ id, email }: Throwaway, copied: boolean): Promise<void> {
  try {
    if (copied) await sql(`DELETE FROM better_auth."user" WHERE id = $1`, [id]);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) throw new Error(`the Supabase login was not deleted: ${error.message}`);
    const [supabaseSide] = await sql<{ n: number }>(
      `SELECT ((SELECT count(*) FROM auth.users WHERE id = $1)
             + (SELECT count(*) FROM public.profiles WHERE user_id = $1)
             + (SELECT count(*) FROM public.coaches WHERE user_id = $1))::int AS n`,
      [id]
    );
    const [betterAuthSide] = copied
      ? await sql<{ n: number }>(
          `SELECT ((SELECT count(*) FROM better_auth."user" WHERE id = $1)
                 + (SELECT count(*) FROM better_auth.session WHERE "userId" = $1)
                 + (SELECT count(*) FROM better_auth.account WHERE "userId" = $1))::int AS n`,
          [id]
        )
      : [{ n: 0 }];
    const left = (supabaseSide?.n ?? 0) + (betterAuthSide?.n ?? 0);
    if (left > 0) throw new Error(`${left} rows left`);
    console.info(`  ${email}: both logins removed, with its profile, coach row, sessions and credential`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${email}: cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Every throwaway, and any Better Auth login a regressed sign-up made on a throwaway address. */
async function cleanup(): Promise<void> {
  console.info("Cleanup");
  const copied = await migration208Applied();
  for (const throwaway of await throwaways()) await removeThrowaway(throwaway, copied);
  if (copied) {
    const stray = await sql<{ email: string }>(`DELETE FROM better_auth."user" WHERE email LIKE $1 RETURNING email`, [ADDRESS_PATTERN]);
    for (const { email } of stray) console.error(`  ✗ ${email}: a Better Auth login no proof step should have made, removed`);
    failures += stray.length;
  }
}

async function runCheck(): Promise<void> {
  assertDev();
  if (!(await migration208Applied())) throw new Error("Migration 208 is not on this database yet: push it, then run check.");
  const [throwaway] = await throwaways();
  if (!throwaway) throw new Error("No throwaway found: run prepare first.");

  // The server this run starts runs in its own process group and holds next
  // dev's lock on this folder, so nothing else would stop it: any exit that
  // skips the cleanup below stops it, and so does an interrupt (Ctrl-C, a
  // kill, a closed terminal), which leaves the throwaway for the next check.
  process.on("exit", terminateDevServer);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      console.error(`Interrupted (${signal}): next dev stopped; the throwaway stays until the next check.`);
      process.exit(130);
    });
  }

  try {
    await proveCopy(throwaway.email, throwaway.id);
    const server = await startDevServer();
    await proveBetterAuth(server.base, throwaway.email, throwaway.id);
    await proveSupabaseStillSignsIn(server.base, throwaway.email);
  } finally {
    try {
      await cleanup();
    } finally {
      if (devServer) await stopDevServer(devServer);
    }
  }
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    if (devServer) console.error(devServer.output.join("").slice(-2000));
    process.exitCode = 1;
  } else {
    console.info("Every stand-up check holds.");
  }
}

const mode = process.argv[2];
(mode === "prepare" ? prepare() : mode === "check" ? runCheck() : Promise.reject(new Error("Usage: better-auth-standup-proof.ts prepare|check"))).catch(
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
);
