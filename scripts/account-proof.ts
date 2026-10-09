/**
 * Proof of docs/BETTER-AUTH-PLAN.md section 6 commit 5 (section 5, proof 5):
 * the Account card's three changes over HTTP, as the dialogs send them,
 * against the linked DEV database and a next dev this script starts on a free
 * port (never :3000), its email landing in this script's own mailbox
 * (scripts/proof-mailbox.ts): change email's links carry a token Better Auth
 * signs and never stores, so the email is the only place they exist.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/account-proof.ts
 *
 *   1  change password: a wrong current password is refused (400
 *      INVALID_PASSWORD) and changes nothing; the right one makes the old
 *      password fail and the new one work, ends a session minted before, and
 *      keeps the device that changed it signed in on a new session
 *   2  change email: "Approve your email change" reaches the current address
 *      and nothing changes; its link sends "Confirm your new email" to the
 *      new address and still nothing changes; that link changes the login's
 *      address and the coach row's together, and the coach signs in with it
 *   3  a change to an address a client row holds (an invited client's) gets
 *      the answer an address with a login gets, 200 and no email, asked by a
 *      client's cookie, by their bearer token and by the two together, the
 *      coach's cookie beside the client's token; the coach's own bearer token,
 *      to an address no one holds, is let through
 *   4  sign out everywhere: every session of the login is gone from the table
 * Cleanup removes the throwaway coach and client and every session minted.
 * No token, link, cookie or password is printed.
 */
import "./env-bootstrap";

import { createHmac } from "node:crypto";
import { authPool } from "@/lib/auth";
import { CLIENT_SETTINGS_PAGE, COACH_SETTINGS_PAGE } from "@/lib/constants";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createThrowawayLogin, deleteThrowawayLogin, loginIdFor } from "./auth-fixtures";
import { DEV_REF, projectEnv, refuseUnlessProject } from "./project-ref";
import { startProofMailbox, type MailboxEmail, type ProofMailbox } from "./proof-mailbox";
import { startProofServer, stopProofServer, type ProofServer } from "./proof-server";
import { endMintedSessions, mintSession, signInOverHttp, type ProofSession } from "./proof-session";

const STAMP = Date.now();
const COACH_ADDRESS = `account-proof-${STAMP}@fixture.local`;
const NEW_ADDRESS = `account-proof-${STAMP}-new@fixture.local`;
const CLIENT_ADDRESS = `account-proof-${STAMP}-client@fixture.local`;
/** An invited client's address: a client row holds it, and no login. */
const HELD_ADDRESS = `account-proof-${STAMP}-held@fixture.local`;
const ADDRESS_PATTERN = "account-proof-%@fixture.local";
const COACH_NAME = "Account proof coach";
const REQUEST_TIMEOUT_MS = 60_000;
const APPROVE_SUBJECT = "Approve your email change";
const CONFIRM_SUBJECT = "Confirm your new email";

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

/** A throwaway's password, derived so that nothing writes it down. */
function passwordFor(label: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Missing BETTER_AUTH_SECRET in .env.local");
  return createHmac("sha256", secret).update(`${COACH_ADDRESS}:${label}`).digest("base64url").slice(0, 32);
}

/** The next dev and the mailbox this run started: their output is evidence. */
let devServer: ProofServer | null = null;
let mailbox: ProofMailbox | null = null;

// ---------------------------------------------------------------------------
// Requests and rows
// ---------------------------------------------------------------------------

type Answer = { status: number; json: unknown; text: string; headers: Headers };

/** One request as a browser on the app's origin sends it, redirects not followed. */
async function request(
  base: string,
  method: "GET" | "POST",
  path: string,
  options: { session?: ProofSession; body?: unknown } = {}
): Promise<Answer> {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      Origin: base,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.session?.headers,
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

/** An answer's evidence, any session token in its body hidden (change password answers with the new one). */
const evidence = (answer: Answer) => ({
  status: answer.status,
  code: (answer.json as { code?: string } | null)?.code,
  text: answer.text.replace(/"token":"[^"]*"/g, '"token":"<token>"').slice(0, 160),
});

/**
 * Signs in as the client app will (POST /api/auth/sign-in/email) and keeps the
 * bearer token the answer carries in set-auth-token, sent back as
 * Authorization: Bearer with no cookie.
 */
async function signInForBearer(base: string, email: string, password: string, label: string): Promise<ProofSession> {
  const answer = await request(base, "POST", "/api/auth/sign-in/email", { body: { email, password } });
  const token = answer.headers.get("set-auth-token");
  if (answer.status !== 200 || !token) throw new Error(`Sign-in for a bearer token as ${email} refused: ${answer.status}`);
  return { label, headers: { Authorization: `Bearer ${token}` } };
}

/** The session cookie an answer set, as the browser would send it back. */
function cookieFrom(answer: Answer, label: string): ProofSession | null {
  const cookie = answer.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .find((pair) => /^(__Secure-)?better-auth\.session_token=.+/.test(pair));
  return cookie ? { label, headers: { Cookie: cookie } } : null;
}

/** Whether a session opens the app: GET /api/auth/me answers 200. */
async function opens(base: string, session: ProofSession): Promise<{ status: number; coachEmail?: string }> {
  const me = await request(base, "GET", "/api/auth/me", { session });
  return { status: me.status, coachEmail: (me.json as { data?: { coach?: { email?: string } } } | null)?.data?.coach?.email };
}

/** A sign-in's status and Better Auth's code, as the login page posts one. */
async function signIn(base: string, email: string, password: string): Promise<{ status: number; code?: string }> {
  const answer = await request(base, "POST", "/api/auth/sign-in/email", { body: { email, password } });
  return { status: answer.status, code: (answer.json as { code?: string } | null)?.code };
}

/** The login's row and what hangs off it, read through Better Auth's connection. */
type Footprint = { loginEmail: string | null; verified: boolean | null; coachEmail: string | null; sessions: number; tokens: number };

async function footprint(userId: string): Promise<Footprint> {
  const { rows } = await authPool.query<Footprint>(
    `SELECT (SELECT u.email FROM better_auth."user" u WHERE u.id = $1) AS "loginEmail",
            (SELECT u."emailVerified" FROM better_auth."user" u WHERE u.id = $1) AS verified,
            (SELECT c.email FROM public.coaches c WHERE c.user_id = $1) AS "coachEmail",
            (SELECT count(*) FROM better_auth.session s WHERE s."userId" = $1)::int AS sessions,
            (SELECT count(*) FROM better_auth.verification v WHERE v.value = $1::text)::int AS tokens`,
    [userId]
  );
  return rows[0];
}

/** Change email's link in an email's text: Better Auth's verify-email, landing on the coach's Settings. */
function verifyLink(base: string, email: MailboxEmail | null): string {
  const link = email?.text.match(/https?:\/\/\S+\/api\/auth\/verify-email\?\S+/)?.[0] ?? "";
  return link.startsWith(`${base}/api/auth/verify-email?token=`) && new URL(link).searchParams.get("callbackURL") === COACH_SETTINGS_PAGE ? link : "";
}

/** Where a followed link sends the browser, relative to the app. */
const landing = (base: string, answer: Answer) => (answer.headers.get("location") ?? "").replace(base, "");

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

async function prove(base: string, box: ProofMailbox): Promise<void> {
  const firstPassword = passwordFor("first");
  const secondPassword = passwordFor("second");
  const coach = await createThrowawayLogin({ role: "coach", email: COACH_ADDRESS, password: firstPassword, name: COACH_NAME });
  const { userId, coachId } = coach;
  if (!coachId) throw new Error(`No coach row for ${COACH_ADDRESS}`);

  console.info("1. Change password: the current one, then every other device signed out");
  const laptop = await signInOverHttp(base, COACH_ADDRESS, firstPassword, "laptop");
  const minted = await mintSession(COACH_ADDRESS, "minted before");
  check("before: the laptop's cookie and the minted session both open the app", (await opens(base, laptop)).status === 200 && (await opens(base, minted)).status === 200);

  const wrong = await request(base, "POST", "/api/auth/change-password", {
    session: laptop,
    body: { currentPassword: `${firstPassword}!`, newPassword: secondPassword, revokeOtherSessions: true },
  });
  check("a wrong current password is refused: 400 INVALID_PASSWORD", wrong.status === 400 && (wrong.json as { code?: string } | null)?.code === "INVALID_PASSWORD", evidence(wrong));
  check("and nothing changes: the password still signs in", (await signIn(base, COACH_ADDRESS, firstPassword)).status === 200);

  const changed = await request(base, "POST", "/api/auth/change-password", {
    session: laptop,
    body: { currentPassword: firstPassword, newPassword: secondPassword, revokeOtherSessions: true },
  });
  check("the right current password changes it: 200", changed.status === 200, evidence(changed));
  const renewed = cookieFrom(changed, "laptop, renewed");
  const oldPassword = await signIn(base, COACH_ADDRESS, firstPassword);
  check("the old password fails: 401 INVALID_EMAIL_OR_PASSWORD", oldPassword.status === 401 && oldPassword.code === "INVALID_EMAIL_OR_PASSWORD", oldPassword);
  check("the new password signs in", (await signIn(base, COACH_ADDRESS, secondPassword)).status === 200);
  check("the session minted before is dead: /api/auth/me answers 401", (await opens(base, minted)).status === 401);
  check("the laptop's cookie from before the change is dead too: Better Auth ends every session and starts this device's anew", (await opens(base, laptop)).status === 401);
  check("the laptop stays signed in on the cookie the change answered with", renewed !== null && (await opens(base, renewed)).status === 200);

  console.info("2. Change email: approved at the current address, confirmed at the new, and only then changed");
  const session = await signInOverHttp(base, COACH_ADDRESS, secondPassword, "coach");
  const before = await footprint(userId);
  const asked = await request(base, "POST", "/api/auth/change-email", { session, body: { newEmail: NEW_ADDRESS, callbackURL: COACH_SETTINGS_PAGE } });
  check("the change is asked for: 200", asked.status === 200 && (asked.json as { status?: boolean } | null)?.status === true, evidence(asked));
  const approval = await box.waitForEmail(COACH_ADDRESS, APPROVE_SUBJECT);
  const approveUrl = verifyLink(base, approval);
  check(`"${APPROVE_SUBJECT}" reaches the current address, naming the new one, carrying Better Auth's link to Settings`, approveUrl !== "" && Boolean(approval?.text.includes(NEW_ADDRESS)), {
    subjects: box.emails.map((email) => `${email.subject} → ${email.to.join(",")}`),
  });
  const asking = await footprint(userId);
  check("nothing changes: the login and the coach row keep the current address, and nothing is written for the link", asking.loginEmail === COACH_ADDRESS && asking.coachEmail === COACH_ADDRESS && asking.tokens === before.tokens, asking);
  check("nothing has gone to the new address yet", !box.emails.some((email) => email.to.includes(NEW_ADDRESS)));

  const approved = approveUrl === "" ? null : await request(base, "GET", approveUrl.slice(base.length), { session });
  check(`following it lands on ${COACH_SETTINGS_PAGE}`, approved !== null && approved.status === 302 && landing(base, approved) === COACH_SETTINGS_PAGE, approved ? { status: approved.status, lands: landing(base, approved) } : "no link");
  const confirmation = await box.waitForEmail(NEW_ADDRESS, CONFIRM_SUBJECT);
  const confirmUrl = verifyLink(base, confirmation);
  check(`"${CONFIRM_SUBJECT}" reaches the new address, carrying Better Auth's link to Settings`, confirmUrl !== "", {
    subjects: box.emails.map((email) => `${email.subject} → ${email.to.join(",")}`),
  });
  const approvedRows = await footprint(userId);
  check("still nothing changes", approvedRows.loginEmail === COACH_ADDRESS && approvedRows.coachEmail === COACH_ADDRESS, approvedRows);

  const confirmed = confirmUrl === "" ? null : await request(base, "GET", confirmUrl.slice(base.length), { session });
  check(`following it lands on ${COACH_SETTINGS_PAGE}`, confirmed !== null && confirmed.status === 302 && landing(base, confirmed) === COACH_SETTINGS_PAGE, confirmed ? { status: confirmed.status, lands: landing(base, confirmed) } : "no link");
  const changedRows = await footprint(userId);
  check(
    'better_auth."user".email and coaches.email both read the new address, verified',
    changedRows.loginEmail === NEW_ADDRESS && changedRows.coachEmail === NEW_ADDRESS && changedRows.verified === true,
    changedRows
  );
  check("the coach signs in with the new address and the same password", (await signIn(base, NEW_ADDRESS, secondPassword)).status === 200);
  check("the old address signs in no more", (await signIn(base, COACH_ADDRESS, secondPassword)).status === 401);
  check("/api/auth/me answers the coach row with the new address", (await opens(base, session)).coachEmail === NEW_ADDRESS);
  const again = confirmUrl === "" ? null : await request(base, "GET", confirmUrl.slice(base.length), { session });
  const afterAgain = await footprint(userId);
  check(
    `the confirmation link used again changes nothing and lands on ${COACH_SETTINGS_PAGE}?error=USER_NOT_FOUND, a failure Settings says`,
    again !== null && landing(base, again) === `${COACH_SETTINGS_PAGE}?error=USER_NOT_FOUND` && afterAgain.loginEmail === NEW_ADDRESS && afterAgain.coachEmail === NEW_ADDRESS,
    again ? { status: again.status, lands: landing(base, again), rows: afterAgain } : "no link"
  );

  console.info("3. A change to an address a client row holds gets the no-email answer, by cookie, by bearer token or both");
  const { data: clientRow, error: clientError } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: coachId, name: "Account proof client", email: CLIENT_ADDRESS, active: true, onboarding_status: "pending_intake", timezone: "Europe/London", user_id: null })
    .select("id")
    .single();
  if (clientError || !clientRow) throw new Error(`client insert: ${clientError?.message}`);
  const { error: heldError } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: coachId, name: "Account proof invited client", email: HELD_ADDRESS, active: true, onboarding_status: "pending_intake", timezone: "Europe/London", user_id: null });
  if (heldError) throw new Error(`invited client insert: ${heldError.message}`);
  const clientPassword = passwordFor("client");
  await createThrowawayLogin({ role: "client", email: CLIENT_ADDRESS, password: clientPassword, clientId: clientRow.id });
  const client = await signInOverHttp(base, CLIENT_ADDRESS, clientPassword, "client");
  const clientBearer = await signInForBearer(base, CLIENT_ADDRESS, clientPassword, "client, bearer");
  const askAs = (asker: ProofSession, newEmail: string) =>
    request(base, "POST", "/api/auth/change-email", { session: asker, body: { newEmail, callbackURL: CLIENT_SETTINGS_PAGE } });
  /** Better Auth's answer to an address a login has: asked for, and nothing sent. */
  const noEmailAnswer = (answer: Answer) => answer.status === 200 && JSON.stringify(answer.json) === JSON.stringify({ status: true });
  const sentBefore = box.emails.length;
  const byCookie = await askAs(client, HELD_ADDRESS);
  check("with the client's cookie: 200 { status: true }, the answer an address with a login gets", noEmailAnswer(byCookie), evidence(byCookie));
  const byBearer = await askAs(clientBearer, HELD_ADDRESS);
  check("with the client's bearer token and no cookie, as the client app sends it: the same", noEmailAnswer(byBearer), evidence(byBearer));
  const mixed = { label: "coach's cookie, client's bearer", headers: { ...session.headers, ...clientBearer.headers } };
  const byBoth = await askAs(mixed, HELD_ADDRESS);
  check("with the coach's cookie beside the client's bearer token, which Better Auth acts as: the same", noEmailAnswer(byBoth), evidence(byBoth));
  // Acting as the client, Better Auth refuses their own address as "Email is the same"; acting as the coach, it
  // would answer that address, which the client's login has, with the no-email answer.
  const ownAddress = await askAs(mixed, CLIENT_ADDRESS);
  check(
    "by the two together, the client's own address: Better Auth's 400 \"Email is the same\", so it acts as the bearer's login, and the check it runs with it",
    ownAddress.status === 400 && (ownAddress.json as { message?: string } | null)?.message === "Email is the same",
    evidence(ownAddress)
  );
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  check("no email is sent", box.emails.length === sentBefore, { sent: box.emails.length - sentBefore });
  const { rows: clientLogin } = await authPool.query<{ email: string }>(`SELECT email FROM better_auth."user" WHERE email = $1`, [CLIENT_ADDRESS]);
  const { data: heldRows } = await supabaseAdmin.from("clients").select("user_id").eq("email", HELD_ADDRESS);
  check("the client's login keeps its address, and the invited client's row keeps its own, with no login", clientLogin.length === 1 && heldRows?.length === 1 && heldRows[0].user_id === null, { clientLogin, heldRows });
  const coachBearer = await signInForBearer(base, NEW_ADDRESS, secondPassword, "coach, bearer");
  const allowed = await request(base, "POST", "/api/auth/change-email", {
    session: coachBearer,
    body: { newEmail: `account-proof-${STAMP}-third@fixture.local`, callbackURL: COACH_SETTINGS_PAGE },
  });
  check(
    "the control: the coach's own bearer token is read as the coach and let through, its approval sent, nothing changed",
    allowed.status === 200 &&
      (await box.waitForEmail(NEW_ADDRESS, APPROVE_SUBJECT)) !== null &&
      (await footprint(userId)).loginEmail === NEW_ADDRESS,
    evidence(allowed)
  );

  console.info("4. Sign out everywhere: every session of the login ends, this one too");
  const phone = await signInOverHttp(base, NEW_ADDRESS, secondPassword, "phone");
  const live = await footprint(userId);
  check("before: the login holds several live sessions", live.sessions >= 2, live);
  const ended = await request(base, "POST", "/api/auth/revoke-sessions", { session, body: {} });
  check("revoke-sessions answers 200", ended.status === 200, evidence(ended));
  const after = await footprint(userId);
  check("every session of the user is gone from the table", after.sessions === 0, after);
  check("the device that asked and every other open the app no more", (await opens(base, session)).status === 401 && (await opens(base, phone)).status === 401);
  check("the client's session is untouched", (await opens(base, client)).status === 200);
}

async function cleanup(): Promise<void> {
  console.info("Cleanup");
  try {
    console.info(`  minted sessions ended: ${await endMintedSessions()}`);
    // The client's login first: the coach's takes the coach row, and the client row with it.
    await deleteThrowawayLogin(CLIENT_ADDRESS);
    for (const address of [NEW_ADDRESS, COACH_ADDRESS]) {
      if (await loginIdFor(address)) await deleteThrowawayLogin(address);
    }
    const { rows } = await authPool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1)
             + (SELECT count(*) FROM public.clients WHERE email LIKE $1))::int AS n`,
      [ADDRESS_PATTERN]
    );
    check("cleanup: no throwaway login, coach row or client row is left", rows[0]?.n === 0, rows[0]);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  refuseUnlessProject(DEV_REF, projectEnv());
  try {
    mailbox = await startProofMailbox();
    devServer = await startProofServer({ emailTo: mailbox.url });
    await prove(devServer.base, mailbox);
  } finally {
    try {
      await cleanup();
    } finally {
      await stopProofServer();
      await mailbox?.stop();
      await authPool.end();
    }
  }
  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    // The server logs the addresses it answered, links' tokens among them.
    if (devServer) console.error(devServer.output.join("").replace(/token=[^&\s]+/g, "token=<token>").slice(-2000));
    process.exitCode = 1;
  } else {
    console.info("Every account check holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
