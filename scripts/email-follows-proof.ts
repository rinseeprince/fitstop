/**
 * Proof of docs/BETTER-AUTH-PLAN.md section 6 commit 5.5 (section 5, proof
 * 5.5): a login's address and every copy of it change in one write, for a
 * coach and a client alike, against the linked DEV database and a next dev
 * this script starts on a free port (never :3000), its email landing in this
 * script's own mailbox (scripts/proof-mailbox.ts): change email's links carry
 * a token Better Auth signs and never stores, so the email is the only place
 * they exist.
 *
 *   npx tsx --tsconfig ./tsconfig.json scripts/email-follows-proof.ts
 *
 * The throwaways: a coach; three clients of theirs, one with an account, one
 * invited (its link in hand) and one only pending; and a coach row with no
 * login.
 *   1  a client's change of email by its two links: the login and the client
 *      row both on the new address, the client signs in with it and stays
 *      signed in on the session that asked, and the coach's GET
 *      /api/clients/<id> and the client's GET /api/client/me answer it
 *   2  a coach's change by its two links: coaches.email follows; and the copy
 *      is the database's, so a login changed through the pool, where no code
 *      of the app runs, moves its coach row too
 *   3  one write: the coach's login changed through the pool to the address
 *      the coach row with no login holds: the coach row's UNIQUE key fails the
 *      statement, and the login and its coach row both keep their address
 *   4  a change to an address a client row or a coach row holds: 200, the
 *      answer an address with a login gets, no email, nothing changed
 *   5  the coach's PATCH /api/clients/<id>: another address for the client
 *      with an account is 409, the row unchanged; the same address is 200;
 *      for the invited client 200, changed
 *   6  the invite's acceptance after the coach edited the pending address:
 *      the login and the client row read the invited address
 *   7  npm run auth:move-email for the client: refused with nothing changed
 *      for an address with no login, a --to a login, a coach row or a client
 *      row holds, and production's ref against DEV's env; then the move, a
 *      Google account linked to the login first: the login and the client row
 *      on the new address, the Google account unlinked and the password row
 *      kept, its sessions 0, "Reset your password" in the mailbox for the new
 *      address (the command's Resend pointed at it), and the reset works
 * Cleanup removes every throwaway login, coach row and client row, and every
 * session minted. No token, link, cookie or password is printed.
 */
import "./env-bootstrap";

import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import { authPool } from "@/lib/auth";
import { CLIENT_SETTINGS_PAGE, COACH_SETTINGS_PAGE, RESET_PASSWORD_PAGE, type SettingsPage } from "@/lib/constants";
import { supabaseAdmin } from "@/services/supabase-admin";
import { createThrowawayLogin, deleteThrowawayLogin, loginIdFor } from "./auth-fixtures";
import { DEV_REF, projectEnv, refuseUnlessProject } from "./project-ref";
import { startProofMailbox, type MailboxEmail, type ProofMailbox } from "./proof-mailbox";
import { startProofServer, stopProofServer, type ProofServer } from "./proof-server";
import { PROD_REF, endMintedSessions, mintSession, signInOverHttp, type ProofSession } from "./proof-session";

const ROOT = join(__dirname, "..");
const STAMP = Date.now();
const at = (label: string) => `email-follows-${STAMP}-${label}@fixture.local`;
const COACH = at("coach");
const COACH_NEW = at("coach-new");
const COACH_POOL = at("coach-pool");
const CLIENT = at("client");
const CLIENT_NEW = at("client-new");
const MOVED = at("moved");
const INVITED = at("invited");
const INVITED_EDIT = at("invited-edit");
const PENDING = at("pending");
const LONE_COACH = at("lone-coach");
const NOBODY = at("nobody");
/** Every throwaway address any run of this proof makes. */
const ADDRESS_PATTERN = "email-follows-%@fixture.local";
const REQUEST_TIMEOUT_MS = 60_000;
const COMMAND_TIMEOUT_MS = 120_000;
const APPROVE_SUBJECT = "Approve your email change";
const CONFIRM_SUBJECT = "Confirm your new email";
const RESET_SUBJECT = "Reset your password";
const LOCKED_EMAIL = "This client changes their own email.";
/** Postgres's unique_violation, and the key the coach row's copy meets. */
const UNIQUE_VIOLATION = "23505";
const COACH_EMAIL_KEY = "coaches_email_key";

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
  return createHmac("sha256", secret).update(`${COACH}:${label}`).digest("base64url").slice(0, 32);
}

/** The next dev and the mailbox this run started: their output is evidence. */
let devServer: ProofServer | null = null;
let mailbox: ProofMailbox | null = null;
/** Every login this run made, by id: the cleanup finds each by its address now. */
const madeLogins: string[] = [];
/** The coach rows this run made with no login: no login's deletion takes them. */
const loneCoachRows: string[] = [];

// ---------------------------------------------------------------------------
// Requests and rows
// ---------------------------------------------------------------------------

type Answer = { status: number; json: unknown; text: string; headers: Headers };

/** One request as a browser on the app's origin sends it, redirects not followed. */
async function request(
  base: string,
  method: "GET" | "POST" | "PATCH",
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

/** An answer's evidence, any session token in its body hidden. */
const evidence = (answer: Answer) => ({
  status: answer.status,
  code: (answer.json as { code?: string } | null)?.code,
  text: answer.text.replace(/"token":"[^"]*"/g, '"token":"<token>"').slice(0, 160),
});

/** A sign-in's status, as the login page posts one. */
async function signInStatus(base: string, email: string, password: string): Promise<number> {
  return (await request(base, "POST", "/api/auth/sign-in/email", { body: { email, password } })).status;
}

/** The session cookie an answer set, as the browser would send it back. */
function cookieFrom(answer: Answer, label: string): ProofSession | null {
  const cookie = answer.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .find((pair) => /^(__Secure-)?better-auth\.session_token=.+/.test(pair));
  return cookie ? { label, headers: { Cookie: cookie } } : null;
}

/** A login's address and verification, and how many sessions it holds, read through Better Auth's connection. */
async function login(userId: string): Promise<{ email: string | null; verified: boolean | null; sessions: number }> {
  const { rows } = await authPool.query<{ email: string | null; verified: boolean | null; sessions: number }>(
    `SELECT (SELECT u.email FROM better_auth."user" u WHERE u.id = $1) AS email,
            (SELECT u."emailVerified" FROM better_auth."user" u WHERE u.id = $1) AS verified,
            (SELECT count(*) FROM better_auth.session s WHERE s."userId" = $1)::int AS sessions`,
    [userId]
  );
  return rows[0];
}

/** A login's account rows by provider, read through Better Auth's connection: "credential" is its password. */
async function providersOf(userId: string): Promise<string[]> {
  const { rows } = await authPool.query<{ providerId: string }>(
    `SELECT "providerId" FROM better_auth.account WHERE "userId" = $1 ORDER BY "providerId"`,
    [userId]
  );
  return rows.map((row) => row.providerId);
}

/** A client row's address and login. */
async function clientRow(clientId: string): Promise<{ email: string; user_id: string | null; phone: string | null } | null> {
  const { data, error } = await supabaseAdmin.from("clients").select("email, user_id, phone").eq("id", clientId).maybeSingle();
  if (error) throw new Error(`client read: ${error.message}`);
  return data;
}

/** A coach row's address, by its id. */
async function coachEmail(coachId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("coaches").select("email").eq("id", coachId).maybeSingle();
  if (error) throw new Error(`coach read: ${error.message}`);
  return data?.email ?? null;
}

/** A pending client of the coach, as the coach's add-client form makes one, on an address. */
async function pendingClient(coachId: string, name: string, email: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .insert({ coach_id: coachId, name, email, active: true, onboarding_status: "pending_intake", timezone: "Europe/London", user_id: null })
    .select("id")
    .single();
  if (error || !data) throw new Error(`client insert (${name}): ${error?.message}`);
  return data.id;
}

/** Change email's link in an email's text: Better Auth's verify-email, landing on the asker's Settings. */
function verifyLink(base: string, email: MailboxEmail | null, landing: SettingsPage): string {
  const link = email?.text.match(/https?:\/\/\S+\/api\/auth\/verify-email\?\S+/)?.[0] ?? "";
  return link.startsWith(`${base}/api/auth/verify-email?token=`) && new URL(link).searchParams.get("callbackURL") === landing ? link : "";
}

/** Where a followed link sends the browser, relative to the app. */
const landing = (base: string, answer: Answer) => (answer.headers.get("location") ?? "").replace(base, "");

/**
 * A change of email by its two links, as the asker clicks them in the
 * session that asked: the approval reaches the current address, its link
 * sends the confirmation to the new one, and that link lands back on the
 * asker's Settings. Returns whether each step held.
 */
async function changeEmailByLinks(
  base: string,
  box: ProofMailbox,
  asker: ProofSession,
  from: string,
  to: string,
  settings: SettingsPage
): Promise<boolean> {
  const asked = await request(base, "POST", "/api/auth/change-email", { session: asker, body: { newEmail: to, callbackURL: settings } });
  check(`the change is asked for: 200`, asked.status === 200 && JSON.stringify(asked.json) === JSON.stringify({ status: true }), evidence(asked));
  const approveUrl = verifyLink(base, await box.waitForEmail(from, APPROVE_SUBJECT), settings);
  check(`"${APPROVE_SUBJECT}" reaches the current address, its link landing on ${settings}`, approveUrl !== "", {
    subjects: box.emails.map((email) => `${email.subject} → ${email.to.join(",")}`),
  });
  const approved = approveUrl === "" ? null : await request(base, "GET", approveUrl.slice(base.length), { session: asker });
  const confirmUrl = verifyLink(base, await box.waitForEmail(to, CONFIRM_SUBJECT), settings);
  check(
    `following it lands on ${settings} and "${CONFIRM_SUBJECT}" reaches the new address`,
    approved?.status === 302 && landing(base, approved) === settings && confirmUrl !== "",
    approved ? { status: approved.status, lands: landing(base, approved) } : "no link"
  );
  const confirmed = confirmUrl === "" ? null : await request(base, "GET", confirmUrl.slice(base.length), { session: asker });
  const ok = confirmed?.status === 302 && landing(base, confirmed) === settings;
  check(`following that lands on ${settings}`, ok, confirmed ? { status: confirmed.status, lands: landing(base, confirmed) } : "no link");
  return ok && approveUrl !== "" && confirmUrl !== "";
}

/** The owner's command, run as the owner runs it, its email pointed at this run's mailbox and its links at this run's server. */
async function runMoveEmail(base: string, box: ProofMailbox, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "--silent", "auth:move-email", "--", ...args], {
      cwd: ROOT,
      env: { ...process.env, RESEND_BASE_URL: box.url, BETTER_AUTH_URL: base, NEXT_PUBLIC_APP_URL: base, SENTRY_DSN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`npm run auth:move-email did not finish within ${COMMAND_TIMEOUT_MS / 1000} s`));
    }, COMMAND_TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

async function prove(base: string, box: ProofMailbox): Promise<void> {
  const coachPassword = passwordFor("coach");
  const clientPassword = passwordFor("client");
  const invitedPassword = passwordFor("invited");
  const resetPassword = passwordFor("reset");

  const coach = await createThrowawayLogin({ role: "coach", email: COACH, password: coachPassword, name: "Email follows proof coach" });
  madeLogins.push(coach.userId);
  const coachId = coach.coachId;
  if (!coachId) throw new Error(`No coach row for ${COACH}`);
  const clientId = await pendingClient(coachId, "Email follows proof client", CLIENT);
  const client = await createThrowawayLogin({ role: "client", email: CLIENT, password: clientPassword, clientId });
  madeLogins.push(client.userId);
  const invitedId = await pendingClient(coachId, "Email follows proof invited client", INVITED);
  const inviteToken = randomBytes(32).toString("hex");
  const { error: inviteError } = await supabaseAdmin.from("client_invitations").insert({
    client_id: invitedId,
    email: INVITED,
    token: inviteToken,
    status: "sent",
    invited_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (inviteError) throw new Error(`invitation insert: ${inviteError.message}`);
  const pendingId = await pendingClient(coachId, "Email follows proof pending client", PENDING);
  const { data: lone, error: loneError } = await supabaseAdmin
    .from("coaches")
    .insert({ user_id: null, name: "Email follows proof coach with no login", email: LONE_COACH })
    .select("id")
    .single();
  if (loneError || !lone) throw new Error(`coach row insert: ${loneError?.message}`);
  loneCoachRows.push(lone.id);

  const coachSession = await signInOverHttp(base, COACH, coachPassword, "coach");
  const clientSession = await signInOverHttp(base, CLIENT, clientPassword, "client");

  console.info("1. A client changes their email by its two links: the login and the client row move together");
  const clientChanged = await changeEmailByLinks(base, box, clientSession, CLIENT, CLIENT_NEW, CLIENT_SETTINGS_PAGE);
  const clientLogin = await login(client.userId);
  const clientRowNow = await clientRow(clientId);
  check(
    'better_auth."user".email and clients.email both read the new address, verified',
    clientChanged && clientLogin.email === CLIENT_NEW && clientLogin.verified === true && clientRowNow?.email === CLIENT_NEW,
    { clientLogin, clientRowNow }
  );
  check("the client signs in with the new address and the same password", (await signInStatus(base, CLIENT_NEW, clientPassword)) === 200);
  check("the old address signs in no more", (await signInStatus(base, CLIENT, clientPassword)) === 401);
  const me = await request(base, "GET", "/api/client/me", { session: clientSession });
  check(
    "the session that asked stays signed in, and GET /api/client/me answers the new address",
    me.status === 200 && (me.json as { data?: { email?: string } } | null)?.data?.email === CLIENT_NEW,
    evidence(me)
  );
  const coachView = await request(base, "GET", `/api/clients/${clientId}`, { session: coachSession });
  check(
    "the coach's GET /api/clients/<id> answers the new address",
    coachView.status === 200 && (coachView.json as { client?: { email?: string } } | null)?.client?.email === CLIENT_NEW,
    evidence(coachView)
  );

  console.info("2. A coach changes their email by its two links: the coach row follows, and the copy is the database's");
  const coachChanged = await changeEmailByLinks(base, box, coachSession, COACH, COACH_NEW, COACH_SETTINGS_PAGE);
  const coachLogin = await login(coach.userId);
  check(
    'better_auth."user".email and coaches.email both read the new address, verified',
    coachChanged && coachLogin.email === COACH_NEW && coachLogin.verified === true && (await coachEmail(coachId)) === COACH_NEW,
    coachLogin
  );
  const coachMe = await request(base, "GET", "/api/auth/me", { session: coachSession });
  check(
    "/api/auth/me answers the coach row on the new address",
    (coachMe.json as { data?: { coach?: { email?: string } } } | null)?.data?.coach?.email === COACH_NEW,
    evidence(coachMe)
  );
  await authPool.query(`UPDATE better_auth."user" SET email = $1 WHERE id = $2`, [COACH_POOL, coach.userId]);
  check(
    "a login changed through the pool, where no code of the app runs, moves its coach row in the same statement",
    (await login(coach.userId)).email === COACH_POOL && (await coachEmail(coachId)) === COACH_POOL
  );

  console.info("3. One write: a copy that can't be written undoes the login's change with it");
  let refusal: { code?: string; constraint?: string } | null = null;
  try {
    await authPool.query(`UPDATE better_auth."user" SET email = $1 WHERE id = $2`, [LONE_COACH, coach.userId]);
  } catch (error) {
    refusal = error as { code?: string; constraint?: string };
  }
  check(
    `changing the coach's login to the address a coach row with no login holds fails the statement on ${COACH_EMAIL_KEY}`,
    refusal?.code === UNIQUE_VIOLATION && refusal.constraint === COACH_EMAIL_KEY,
    refusal ? { code: refusal.code, constraint: refusal.constraint } : "the statement went through"
  );
  check(
    "the login and its coach row both keep their address, and the other coach row its own",
    (await login(coach.userId)).email === COACH_POOL && (await coachEmail(coachId)) === COACH_POOL && (await coachEmail(lone.id)) === LONE_COACH
  );

  console.info("4. A change to an address a client row or a coach row holds gets the no-email answer");
  const sentBefore = box.emails.length;
  const asks: Array<[string, ProofSession, string, SettingsPage]> = [
    ["the client, to an address a client row holds (a pending client's)", clientSession, PENDING, CLIENT_SETTINGS_PAGE],
    ["the client, to an address a coach row holds (one with no login)", clientSession, LONE_COACH, CLIENT_SETTINGS_PAGE],
    ["the coach, to an address a client row holds (an invited client's)", coachSession, INVITED, COACH_SETTINGS_PAGE],
  ];
  for (const [label, asker, newEmail, settings] of asks) {
    const answered = await request(base, "POST", "/api/auth/change-email", { session: asker, body: { newEmail, callbackURL: settings } });
    check(`${label}: 200 { status: true }`, answered.status === 200 && JSON.stringify(answered.json) === JSON.stringify({ status: true }), evidence(answered));
  }
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  check("no email is sent", box.emails.length === sentBefore, { sent: box.emails.slice(sentBefore).map((email) => email.subject) });
  check(
    "nothing changed: both logins and every row keep their address",
    (await login(client.userId)).email === CLIENT_NEW &&
      (await login(coach.userId)).email === COACH_POOL &&
      (await clientRow(pendingId))?.email === PENDING &&
      (await clientRow(invitedId))?.email === INVITED &&
      (await coachEmail(lone.id)) === LONE_COACH
  );

  console.info("5. The coach's PATCH: a client with an account keeps their address; a pending client's is the coach's");
  const locked = await request(base, "PATCH", `/api/clients/${clientId}`, { session: coachSession, body: { email: at("patched") } });
  check(
    `another address for the client with an account: 409 "${LOCKED_EMAIL}"`,
    locked.status === 409 && (locked.json as { error?: string } | null)?.error === LOCKED_EMAIL,
    evidence(locked)
  );
  check("and the row is unchanged", (await clientRow(clientId))?.email === CLIENT_NEW);
  const same = await request(base, "PATCH", `/api/clients/${clientId}`, { session: coachSession, body: { email: CLIENT_NEW, phone: "555 0100" } });
  const sameRow = await clientRow(clientId);
  check("the same address, with the rest of a save: 200, the rest saved", same.status === 200 && sameRow?.email === CLIENT_NEW && sameRow.phone === "555 0100", {
    ...evidence(same),
    sameRow,
  });
  const edited = await request(base, "PATCH", `/api/clients/${invitedId}`, { session: coachSession, body: { email: INVITED_EDIT } });
  check("another address for the invited client: 200, changed", edited.status === 200 && (await clientRow(invitedId))?.email === INVITED_EDIT, evidence(edited));

  console.info("6. The invite accepted after the coach edited the pending address: the row reads the invited address");
  const accepted = await request(base, "POST", "/api/invitations/accept", { body: { token: inviteToken, password: invitedPassword } });
  const invitedLoginId = await loginIdFor(INVITED);
  if (invitedLoginId) madeLogins.push(invitedLoginId);
  const invitedRow = await clientRow(invitedId);
  check(
    "the acceptance makes the login on the invited address, and the client row takes it with its link",
    accepted.status === 200 && invitedLoginId !== null && invitedRow?.user_id === invitedLoginId && invitedRow.email === INVITED,
    { ...evidence(accepted), invitedRow, invitedLoginId }
  );
  const invitedSession = cookieFrom(accepted, "invited client");
  const invitedMe = invitedSession ? await request(base, "GET", "/api/client/me", { session: invitedSession }) : null;
  check(
    "the client it signs in sees the invited address on their Settings (GET /api/client/me)",
    invitedMe?.status === 200 && (invitedMe.json as { data?: { email?: string } } | null)?.data?.email === INVITED,
    invitedMe ? evidence(invitedMe) : "no session cookie"
  );

  console.info("7. The owner's npm run auth:move-email");
  const minted = await mintSession(CLIENT_NEW, "client, minted");
  const before = await login(client.userId);
  const refusals: Array<[string, string[], string]> = [
    ["an address with no login", ["--project", DEV_REF, "--email", NOBODY, "--to", MOVED], `Refused: ${NOBODY} has no login. Nothing was changed.`],
    ["a --to a login holds", ["--project", DEV_REF, "--email", CLIENT_NEW, "--to", COACH_POOL], `Refused: ${COACH_POOL} is in use: a login holds it. Nothing was changed.`],
    ["a --to a coach row holds", ["--project", DEV_REF, "--email", CLIENT_NEW, "--to", LONE_COACH], `Refused: ${LONE_COACH} is in use: a coach row holds it. Nothing was changed.`],
    ["a --to a client row holds", ["--project", DEV_REF, "--email", CLIENT_NEW, "--to", PENDING], `Refused: ${PENDING} is in use: a client row holds it. Nothing was changed.`],
    ["production's ref against DEV's env", ["--project", PROD_REF, "--email", CLIENT_NEW, "--to", MOVED], `Refused: this run is for project ${PROD_REF}`],
  ];
  for (const [label, args, sentence] of refusals) {
    const run = await runMoveEmail(base, box, args);
    check(`refused, ${label}: it exits 1 and says so`, run.code === 1 && run.stderr.includes(sentence), { code: run.code, stderr: run.stderr.slice(-300) });
  }
  const afterRefusals = await login(client.userId);
  check(
    "nothing changed: the login, its sessions and its client row as they were, and nothing emailed",
    afterRefusals.email === CLIENT_NEW &&
      afterRefusals.sessions === before.sessions &&
      (await clientRow(clientId))?.email === CLIENT_NEW &&
      !box.emails.some((email) => email.subject === RESET_SUBJECT),
    { before, afterRefusals }
  );

  check("before the move the login holds several live sessions", before.sessions >= 2, before);
  // A Google account linked to the login, the row Better Auth's linking writes:
  // it signs the login in by the Google account whatever the login's address.
  await authPool.query(
    `INSERT INTO better_auth.account ("userId", "accountId", "providerId", "createdAt", "updatedAt") VALUES ($1, $2, 'google', now(), now())`,
    [client.userId, `email-follows-${STAMP}-google`]
  );
  check("before the move a Google account is linked to the login beside its password", (await providersOf(client.userId)).join() === "credential,google");
  const moved = await runMoveEmail(base, box, ["--project", DEV_REF, "--email", CLIENT_NEW, "--to", MOVED]);
  check(
    "the move: it exits 0, saying it moved the login, unlinked its Google account and how many sessions it ended",
    moved.code === 0 &&
      moved.stdout.includes(`Moved the login of ${CLIENT_NEW} to ${MOVED}`) &&
      moved.stdout.includes("Unlinked 1 Google account(s)") &&
      moved.stdout.includes(`Ended ${before.sessions} session(s)`) &&
      moved.stdout.includes(`npm run auth:last-link -- --email ${MOVED}`),
    { code: moved.code, stdout: moved.stdout.slice(-400), stderr: moved.stderr.slice(-300) }
  );
  const movedLogin = await login(client.userId);
  check(
    "the login and the client row on the new address, verified, and its sessions 0",
    movedLogin.email === MOVED && movedLogin.verified === true && movedLogin.sessions === 0 && (await clientRow(clientId))?.email === MOVED,
    movedLogin
  );
  const providersNow = await providersOf(client.userId);
  check("the Google account is unlinked and the password row kept", providersNow.join() === "credential", providersNow);
  check(
    "the client's open session and the minted one open nothing any more",
    (await request(base, "GET", "/api/client/me", { session: clientSession })).status === 401 &&
      (await request(base, "GET", "/api/client/me", { session: minted })).status === 401
  );
  const resetEmail = await box.waitForEmail(MOVED, RESET_SUBJECT);
  const resetUrl = resetEmail?.text.match(/https?:\/\/\S+\/api\/auth\/reset-password\/[A-Za-z0-9]+\?\S+/)?.[0] ?? "";
  check(
    `"${RESET_SUBJECT}" reaches the new address, its link landing on ${RESET_PASSWORD_PAGE}`,
    resetUrl.startsWith(`${base}/api/auth/reset-password/`) && new URL(resetUrl).searchParams.get("callbackURL") === RESET_PASSWORD_PAGE,
    { subjects: box.emails.map((email) => `${email.subject} → ${email.to.join(",")}`) }
  );
  const clicked = resetUrl === "" ? null : await request(base, "GET", resetUrl.slice(base.length));
  const token = clicked ? new URL(clicked.headers.get("location") ?? "", base).searchParams.get("token") : null;
  check(`following it lands on ${RESET_PASSWORD_PAGE} with its token`, clicked?.status === 302 && landing(base, clicked).startsWith(`${RESET_PASSWORD_PAGE}?token=`) && Boolean(token), clicked ? { status: clicked.status } : "no link");
  const reset = token ? await request(base, "POST", "/api/auth/reset-password", { body: { newPassword: resetPassword, token } }) : null;
  check("the reset works: 200", reset?.status === 200, reset ? evidence(reset) : "no token");
  check("the client signs in with the new address and the new password", (await signInStatus(base, MOVED, resetPassword)) === 200);
  check("and not with the old password", (await signInStatus(base, MOVED, clientPassword)) === 401);
}

async function cleanup(): Promise<void> {
  console.info("Cleanup");
  try {
    console.info(`  minted sessions ended: ${await endMintedSessions()}`);
    // The clients' logins first, then the coach's, which takes the coach row
    // and every client row with it. Each is found by the address it has now.
    const { rows } = await authPool.query<{ id: string; email: string }>(`SELECT id, email FROM better_auth."user" WHERE id = ANY($1::uuid[])`, [madeLogins]);
    const byId = new Map(rows.map((row) => [row.id, row.email]));
    for (const userId of [...madeLogins].reverse()) {
      const address = byId.get(userId);
      if (address) await deleteThrowawayLogin(address);
    }
    if (loneCoachRows.length > 0) {
      const { error } = await supabaseAdmin.from("coaches").delete().in("id", loneCoachRows);
      if (error) throw new Error(`coach rows with no login: ${error.message}`);
    }
    const { rows: left } = await authPool.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM better_auth."user" WHERE email LIKE $1)
             + (SELECT count(*) FROM public.coaches WHERE email LIKE $1)
             + (SELECT count(*) FROM public.clients WHERE email LIKE $1))::int AS n`,
      [ADDRESS_PATTERN]
    );
    check("cleanup: no throwaway login, coach row or client row is left", left[0]?.n === 0, left[0]);
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
    console.info("Every check of a login's address holds.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
