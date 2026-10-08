/**
 * Proof of docs/BETTER-AUTH-PLAN.md section 6 commit 4 (section 5, proof 4):
 * the owner's two commands, run through npm as the owner runs them, against
 * the linked DEV database and a next dev this script starts on a free port
 * (never :3000), with Better Auth's base URL and the app URL set to that port
 * for the server and the commands alike.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/create-coach-proof.ts
 *
 *   1  npm run coach:create for a throwaway address: a verified login with no
 *      password, a trainer profile, a coach row, one live password link
 *   2  npm run auth:last-link prints a link landing on /set-password;
 *      following it lands on /set-password with its token, which opens signed
 *      out; the reset makes the password, and the used link is printed no more
 *   3  the coach signs in over HTTP, and /api/auth/me answers a trainer with
 *      the coach row
 *   4  over HTTP forgot password may not ask for the /set-password landing,
 *      and writes no link; its own landing works, and auth:last-link prints
 *      that link landing on /reset-password, the login having a password now
 *   5  coach:create again for the address: refused, it already has a login,
 *      and nothing is written
 *   6  coach:create naming production's ref against DEV's env: refused, and
 *      nothing is written for its address
 * No email is sent: the commands' Resend client points at an unroutable
 * address, as the dev server's does. Cleanup removes both throwaways, then
 * stops the dev server. No token, link, cookie or password is printed.
 */
import "./env-bootstrap";

import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { authPool } from "@/lib/auth";
import { RESET_PASSWORD_PAGE, SET_PASSWORD_PAGE } from "@/lib/constants";
import { deleteThrowawayLogin } from "./auth-fixtures";
import { DEV_REF, projectEnv, refuseUnlessProject } from "./project-ref";
import { PROD_REF, signInOverHttp } from "./proof-session";
import { NO_EMAIL, startProofServer, stopProofServer, type ProofServer } from "./proof-server";

const ROOT = join(__dirname, "..");
const STAMP = Date.now();
const COACH_ADDRESS = `create-coach-proof-${STAMP}@fixture.local`;
const PROD_RUN_ADDRESS = `create-coach-proof-prod-${STAMP}@fixture.local`;
const ADDRESS_PATTERN = "create-coach-proof-%@fixture.local";
const COACH_NAME = "Proof coach";
const REQUEST_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 120_000;

let failures = 0;
/** One check. Its detail is the evidence printed on failure: never a token, a link, a cookie or a password. */
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.info(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600));
  }
}

/** The throwaway's password, derived so that nothing writes it down. */
function passwordFor(address: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Missing BETTER_AUTH_SECRET in .env.local");
  return createHmac("sha256", secret).update(address).digest("base64url").slice(0, 32);
}

/** The next dev this run started (scripts/proof-server.ts): its output is evidence. */
let devServer: ProofServer | null = null;

// ---------------------------------------------------------------------------
// The commands, through npm, as the owner runs them
// ---------------------------------------------------------------------------

type Run = { code: number | null; stdout: string; stderr: string };

/**
 * One npm script with the proof server's address as Better Auth's and the
 * app's, and Resend pointed nowhere; .env.local supplies the rest (the
 * command's own dotenv never overrides a variable already set).
 */
function npmRun(base: string, script: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      "npm",
      ["run", "--silent", script, "--", ...args],
      {
        cwd: ROOT,
        timeout: COMMAND_TIMEOUT_MS,
        env: { ...process.env, BETTER_AUTH_URL: base, NEXT_PUBLIC_APP_URL: base, RESEND_BASE_URL: NO_EMAIL, SENTRY_DSN: "" },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

/** A run's evidence: its exit and its output, with any link in it hidden. */
const runEvidence = (run: Run) => ({
  code: run.code,
  stdout: run.stdout.replace(/https?:\/\/\S+/g, "<link>").slice(-400),
  stderr: run.stderr.replace(/https?:\/\/\S+/g, "<link>").slice(-400),
});

// ---------------------------------------------------------------------------
// Requests and rows
// ---------------------------------------------------------------------------

type Answer = { status: number; json: unknown; text: string; headers: Headers };

async function request(
  base: string,
  method: "GET" | "POST",
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {}
): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      Origin: base,
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
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const evidence = (answer: Answer) => ({ status: answer.status, code: (answer.json as { code?: string } | null)?.code, text: answer.text.slice(0, 160) });

/** Everything written for an address: the login and what hangs off it, the app's rows, its live password links. */
type Footprint = {
  logins: number;
  verified: boolean | null;
  credentials: number;
  sessions: number;
  role: string | null;
  profiles: number;
  coaches: number;
  coachName: string | null;
  links: number;
};

async function footprint(address: string): Promise<Footprint> {
  const { rows } = await authPool.query<Footprint>(
    `SELECT (SELECT count(*) FROM better_auth."user" u WHERE u.email = $1)::int AS logins,
            (SELECT u."emailVerified" FROM better_auth."user" u WHERE u.email = $1) AS verified,
            (SELECT count(*) FROM better_auth.account a JOIN better_auth."user" u ON u.id = a."userId"
              WHERE u.email = $1 AND a."providerId" = 'credential' AND a.password IS NOT NULL)::int AS credentials,
            (SELECT count(*) FROM better_auth.session s JOIN better_auth."user" u ON u.id = s."userId" WHERE u.email = $1)::int AS sessions,
            (SELECT p.role FROM public.profiles p JOIN better_auth."user" u ON u.id = p.user_id WHERE u.email = $1) AS role,
            (SELECT count(*) FROM public.profiles p JOIN better_auth."user" u ON u.id = p.user_id WHERE u.email = $1)::int AS profiles,
            (SELECT count(*) FROM public.coaches c WHERE c.email = $1)::int AS coaches,
            (SELECT c.name FROM public.coaches c WHERE c.email = $1 LIMIT 1) AS "coachName",
            (SELECT count(*) FROM better_auth.verification v JOIN better_auth."user" u ON v.value = u.id::text
              WHERE u.email = $1 AND v.identifier LIKE 'reset-password:%' AND v."expiresAt" > now())::int AS links`,
    [address]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

async function prove(base: string): Promise<void> {
  console.info("1. npm run coach:create makes a verified coach with no password, and asks for the set-password link");
  const created = await npmRun(base, "coach:create", ["--project", DEV_REF, "--email", COACH_ADDRESS, "--name", COACH_NAME]);
  check("coach:create exits 0", created.code === 0, runEvidence(created));
  const made = await footprint(COACH_ADDRESS);
  check(
    'a better_auth."user" row with emailVerified = true, no password, a trainer profile, a coach row with the name given, one live password link',
    made.logins === 1 &&
      made.verified === true &&
      made.credentials === 0 &&
      made.role === "trainer" &&
      made.profiles === 1 &&
      made.coaches === 1 &&
      made.coachName === COACH_NAME &&
      made.links === 1,
    made
  );
  const { rows: ids } = await authPool.query<{ id: string }>(`SELECT id FROM better_auth."user" WHERE email = $1`, [COACH_ADDRESS]);
  check("it prints the address and the login's id", created.stdout.includes(`Created ${COACH_ADDRESS} (user id ${ids[0]?.id}).`), runEvidence(created));
  check(
    "it says the email went, where its link lands, and the auth:last-link command for DEV",
    created.stdout.includes(`Set-your-password email sent to ${COACH_ADDRESS}. Its link lasts one hour and lands on ${base}${SET_PASSWORD_PAGE}.`) &&
      created.stdout.includes(`If it doesn't arrive: npm run auth:last-link -- --email ${COACH_ADDRESS}`),
    runEvidence(created)
  );

  console.info("2. npm run auth:last-link prints the set-password link; it lands on /set-password and sets the password");
  const printed = await npmRun(base, "auth:last-link", ["--email", COACH_ADDRESS]);
  const link = printed.stdout.split("\n").find((line) => line.startsWith(`${base}/api/auth/reset-password/`)) ?? "";
  check("auth:last-link exits 0 and prints Better Auth's password link", printed.code === 0 && link !== "", runEvidence(printed));
  check(`the link's callbackURL is ${SET_PASSWORD_PAGE}`, link !== "" && new URL(link).searchParams.get("callbackURL") === SET_PASSWORD_PAGE, runEvidence(printed));
  const token = link === "" ? "" : new URL(link).pathname.split("/").pop() ?? "";
  const click = link === "" ? null : await request(base, "GET", link.slice(base.length));
  const lands = click ? (click.headers.get("location") ?? "").replace(base, "") : "";
  check(
    "following it lands on /set-password with its token",
    click !== null && (click.status === 302 || click.status === 307) && token !== "" && lands === `${SET_PASSWORD_PAGE}?token=${token}`,
    click ? { status: click.status, lands: lands.replace(token, "<token>") } : "no link"
  );
  const page = await request(base, "GET", `${SET_PASSWORD_PAGE}?token=${token}`);
  check("/set-password opens signed out (200)", page.status === 200, { status: page.status });
  const password = passwordFor(COACH_ADDRESS);
  const reset = await request(base, "POST", "/api/auth/reset-password", { body: { newPassword: password, token } });
  check("the reset with the link's token answers 200", reset.status === 200, evidence(reset));
  const set = await footprint(COACH_ADDRESS);
  check("the password's credential row is made, and the link is used up", set.credentials === 1 && set.links === 0, set);
  const after = await npmRun(base, "auth:last-link", ["--email", COACH_ADDRESS]);
  check(
    "auth:last-link prints no used link: it exits 1 with no link",
    after.code === 1 && !after.stdout.includes(`${base}/api/auth/`) && after.stderr.includes(`No live link for ${COACH_ADDRESS}`),
    runEvidence(after)
  );

  console.info("3. The coach signs in");
  try {
    const session = await signInOverHttp(base, COACH_ADDRESS, password, "proof coach");
    const me = await request(base, "GET", "/api/auth/me", { headers: session.headers });
    const data = (me.json as { data?: { profile?: { role?: string }; coach?: { email?: string; name?: string } } } | null)?.data;
    check(
      "sign-in over HTTP sets the session cookie, and /api/auth/me answers a trainer with the coach row",
      me.status === 200 && data?.profile?.role === "trainer" && data.coach?.email === COACH_ADDRESS && data.coach.name === COACH_NAME,
      evidence(me)
    );
  } catch (error) {
    check("sign-in over HTTP", false, error instanceof Error ? error.message : String(error));
  }

  console.info("4. Over HTTP, forgot password may not ask for the set-password landing; its own landing works");
  const askFor = (redirectTo: string) => request(base, "POST", "/api/auth/request-password-reset", { body: { email: COACH_ADDRESS, redirectTo } });
  const setLanding = await askFor(SET_PASSWORD_PAGE);
  check(`a request naming ${SET_PASSWORD_PAGE} is refused (403)`, setLanding.status === 403, evidence(setLanding));
  check("and no link is written", (await footprint(COACH_ADDRESS)).links === 0, await footprint(COACH_ADDRESS));
  const resetLanding = await askFor(RESET_PASSWORD_PAGE);
  check(`forgot password's own landing, ${RESET_PASSWORD_PAGE}, is answered (200) and writes one link`, resetLanding.status === 200 && (await footprint(COACH_ADDRESS)).links === 1, evidence(resetLanding));
  const resetPrinted = await npmRun(base, "auth:last-link", ["--email", COACH_ADDRESS]);
  const resetLink = resetPrinted.stdout.split("\n").find((line) => line.startsWith(`${base}/api/auth/reset-password/`)) ?? "";
  check(
    `auth:last-link prints it landing on ${RESET_PASSWORD_PAGE}, the login having a password now`,
    resetPrinted.code === 0 && resetLink !== "" && new URL(resetLink).searchParams.get("callbackURL") === RESET_PASSWORD_PAGE,
    runEvidence(resetPrinted)
  );

  console.info("5. coach:create again for the same address is refused, and writes nothing");
  const before = await footprint(COACH_ADDRESS);
  const again = await npmRun(base, "coach:create", ["--project", DEV_REF, "--email", COACH_ADDRESS, "--name", COACH_NAME]);
  check(
    "it exits 1 and says the address already has a login",
    again.code === 1 && again.stderr.includes(`Refused: ${COACH_ADDRESS} already has a login. Nothing was written.`) && !again.stdout.includes("Created"),
    runEvidence(again)
  );
  const unchanged = await footprint(COACH_ADDRESS);
  check("nothing was written: the login, its rows and its links are as they were (no new link)", JSON.stringify(unchanged) === JSON.stringify(before), {
    before,
    unchanged,
  });

  console.info("6. coach:create naming production's ref against DEV's env is refused, and writes nothing");
  const prodRun = await npmRun(base, "coach:create", ["--project", PROD_REF, "--email", PROD_RUN_ADDRESS, "--name", COACH_NAME]);
  check(
    "it exits 1 and names every source that disagrees",
    prodRun.code === 1 &&
      prodRun.stderr.includes(`Refused: this run is for project ${PROD_REF}, but the linked project (supabase/.temp/project-ref) names ${DEV_REF}, DATABASE_URL names ${DEV_REF}, NEXT_PUBLIC_SUPABASE_URL names ${DEV_REF}.`),
    runEvidence(prodRun)
  );
  const untouched = await footprint(PROD_RUN_ADDRESS);
  check("no login and no row for its address, anywhere", Object.values(untouched).every((value) => value === 0 || value === null), untouched);
}

async function cleanup(): Promise<void> {
  console.info("Cleanup");
  try {
    for (const address of [COACH_ADDRESS, PROD_RUN_ADDRESS]) await deleteThrowawayLogin(address);
    const { rows } = await authPool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1))::int AS n`,
      [ADDRESS_PATTERN]
    );
    check("cleanup: no throwaway login or coach row is left", rows[0]?.n === 0, rows[0]);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  refuseUnlessProject(DEV_REF, projectEnv());
  try {
    devServer = await startProofServer();
    await prove(devServer.base);
  } finally {
    try {
      await cleanup();
    } finally {
      await stopProofServer();
      await authPool.end();
    }
  }
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    if (devServer) console.error(devServer.output.join("").slice(-2000));
    process.exitCode = 1;
  } else {
    console.info("Every coach:create check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
